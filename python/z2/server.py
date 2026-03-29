from __future__ import annotations

import asyncio
import inspect
import json
import os
import sys
import threading
import time
from glob import glob
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType
from typing import Any, get_type_hints

from .decorators import ROUTE_METADATA_KEY
from .call_sessions import InMemoryCallSessionController
from .date_coerce import coerce_dateish_for_annotation
from .errors import HttpError, HttpResponse
from .file_queue import FileQueueErrorResponse, FileQueueRequest, FileQueueSuccessResponse
from .literalenum_support import make_pydantic_annotation
from .logging import get_logger
from .metadata import get_controller_meta
from .plugins import (
    BucketConfig,
    CacheContext,
    CacheEntry,
    RateLimitContext,
    RateLimitEntry,
    TokenLimitContext,
    TokenLimitEntry,
    TokenLimitTiming,
    apply_cache_check,
    apply_cache_store,
    apply_rate_limit_check,
    apply_rate_limit_refund,
    apply_token_limit_check,
    apply_token_limit_failure,
    apply_token_limit_response,
    create_in_memory_cache,
    create_in_memory_rate_limit,
    create_in_memory_token_limit,
)
from .response_serialize import serialize_for_response
from .rpc import DEFAULT_RPC_PATH
from .rpc_protocol_plugin import create_rpc_protocol_plugin, RpcProtocolPluginOptions
from .routing import generate_route_variants
from .file_queue_protocol_plugin import create_file_queue_protocol_plugin, FileQueueProtocolPluginOptions
from .protocol_plugin import ServerHostContext, ServerTransportRuntime
from .server_types import ControllerMeta, FileQueueOptions, RouteContext, RouteMeta, PLATServerOptions
from .tools import format_tool
from .transports import CallEnvelope, ResolvedOperation

RESERVED_METHOD_NAMES = {"tools", "routes", "endpoints", "help", "openapi"}
logger = get_logger("plat.server")


def _lazy_fastapi():
    try:
        from fastapi import FastAPI, HTTPException, Request, Response, WebSocket
        from fastapi.middleware.cors import CORSMiddleware
        from fastapi.responses import JSONResponse, PlainTextResponse
        from pydantic import BaseModel, RootModel, TypeAdapter
        import uvicorn
    except ImportError as exc:
        raise ImportError(
            "plat server support requires the optional server dependencies. "
            "Install the Python package with FastAPI, Pydantic, and Uvicorn available."
        ) from exc

    return {
        "BaseModel": BaseModel,
        "CORSMiddleware": CORSMiddleware,
        "FastAPI": FastAPI,
        "HTTPException": HTTPException,
        "JSONResponse": JSONResponse,
        "PlainTextResponse": PlainTextResponse,
        "Request": Request,
        "Response": Response,
        "RootModel": RootModel,
        "TypeAdapter": TypeAdapter,
        "uvicorn": uvicorn,
        "WebSocket": WebSocket,
    }


def normalize_parameters(
    params: dict[str, Any],
    param_coercions: dict[str, str] | None = None,
    dis_allowed_params: list[str] | None = None,
) -> dict[str, Any]:
    if not isinstance(params, dict):
        return params

    if dis_allowed_params:
        for key in params:
            if key in dis_allowed_params:
                canonical = _get_canonical_name(key)
                suggestion = canonical or "a different parameter"
                raise ValueError(
                    f"Parameter '{key}' is disallowed in this API. Use '{suggestion}' instead."
                )

    aliases = param_coercions or {"query": "q", "search": "q", "format": "fmt"}
    normalized = dict(params)

    for alias, canonical in aliases.items():
        if alias in normalized and canonical:
            normalized.setdefault(canonical, normalized[alias])
            del normalized[alias]

    if "page" in normalized or "pageSize" in normalized:
        page = int(normalized.get("page", 1))
        page_size = int(normalized.get("pageSize", 10))
        normalized.setdefault("limit", page_size)
        normalized.setdefault("offset", (page - 1) * page_size)
        normalized.pop("page", None)
        normalized.pop("pageSize", None)

    return normalized


def _get_canonical_name(param_name: str) -> str | None:
    if param_name == "page":
        return "offset"
    if param_name == "pageSize":
        return "limit"
    aliases = {"query": "q", "search": "q", "format": "fmt"}
    return aliases.get(param_name)


def discover_controller_classes(
    *patterns: str,
    root: str | Path | None = None,
) -> list[type[Any]]:
    search_root = Path(root or ".").resolve()
    effective_patterns = patterns or ("**/*.api.py",)
    controllers: list[type[Any]] = []

    for pattern in effective_patterns:
        candidate = (search_root / pattern).resolve()
        if candidate.is_dir():
            path_matches = sorted(glob(str(candidate / "**/*.api.py"), recursive=True))
        elif candidate.is_file():
            path_matches = [str(candidate)]
        else:
            path_matches = sorted(glob(str(search_root / pattern), recursive=True))

        for path_str in path_matches:
            path = Path(path_str).resolve()
            module = _load_module_from_path(path)
            controllers.extend(_get_module_controller_classes(module))

    return controllers


def _load_module_from_path(path: Path) -> ModuleType:
    module_name = "plat_py_" + "_".join(path.with_suffix("").parts[-4:])
    spec = spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load module from {path}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _get_module_controller_classes(module: ModuleType) -> list[type[Any]]:
    controllers: list[type[Any]] = []
    for value in vars(module).values():
        if inspect.isclass(value) and get_controller_meta(value):
            controllers.append(value)
    return controllers


class PLATServer:
    def __init__(self, options: PLATServerOptions | dict[str, Any] | None = None, *controller_classes: type[Any]):
        fastapi = _lazy_fastapi()
        self._fastapi = fastapi
        self.options = self._coerce_options(options)
        self.routes: list[dict[str, str]] = []
        self.tools: dict[str, dict[str, str]] = {}
        self.rpc_operations_by_id: dict[str, dict[str, Any]] = {}
        self.rpc_operations_by_route: dict[str, dict[str, Any]] = {}
        self.registered_method_names: set[str] = set()
        self.registered_controller_names: set[str] = set()
        self._file_queue_plugin: Any | None = None
        # File queue thread now managed by file_queue_protocol_plugin
        self._setup_plugin_defaults()

        openapi_url = "/openapi.json" if self.options.openapi is True else self.options.openapi if isinstance(self.options.openapi, str) else None
        docs_url = "/docs" if self.options.swagger is True else self.options.swagger if isinstance(self.options.swagger, str) else None
        redoc_url = "/redoc" if self.options.redoc is True else self.options.redoc if isinstance(self.options.redoc, str) else None
        self.app = fastapi["FastAPI"](
            title="plat API",
            docs_url=docs_url,
            redoc_url=redoc_url,
            openapi_url=openapi_url,
        )

        self._setup_middleware()
        self._setup_documentation_routes()
        self._setup_call_routes()

        if controller_classes:
            self.register(*controller_classes)

    def _coerce_options(self, options: PLATServerOptions | dict[str, Any] | None) -> PLATServerOptions:
        if options is None:
            return PLATServerOptions()
        if isinstance(options, PLATServerOptions):
            return options
        coerced = PLATServerOptions()
        for key, value in options.items():
            attr = key.replace("-", "_")
            if hasattr(coerced, attr):
                if attr == "cors" and isinstance(value, dict):
                    value = coerced.cors.__class__(**value)
                if attr == "file_queue" and isinstance(value, dict):
                    value = FileQueueOptions(**value)
                setattr(coerced, attr, value)
        return coerced

    def _setup_plugin_defaults(self) -> None:
        if self.options.rate_limit is not None and not self.options.rate_limit.get("controller"):
            self.options.rate_limit["controller"] = create_in_memory_rate_limit()
        if self.options.token_limit is not None and not self.options.token_limit.get("controller"):
            self.options.token_limit["controller"] = create_in_memory_token_limit()
        if self.options.cache is not None and not self.options.cache.get("controller"):
            self.options.cache["controller"] = create_in_memory_cache()
        if self.options.calls is not None and not self.options.calls.get("controller"):
            self.options.calls["controller"] = InMemoryCallSessionController()

    def _setup_middleware(self) -> None:
        cors = self.options.cors
        if cors:
            if cors is True:
                config = {"allow_origins": ["*"], "allow_credentials": False}
            else:
                origins = cors.origin if isinstance(cors.origin, list) else [cors.origin or "*"]
                config = {
                    "allow_origins": origins,
                    "allow_credentials": cors.credentials,
                    "allow_methods": cors.methods or ["*"],
                    "allow_headers": cors.headers or ["*"],
                    "expose_headers": cors.exposed_headers or [],
                    "max_age": cors.max_age or 600,
                }
            self.app.add_middleware(self._fastapi["CORSMiddleware"], **config)

        headers = dict(self.options.headers)
        if headers:
            @self.app.middleware("http")
            async def add_default_headers(request, call_next):
                response = await call_next(request)
                for key, value in headers.items():
                    response.headers.setdefault(key, value)
                return response

    def _setup_documentation_routes(self) -> None:
        JSONResponse = self._fastapi["JSONResponse"]
        PlainTextResponse = self._fastapi["PlainTextResponse"]

        @self.app.get("/endpoints")
        async def list_endpoints(method: str | None = None, search: str | None = None, q: str | None = None, path: str | None = None, format: str | None = None):
            filtered = self._filter_routes(method=method, search=search or q, path=path)
            if format == "json":
                return {
                    "count": len(filtered),
                    "endpoints": filtered,
                }
            lines = [self._format_route(route) for route in filtered]
            return PlainTextResponse("\n".join(lines))

        @self.app.get("/openapi-jq")
        async def openapi_jq(filter: str | None = None):
            document = self.app.openapi()
            result = self._apply_json_filter(document, filter or ".")
            return JSONResponse(result)

        for method_name in ("get", "post", "put", "patch", "delete"):
            self.app.add_api_route(
                f"/routes/{method_name}",
                self._make_routes_handler(method_name.upper()),
                methods=["GET"],
            )

        @self.app.get("/help")
        async def help_index():
            openapi_url = self.app.openapi_url
            docs_url = self.app.docs_url
            redoc_url = self.app.redoc_url
            calls_path = self.options.calls.get("path") if self.options.calls else None
            return {
                "endpoints": {
                    "GET /endpoints": "List all available API endpoints with descriptions",
                    "GET /routes/get": "List all GET endpoints (paths only)",
                    "GET /tools": "List tool metadata for registered operations",
                    **({f"GET {calls_path}Status?id=...": "Inspect a deferred HTTP call session"} if calls_path else {}),
                    **({f"GET {calls_path}Events?id=...": "Read deferred HTTP call events/logs"} if calls_path else {}),
                    **({f"GET {calls_path}Result?id=...": "Read the final result for a deferred HTTP call"} if calls_path else {}),
                    **({f"POST {calls_path}Cancel": "Cancel a deferred HTTP call by id"} if calls_path else {}),
                    **({f"GET {openapi_url}": "OpenAPI specification"} if openapi_url else {}),
                    **({f"GET {docs_url}": "Swagger UI documentation"} if docs_url else {}),
                    **({f"GET {redoc_url}": "ReDoc documentation"} if redoc_url else {}),
                },
            }

        @self.app.get("/tools")
        async def tools(
            fmt: str = "schema",
            method: str | None = None,
            controller: str | None = None,
            tag: str | None = None,
            includeHidden: bool = False,
            safeOnly: bool = False,
            longRunning: bool = False,
        ):
            if method:
                tool = self.tools.get(method)
                if tool is None or not self._matches_tool_query(
                    tool,
                    controller=controller,
                    tag=tag,
                    include_hidden=includeHidden,
                    safe_only=safeOnly,
                    long_running=longRunning,
                ):
                    raise self._fastapi["HTTPException"](status_code=404, detail=f"Tool '{method}' not found")
                return format_tool(tool, fmt)
            return [
                format_tool(tool, fmt)
                for tool in self.tools.values()
                if self._matches_tool_query(
                    tool,
                    controller=controller,
                    tag=tag,
                    include_hidden=includeHidden,
                    safe_only=safeOnly,
                    long_running=longRunning,
                )
            ]

    def _setup_call_routes(self) -> None:
        controller = self.options.calls.get("controller") if self.options.calls else None
        base_path = self.options.calls.get("path") if self.options.calls else None
        if controller is None or not isinstance(base_path, str):
            return

        @self.app.get(f"{base_path}Status")
        async def plat_call_status(id: str):
            session = controller.get(id)
            if session is None:
                raise self._fastapi["HTTPException"](status_code=404, detail="Call session not found")
            return self._serialize_call_summary(session)

        @self.app.get(f"{base_path}Events")
        async def plat_call_events(id: str, since: int = 0, event: str | None = None):
            session = controller.get(id)
            if session is None:
                raise self._fastapi["HTTPException"](status_code=404, detail="Call session not found")
            return {
                "events": [
                    {
                        "seq": item.seq,
                        "at": item.at,
                        "event": item.event,
                        "data": item.data,
                    }
                    for item in controller.list_events(id, since=since, event=event)  # type: ignore[arg-type]
                ]
            }

        @self.app.get(f"{base_path}Result")
        async def plat_call_result(id: str):
            session = controller.get(id)
            if session is None:
                raise self._fastapi["HTTPException"](status_code=404, detail="Call session not found")
            status_code = 200 if session.status == "completed" else session.error.get("status_code", 500) if session.status == "failed" and session.error else 409 if session.status == "cancelled" else 202
            return self._fastapi["JSONResponse"](
                status_code=status_code,
                content=self._serialize_call_summary(session),
            )

        @self.app.post(f"{base_path}Cancel")
        async def plat_call_cancel(request):
            payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
            call_id = str(payload.get("id") or request.query_params.get("id") or "")
            if not call_id:
                raise self._fastapi["HTTPException"](status_code=400, detail="Missing call id")
            session = controller.get(call_id)
            if session is None:
                raise self._fastapi["HTTPException"](status_code=404, detail="Call session not found")
            return {"cancelled": controller.cancel(call_id)}

    def _make_routes_handler(self, method_name: str):
        PlainTextResponse = self._fastapi["PlainTextResponse"]

        async def handler():
            paths = [route["path"] for route in self.routes if route["method"] == method_name]
            return PlainTextResponse("\n".join(paths))

        return handler

    def _serialize_call_summary(self, session) -> dict[str, Any]:
        return {
            "id": session.id,
            "operationId": session.operation_id,
            "method": session.method,
            "path": session.path,
            "status": session.status,
            "createdAt": session.created_at,
            "updatedAt": session.updated_at,
            "startedAt": session.started_at,
            "completedAt": session.completed_at,
            "statusCode": session.status_code,
            "result": session.result,
            "error": session.error,
        }

    def _is_deferred_execution_requested(self, request: Any) -> bool:
        return request.headers.get("x-plat-execution") == "deferred" or request.query_params.get("execution") == "deferred"

    def _attach_call_context(
        self,
        ctx: RouteContext,
        *,
        session_id: str,
        mode: str,
        emit: Any,
        cancelled: Any,
    ) -> None:
        call = {
            "id": session_id,
            "mode": mode,
            "emit": emit,
            "progress": lambda data=None: emit("progress", data),
            "log": lambda data=None: emit("log", data),
            "chunk": lambda data=None: emit("chunk", data),
            "cancelled": cancelled,
            "signal": None,
        }
        ctx.call = call
        if mode == "rpc":
            ctx.rpc = call

    def register(self, *controller_classes: type[Any]) -> "PLATServer":
        for controller_class in controller_classes:
            meta = get_controller_meta(controller_class)
            if meta is None:
                raise ValueError(f"{controller_class.__name__} is not decorated with @Controller")

            instance = controller_class()
            controller_tag = meta.tag or meta.base_path or controller_class.__name__
            lower_controller_tag = controller_tag.lower()
            if lower_controller_tag in RESERVED_METHOD_NAMES:
                raise ValueError(f"Controller '{controller_tag}' uses a reserved plat system name.")
            if controller_tag in self.registered_method_names:
                raise ValueError(f"Controller '{controller_tag}' conflicts with an existing method name.")
            self.registered_controller_names.add(controller_tag)

            methods = inspect.getmembers(controller_class, predicate=inspect.isfunction)
            routes: dict[str, tuple[Any, RouteMeta]] = {}
            for method_name, method_fn in methods:
                route_meta = getattr(method_fn, ROUTE_METADATA_KEY, None)
                if route_meta is None:
                    continue
                self._hydrate_route_meta(route_meta, method_fn)
                routes[method_name] = (getattr(instance, method_name), route_meta)

            for method_name, (bound_method, route_meta) in routes.items():
                self._validate_method_name(method_name, controller_class.__name__)
                if method_name in self.registered_controller_names:
                    raise ValueError(f"Method '{method_name}' in {controller_class.__name__} conflicts with controller name '{method_name}'.")
                if method_name in self.registered_method_names:
                    raise ValueError(
                        f'Duplicate operationId: method "{method_name}" is defined in multiple controllers.'
                    )
                self.registered_method_names.add(method_name)

                full_path = f"/{method_name}"
                self.tools[method_name] = {
                    "name": method_name,
                    "summary": route_meta.summary,
                    "description": route_meta.description or f"{(route_meta.method or 'GET').upper()} {full_path}",
                    "method": route_meta.method or "GET",
                    "path": full_path,
                    "controller": controller_tag,
                    "tags": self._build_tool_tags(controller_tag, route_meta),
                    "examples": route_meta.opts.get("examples") if isinstance(route_meta.opts, dict) else None,
                    "hidden": bool(route_meta.opts.get("hidden")) if isinstance(route_meta.opts, dict) else False,
                    "safe": route_meta.opts.get("safe") if isinstance(route_meta.opts, dict) and "safe" in route_meta.opts else (route_meta.method or "GET").upper() in {"GET", "HEAD"},
                    "idempotent": route_meta.opts.get("idempotent") if isinstance(route_meta.opts, dict) and "idempotent" in route_meta.opts else (route_meta.method or "GET").upper() in {"GET", "HEAD", "PUT", "DELETE"},
                    "longRunning": bool(route_meta.opts.get("longRunning")) if isinstance(route_meta.opts, dict) else False,
                    "input_schema": self._build_tool_input_schema(route_meta),
                    "response_schema": self._build_tool_response_schema(route_meta),
                }
                rpc_operation = ResolvedOperation(
                    method=route_meta.method or "GET",
                    path=full_path,
                    method_name=method_name,
                    bound_method=bound_method,
                    route_meta=route_meta,
                    controller_meta=meta,
                )
                self.rpc_operations_by_id[method_name] = rpc_operation
                self.rpc_operations_by_route[f"{rpc_operation.method} {rpc_operation.path}"] = rpc_operation

                endpoint = self._build_endpoint(bound_method, method_name, route_meta, meta, full_path)
                response_model = self._build_openapi_response_model(route_meta.output_model)

                self.app.add_api_route(
                    full_path,
                    endpoint,
                    methods=[route_meta.method or "GET"],
                    operation_id=method_name,
                    summary=route_meta.summary,
                    description=route_meta.description,
                    response_model=response_model,
                    tags=[controller_tag],
                )

                for variant in generate_route_variants(method_name, route_meta.method or "GET"):
                    if variant["path"] == full_path and variant["method"] == (route_meta.method or "GET"):
                        continue
                    self.app.add_api_route(
                        variant["path"],
                        endpoint,
                        methods=[variant["method"]],
                        include_in_schema=False,
                    )

                self.routes.append(
                    {
                        "method": route_meta.method or "GET",
                        "path": full_path,
                        "methodName": method_name,
                    }
                )

        return self

    def register_glob(self, *patterns: str, root: str | Path | None = None) -> "PLATServer":
        controllers = discover_controller_classes(*patterns, root=root)
        if not controllers:
            joined = ", ".join(patterns or ("**/*.api.py",))
            raise ValueError(f"No Python controllers found for: {joined}")
        return self.register(*controllers)

    def get_app(self):
        return self.app

    def listen(self, port: int | None = None, host: str | None = None) -> "PLATServer":
        final_port = port or self.options.port
        final_host = host or self.options.host
        transport_runtime = self.create_transport_runtime()
        host_context = ServerHostContext(
            kind="fastapi-uvicorn",
            app=self.app,
            meta={"host": final_host, "port": final_port},
        )

        from .errors import HttpError
        rpc_plugin = create_rpc_protocol_plugin(RpcProtocolPluginOptions(
            enabled=self.options.rpc,
            http_error_class=HttpError,
        ))

        fq_config = self.options.file_queue
        fq_plugin = None
        if fq_config and fq_config is not False:
            fq_plugin = create_file_queue_protocol_plugin(FileQueueProtocolPluginOptions(
                inbox=fq_config.inbox,
                outbox=fq_config.outbox,
                poll_interval_ms=fq_config.poll_interval_ms,
                archive=fq_config.archive,
                http_error_class=HttpError,
            ))
            self._file_queue_plugin = fq_plugin

        built_in_plugins = [p for p in [rpc_plugin, fq_plugin] if p is not None]
        all_plugins = built_in_plugins + list(self.options.protocol_plugins)
        for plugin in all_plugins:
            if hasattr(plugin, "setup"):
                plugin.setup(transport_runtime)
        for plugin in all_plugins:
            if hasattr(plugin, "attach"):
                plugin.attach(transport_runtime, host_context)
            plugin.start(transport_runtime)
        self._print_startup_message(final_host, final_port)
        self._fastapi["uvicorn"].run(self.app, host=final_host, port=final_port)
        return self

    def _process_file_queue_once(self) -> None:
        if self._file_queue_plugin is None:
            fq_config = self.options.file_queue
            if not fq_config or fq_config is False:
                raise AttributeError("File queue transport is not configured")
            from .errors import HttpError
            self._file_queue_plugin = create_file_queue_protocol_plugin(FileQueueProtocolPluginOptions(
                inbox=fq_config.inbox,
                outbox=fq_config.outbox,
                poll_interval_ms=fq_config.poll_interval_ms,
                archive=fq_config.archive,
                http_error_class=HttpError,
            ))
            self._file_queue_plugin.setup(self.create_transport_runtime())
        self._file_queue_plugin.process_once()

    def create_transport_runtime(self) -> ServerTransportRuntime:
        return ServerTransportRuntime(
            logger=logger,
            resolve_operation=self._resolve_operation,
            dispatch=self._dispatch_transport_call,
            normalize_input=lambda input_data: normalize_parameters(
                input_data,
                self.options.param_coercions,
                self.options.dis_allowed_params,
            ),
            serialize_value=lambda value: serialize_for_response(value, self.options.output_serializers),
            create_call_context=self._create_call_context,
            create_envelope=self._create_envelope,
        )

    def _create_call_context(
        self,
        *,
        ctx: RouteContext,
        session_id: str,
        mode: str,
        emit: Any,
        signal: Any = None,
    ) -> Any:
        self._attach_call_context(
            ctx,
            session_id=session_id,
            mode=mode,
            emit=emit,
            cancelled=(lambda: bool(getattr(signal, "cancelled", False))) if signal is not None else (lambda: False),
        )
        if ctx.call is not None and signal is not None:
            ctx.call["signal"] = signal
        return ctx.call

    def _create_envelope(
        self,
        *,
        protocol: str,
        operation: ResolvedOperation,
        input: dict[str, Any],
        ctx: RouteContext,
        headers: dict[str, str] | None = None,
        request_id: str | None = None,
        request: Any = None,
        response: Any = None,
        allow_help: bool = False,
        help_requested: bool = False,
    ) -> CallEnvelope:
        return CallEnvelope(
            protocol=protocol,
            method=operation.method,
            path=operation.path,
            headers=headers or {},
            input=input,
            ctx=ctx,
            operation_id=operation.method_name,
            request_id=request_id,
            request=request,
            response=response,
            allow_help=allow_help,
            help_requested=help_requested,
        )

    def _build_endpoint(
        self,
        bound_method: Any,
        method_name: str,
        route_meta: RouteMeta,
        controller_meta: ControllerMeta,
        full_path: str,
    ):
        HTTPException = self._fastapi["HTTPException"]
        JSONResponse = self._fastapi["JSONResponse"]
        Request = self._fastapi["Request"]
        Response = self._fastapi["Response"]

        async def endpoint(request: Request, response: Response):
            input_data = await self._collect_input(request)
            input_data = normalize_parameters(
                input_data,
                self.options.param_coercions,
                self.options.dis_allowed_params,
            )
            ctx = RouteContext(
                method=request.method,
                url=str(request.url.path),
                headers=dict(request.headers.items()),
                opts=route_meta.opts,
                request=request,
                response=response,
            )
            help_requested = self._is_help_requested(request)
            wants_deferred = not help_requested and self._is_deferred_execution_requested(request)

            try:
                calls_controller = self.options.calls.get("controller") if self.options.calls else None
                calls_path = self.options.calls.get("path") if self.options.calls else None
                if wants_deferred and calls_controller is not None and isinstance(calls_path, str):
                    session = calls_controller.create(
                        operation_id=method_name,
                        method=request.method,
                        path=full_path,
                    )
                    cancelled = {"value": False}

                    async def emit(event: str, data: Any = None) -> None:
                        calls_controller.append_event(
                            session.id,
                            event,
                            serialize_for_response(data, self.options.output_serializers),
                        )

                    self._attach_call_context(
                        ctx,
                        session_id=session.id,
                        mode="deferred",
                        emit=emit,
                        cancelled=lambda: cancelled["value"],
                    )

                    deferred_envelope = CallEnvelope(
                        protocol="http",
                        method=request.method,
                        path=full_path,
                        headers=dict(request.headers.items()),
                        input=input_data,
                        ctx=ctx,
                        operation_id=method_name,
                        request=request,
                        response=response,
                        allow_help=False,
                        help_requested=False,
                    )

                    async def run_deferred() -> None:
                        try:
                            calls_controller.start(session.id)
                            execution = await self._dispatch_transport_call(
                                ResolvedOperation(
                                    method=request.method,
                                    path=full_path,
                                    method_name=method_name,
                                    bound_method=bound_method,
                                    route_meta=route_meta,
                                    controller_meta=controller_meta,
                                ),
                                deferred_envelope,
                            )
                            if execution["kind"] == "http_response":
                                calls_controller.complete(
                                    session.id,
                                    serialize_for_response(execution["http_response"].body, self.options.output_serializers),
                                    execution["status_code"],
                                )
                            else:
                                calls_controller.complete(
                                    session.id,
                                    serialize_for_response(execution["result"], self.options.output_serializers),
                                    execution["status_code"],
                                )
                        except asyncio.CancelledError:
                            cancelled["value"] = True
                            calls_controller.cancel(session.id)
                        except Exception as exc:
                            status_code = getattr(exc, "status_code", None) or getattr(exc, "status", None) or 500
                            calls_controller.fail(
                                session.id,
                                message=str(exc) or "Internal server error",
                                status_code=status_code,
                                data=getattr(exc, "data", None),
                            )

                    task = asyncio.create_task(run_deferred())
                    calls_controller.set_cancel(session.id, lambda: (cancelled.__setitem__("value", True), task.cancel()))
                    return JSONResponse(
                        status_code=202,
                        content={
                            "id": session.id,
                            "status": session.status,
                            "statusPath": f"{calls_path}Status?id={session.id}",
                            "eventsPath": f"{calls_path}Events?id={session.id}",
                            "resultPath": f"{calls_path}Result?id={session.id}",
                            "cancelPath": f"{calls_path}Cancel",
                        },
                    )

                execution = await self._dispatch_transport_call(
                    ResolvedOperation(
                        method=request.method,
                        path=full_path,
                        method_name=method_name,
                        bound_method=bound_method,
                        route_meta=route_meta,
                        controller_meta=controller_meta,
                    ),
                    CallEnvelope(
                        protocol="http",
                        method=request.method,
                        path=full_path,
                        headers=dict(request.headers.items()),
                        input=input_data,
                        ctx=ctx,
                        operation_id=method_name,
                        request=request,
                        response=response,
                        allow_help=True,
                        help_requested=help_requested,
                    ),
                )
                if execution["kind"] == "help":
                    return execution["result"]
                if execution["kind"] == "http_response":
                    http_response = execution["http_response"]
                    self._apply_response_headers(response, ctx)
                    headers = dict(http_response.headers)
                    for key, value in response.headers.items():
                        headers.setdefault(key, value)
                    return JSONResponse(status_code=http_response.status_code, content=http_response.body, headers=headers)

                result = execution["result"]
                status_code = execution["status_code"]
                self._apply_response_headers(response, ctx)
                return result
            except HTTPException:
                raise
            except Exception as exc:
                raise self._to_http_exception(exc) from exc

        endpoint.__annotations__ = {
            "request": Request,
            "response": Response,
        }
        return endpoint

    def _resolve_operation(self, *, operation_id: str | None, method: str, path: str) -> ResolvedOperation | None:
        operation = self.rpc_operations_by_id.get(operation_id) if operation_id else None
        if operation is not None:
            return operation
        return self.rpc_operations_by_route.get(f"{method.upper()} {path}")

    async def _dispatch_transport_call(
        self,
        operation: ResolvedOperation,
        envelope: CallEnvelope,
    ) -> dict[str, Any]:
        return await self._execute_operation(
            bound_method=operation.bound_method,
            method_name=operation.method_name,
            route_meta=operation.route_meta,
            controller_meta=operation.controller_meta,
            full_path=operation.path,
            transport_method=envelope.method,
            input_data=envelope.input,
            ctx=envelope.ctx,
            request=envelope.request,
            response=envelope.response,
            allow_help=envelope.allow_help,
        )

    async def _collect_input(self, request) -> dict[str, Any]:
        data: dict[str, Any] = dict(request.path_params)
        data.update(dict(request.query_params.multi_items()))

        content_type = request.headers.get("content-type", "")
        if content_type.startswith("application/json"):
            try:
                body = await request.json()
            except Exception:
                body = None
            if isinstance(body, dict):
                data.update(body)
        elif content_type.startswith("application/x-www-form-urlencoded") or content_type.startswith("multipart/form-data"):
            form = await request.form()
            data.update(dict(form.items()))

        return data

    async def _execute_operation(
        self,
        *,
        bound_method: Any,
        method_name: str,
        route_meta: RouteMeta,
        controller_meta: ControllerMeta,
        full_path: str,
        transport_method: str,
        input_data: dict[str, Any],
        ctx: RouteContext,
        request: Any | None = None,
        response: Any | None = None,
        allow_help: bool,
    ) -> dict[str, Any]:
        signature = inspect.signature(bound_method)
        params = list(signature.parameters.values())
        rate_limit_entries = []
        token_limit_entries = []
        token_start_ms = int(time.time() * 1000)
        handler_called = False
        parsed_input = input_data

        try:
            auth_mode = route_meta.auth or controller_meta.auth or self.options.default_auth
            if auth_mode != "public":
                if self.options.auth is None:
                    raise self._fastapi["HTTPException"](status_code=500, detail="Authentication handler not configured")
                verifier = getattr(self.options.auth, "verify", self.options.auth)
                user = verifier(auth_mode, request, ctx)
                if inspect.isawaitable(user):
                    user = await user
                ctx.auth = {"mode": auth_mode, "user": user}

            if allow_help and request is not None and self._is_help_requested(request):
                return {"kind": "help", "result": self._generate_route_help(method_name, full_path, route_meta)}

            rate_limit_meta = self._get_rate_limit_meta(route_meta, controller_meta)
            if rate_limit_meta is not None and self.options.rate_limit and self.options.rate_limit.get("controller"):
                entries, balances = apply_rate_limit_check(
                    rate_limit_meta,
                    self.options.rate_limit["controller"],
                    self.options.rate_limit.get("configs", {}),
                    method_name,
                    controller_meta.base_path,
                    ctx.auth["user"] if ctx.auth else None,
                )
                rate_limit_entries = entries
                ctx.rate_limit = RateLimitContext(entries=entries, remaining_balances=balances)

            parsed_input = self._coerce_input(input_data, route_meta.input_model)

            token_limit_meta = self._get_token_limit_meta(route_meta, controller_meta)
            if token_limit_meta is not None and self.options.token_limit and self.options.token_limit.get("controller"):
                entries, balances = apply_token_limit_check(
                    token_limit_meta,
                    self.options.token_limit["controller"],
                    self.options.token_limit.get("configs", {}),
                    method_name,
                    controller_meta.base_path,
                    parsed_input,
                    ctx,
                    ctx.auth["user"] if ctx.auth else None,
                )
                token_limit_entries = entries
                ctx.token_limit = TokenLimitContext(entries=entries, remaining_balances=balances)

            cache_meta = self._get_cache_meta(route_meta, controller_meta)
            cache_key = None
            cache_entry = None
            if cache_meta is not None and self.options.cache and self.options.cache.get("controller"):
                cache_key, hit, cached_value, cache_entry = apply_cache_check(
                    cache_meta,
                    self.options.cache["controller"],
                    input_data,
                    transport_method,
                    method_name,
                    controller_meta.base_path,
                    ctx.auth["user"] if ctx.auth else None,
                )
                ctx.cache = CacheContext(key=cache_key, hit=hit, stored=False)
                if hit:
                    return {"kind": "result", "result": cached_value, "status_code": 200}

            result = self._invoke_handler(bound_method, params, parsed_input, ctx)
            if inspect.isawaitable(result):
                result = await result
            handler_called = True
            result = self._coerce_output(result, route_meta.output_model)

            status_code = 201 if transport_method == "POST" else 200
            if token_limit_entries and self.options.token_limit and self.options.token_limit.get("controller"):
                timing = TokenLimitTiming(
                    start_ms=token_start_ms,
                    end_ms=int(time.time() * 1000),
                    duration_ms=int(time.time() * 1000) - token_start_ms,
                )
                response_costs = apply_token_limit_response(
                    token_limit_entries,
                    self.options.token_limit["controller"],
                    result,
                    timing,
                    parsed_input,
                    status_code,
                )
                if ctx.token_limit:
                    ctx.token_limit.timing = timing
                    ctx.token_limit.response_costs = response_costs

            if rate_limit_entries and self.options.rate_limit and self.options.rate_limit.get("controller"):
                apply_rate_limit_refund(rate_limit_entries, self.options.rate_limit["controller"], status_code)

            if cache_entry is not None and self.options.cache and self.options.cache.get("controller"):
                apply_cache_store(cache_key, cache_entry, self.options.cache["controller"], result)
                if ctx.cache:
                    ctx.cache.stored = True

            return {"kind": "result", "result": result, "status_code": status_code}
        except HttpResponse as http_response:
            status_code = http_response.status_code
            if token_limit_entries and self.options.token_limit and self.options.token_limit.get("controller") and handler_called:
                timing = TokenLimitTiming(
                    start_ms=token_start_ms,
                    end_ms=int(time.time() * 1000),
                    duration_ms=int(time.time() * 1000) - token_start_ms,
                )
                if 200 <= status_code < 400:
                    response_costs = apply_token_limit_response(
                        token_limit_entries,
                        self.options.token_limit["controller"],
                        http_response.body,
                        timing,
                        parsed_input,
                        status_code,
                    )
                    if ctx.token_limit:
                        ctx.token_limit.timing = timing
                        ctx.token_limit.response_costs = response_costs
                else:
                    failure_costs = apply_token_limit_failure(
                        token_limit_entries,
                        self.options.token_limit["controller"],
                        http_response,
                        timing,
                        parsed_input,
                        status_code,
                    )
                    if ctx.token_limit:
                        ctx.token_limit.timing = timing
                        ctx.token_limit.failure_costs = failure_costs
            if rate_limit_entries and self.options.rate_limit and self.options.rate_limit.get("controller"):
                apply_rate_limit_refund(rate_limit_entries, self.options.rate_limit["controller"], status_code)
            return {"kind": "http_response", "http_response": http_response, "status_code": status_code}
        except Exception as exc:
            timing = TokenLimitTiming(
                start_ms=token_start_ms,
                end_ms=int(time.time() * 1000),
                duration_ms=max(0, int(time.time() * 1000) - token_start_ms),
            )
            status_code = getattr(exc, "status_code", None) or getattr(exc, "status", None) or 500
            if token_limit_entries and self.options.token_limit and self.options.token_limit.get("controller") and handler_called:
                failure_costs = apply_token_limit_failure(
                    token_limit_entries,
                    self.options.token_limit["controller"],
                    exc,
                    timing,
                    parsed_input,
                    status_code,
                )
                if ctx.token_limit:
                    ctx.token_limit.timing = timing
                    ctx.token_limit.failure_costs = failure_costs
            if rate_limit_entries and self.options.rate_limit and self.options.rate_limit.get("controller"):
                apply_rate_limit_refund(rate_limit_entries, self.options.rate_limit["controller"], status_code)
            raise

    def _hydrate_route_meta(self, route_meta: RouteMeta, method_fn: Any) -> None:
        signature = inspect.signature(method_fn)
        module = sys.modules.get(getattr(method_fn, "__module__", ""))
        try:
            resolved_hints = get_type_hints(
                method_fn,
                globalns=vars(module) if module is not None else None,
                include_extras=True,
            )
        except Exception:
            resolved_hints = {}
        params = [param for name, param in signature.parameters.items() if name != "self"]
        input_param = None
        for param in params:
            if self._is_context_parameter(param):
                continue
            input_param = param
            break
        return_annotation = resolved_hints.get("return", signature.return_annotation)

        if input_param:
            input_annotation = resolved_hints.get(input_param.name, input_param.annotation)
            if input_annotation is not inspect.Signature.empty:
                route_meta.input_model = make_pydantic_annotation(input_annotation)
        if return_annotation is not inspect.Signature.empty:
            route_meta.output_model = make_pydantic_annotation(return_annotation)

        doc = inspect.getdoc(method_fn) or ""
        if doc:
            lines = [line.strip() for line in doc.splitlines() if line.strip()]
            if lines:
                route_meta.summary = route_meta.summary or lines[0]
                route_meta.description = route_meta.description or "\n".join(lines)

    def _build_tool_tags(self, controller_tag: str, route_meta: RouteMeta) -> list[str]:
        tags = [controller_tag]
        opts = route_meta.opts if isinstance(route_meta.opts, dict) else {}
        extra_tags = opts.get("tags")
        if isinstance(extra_tags, list):
            tags.extend(str(tag) for tag in extra_tags if tag)
        return list(dict.fromkeys(tags))

    def _build_tool_input_schema(self, route_meta: RouteMeta) -> dict[str, Any]:
        input_model = route_meta.input_model
        if input_model is None:
            return {"type": "object", "properties": {}, "required": []}
        if hasattr(input_model, "model_json_schema"):
            schema = input_model.model_json_schema()
            return {
                "type": "object",
                "properties": schema.get("properties", {}),
                "required": schema.get("required", []),
            }
        return {"type": "object", "properties": {}, "required": []}

    def _build_tool_response_schema(self, route_meta: RouteMeta) -> dict[str, Any] | None:
        output_model = route_meta.output_model
        if output_model is None:
            return None
        if hasattr(output_model, "model_json_schema"):
            return output_model.model_json_schema()
        return None

    def _matches_tool_query(
        self,
        tool: dict[str, Any],
        *,
        controller: str | None,
        tag: str | None,
        include_hidden: bool,
        safe_only: bool,
        long_running: bool,
    ) -> bool:
        if tool.get("hidden") and not include_hidden:
            return False
        if controller and tool.get("controller") != controller:
            return False
        tags = tool.get("tags") or []
        if tag and tag not in tags:
            return False
        if safe_only and tool.get("safe") is not True:
            return False
        if long_running and tool.get("longRunning") is not True:
            return False
        return True

    def _coerce_input(self, input_data: dict[str, Any], annotation: Any) -> Any:
        if annotation in {None, inspect.Signature.empty, Any}:
            return input_data
        annotation = self._prepare_annotation(annotation)
        input_data = coerce_dateish_for_annotation(input_data, annotation, self.options.input_coercers)
        adapter = self._fastapi["TypeAdapter"](annotation)
        return adapter.validate_python(input_data)

    def _coerce_output(self, value: Any, annotation: Any) -> Any:
        if annotation in {None, inspect.Signature.empty, Any}:
            return serialize_for_response(value, self.options.output_serializers)
        annotation = self._prepare_annotation(annotation)
        adapter = self._fastapi["TypeAdapter"](annotation)
        if self._is_pydantic_model(annotation):
            if hasattr(value, "model_dump") and callable(value.model_dump):
                value = value.model_dump()
            validated = adapter.validate_python(value)
            return serialize_for_response(validated.model_dump(), self.options.output_serializers)
        validated = adapter.validate_python(value)
        return serialize_for_response(validated, self.options.output_serializers)

    def _invoke_handler(
        self,
        bound_method: Any,
        params: list[inspect.Parameter],
        parsed_input: Any,
        ctx: RouteContext,
    ) -> Any:
        if not params:
            return bound_method()
        if len(params) == 1:
            return bound_method(ctx if self._is_context_parameter(params[0]) else parsed_input)

        args: list[Any] = []
        for param in params:
            if self._is_context_parameter(param):
                args.append(ctx)
            else:
                args.append(parsed_input)
        return bound_method(*args[: len(params)])

    def _is_context_parameter(self, param: inspect.Parameter) -> bool:
        annotation = param.annotation
        if annotation is RouteContext:
            return True
        return param.name in {"ctx", "context"}

    def _is_pydantic_model(self, annotation: Any) -> bool:
        base_model = self._fastapi["BaseModel"]
        return inspect.isclass(annotation) and issubclass(annotation, base_model)

    def _build_openapi_response_model(self, annotation: Any) -> Any:
        if annotation in {None, inspect.Signature.empty, Any}:
            return None
        annotation = self._prepare_annotation(annotation)
        if self._is_pydantic_model(annotation):
            return annotation
        root_model_base = self._fastapi["RootModel"]
        try:
            return root_model_base[annotation]
        except Exception:
            return None

    def _prepare_annotation(self, annotation: Any) -> Any:
        if self._is_pydantic_model(annotation):
            model_rebuild = getattr(annotation, "model_rebuild", None)
            if callable(model_rebuild):
                module = sys.modules.get(getattr(annotation, "__module__", ""))
                namespace = vars(module) if module is not None else None
                try:
                    if namespace is not None:
                        model_rebuild(force=True, _types_namespace=namespace)
                    else:
                        model_rebuild(force=True)
                except TypeError:
                    model_rebuild(force=True)
        return annotation

    def _validate_method_name(self, method_name: str, controller_name: str) -> None:
        if not method_name:
            return
        if method_name[0].isalpha() and method_name[0].isupper():
            raise ValueError(
                f"Method '{method_name}' in {controller_name} violates plat naming convention: method names must start with a lowercase letter."
            )
        if "_" in method_name:
            raise ValueError(
                f"Method '{method_name}' in {controller_name} violates plat naming convention: underscores are not allowed."
            )
        if method_name.lower() in RESERVED_METHOD_NAMES:
            raise ValueError(
                f"Method '{method_name}' in {controller_name} uses a reserved plat system name."
            )

    def _to_http_exception(self, exc: Exception):
        HTTPException = self._fastapi["HTTPException"]
        if isinstance(exc, HttpError):
            return HTTPException(status_code=exc.status_code, detail=exc.body)
        status_code = getattr(exc, "status_code", None) or getattr(exc, "status", None) or 500
        detail = self._build_error_response(exc, status_code)
        return HTTPException(status_code=status_code, detail=detail)

    def _build_error_response(self, exc: Exception, status_code: int) -> Any:
        if self.options.error_exposure == "none":
            return {"error": "Internal server error"}
        if self.options.error_exposure == "message":
            return {"error": str(exc) or "Internal server error"}
        return {
            "error": str(exc) or "Internal server error",
            "statusCode": status_code,
            "type": exc.__class__.__name__,
            **({"data": getattr(exc, "data")} if getattr(exc, "data", None) is not None else {}),
        }

    def _is_help_requested(self, request) -> bool:
        if "help" not in request.query_params:
            return False
        help_value = request.query_params.get("help")
        if help_value in (None, ""):
            return True
        return str(help_value).lower() in {"true", "t", "yes"}

    def _generate_route_help(self, method_name: str, full_path: str, route_meta: RouteMeta) -> dict[str, Any]:
        return {
            "help": {
                "method": route_meta.method or "GET",
                "path": full_path,
                "methodName": method_name,
                "auth": route_meta.auth or "public",
                "summary": route_meta.summary,
                "description": route_meta.description or "Route documentation",
                "inputModel": getattr(route_meta.input_model, "__name__", None),
                "outputModel": getattr(route_meta.output_model, "__name__", None),
                "opts": route_meta.opts,
            }
        }

    def _filter_routes(
        self,
        *,
        method: str | None = None,
        search: str | None = None,
        path: str | None = None,
    ) -> list[dict[str, str]]:
        filtered = list(self.routes)
        if method:
            filtered = [route for route in filtered if route["method"] == method.upper()]
        if search:
            needle = search.lower()
            filtered = [
                route
                for route in filtered
                if needle in route["path"].lower() or needle in route["methodName"].lower()
            ]
        if path:
            filtered = [route for route in filtered if route["path"].startswith(path)]
        return filtered

    def _format_route(self, route: dict[str, str]) -> str:
        return f"{route['method'].ljust(6)} {route['path']} - {route['methodName']}"

    def _apply_json_filter(self, obj: Any, filter_value: str) -> Any:
        if not filter_value or filter_value == ".":
            return obj
        current = obj
        for part in [piece for piece in filter_value.split(".") if piece]:
            if current is None:
                return None
            if part == "*":
                if isinstance(current, dict):
                    current = list(current.values())
                else:
                    return current
                continue
            if part == "[]":
                return current if isinstance(current, list) else [current]
            if part.startswith("[") and part.endswith("]") and part[1:-1].isdigit():
                index = int(part[1:-1])
                current = current[index] if isinstance(current, list) and len(current) > index else None
                continue
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
        return current

    def _print_startup_message(self, host: str, port: int) -> None:
        url = f"{self.options.protocol}://{host}:{port}"
        logger.info("plat Python server running at %s", url)
        if self.options.calls and isinstance(self.options.calls.get("path"), str):
            logger.info("  calls  %s%sStatus?id=...", url, self.options.calls["path"])
        if self.options.file_queue and self.options.file_queue is not False:
            logger.info("  queue  %s -> %s", self.options.file_queue.inbox, self.options.file_queue.outbox)
        for route in self.routes:
            logger.info("  %s %s", route["method"].ljust(6), route["path"])

    def _get_rate_limit_meta(self, route_meta: RouteMeta, controller_meta: ControllerMeta):
        route_value = (route_meta.opts or {}).get("rateLimit")
        controller_value = getattr(controller_meta, "rate_limit", None)
        return self._coerce_rate_limit_meta(route_value or controller_value)

    def _get_token_limit_meta(self, route_meta: RouteMeta, controller_meta: ControllerMeta):
        route_value = (route_meta.opts or {}).get("tokenLimit")
        controller_value = getattr(controller_meta, "token_limit", None)
        return self._coerce_token_limit_meta(route_value or controller_value)

    def _get_cache_meta(self, route_meta: RouteMeta, controller_meta: ControllerMeta):
        route_value = (route_meta.opts or {}).get("cache")
        controller_value = getattr(controller_meta, "cache", None)
        return self._coerce_cache_meta(route_value or controller_value)

    def _coerce_rate_limit_meta(self, value: Any):
        if value is None:
            return None
        if isinstance(value, list):
            return [self._coerce_rate_limit_entry(item) for item in value]
        return self._coerce_rate_limit_entry(value)

    def _coerce_token_limit_meta(self, value: Any):
        if value is None:
            return None
        if isinstance(value, list):
            return [self._coerce_token_limit_entry(item) for item in value]
        return self._coerce_token_limit_entry(value)

    def _coerce_cache_meta(self, value: Any):
        if value is None:
            return None
        if isinstance(value, list):
            return [self._coerce_cache_entry(item) for item in value]
        return self._coerce_cache_entry(value)

    def _coerce_rate_limit_entry(self, value: Any) -> RateLimitEntry:
        if isinstance(value, RateLimitEntry):
            return value
        data = dict(value)
        if isinstance(data.get("config"), dict):
            data["config"] = self._coerce_bucket_config(data["config"])
        return RateLimitEntry(
            key=data.get("key"),
            cost=data.get("cost"),
            config=data.get("config"),
        )

    def _coerce_token_limit_entry(self, value: Any) -> TokenLimitEntry:
        if isinstance(value, TokenLimitEntry):
            return value
        data = dict(value)
        if isinstance(data.get("config"), dict):
            data["config"] = self._coerce_bucket_config(data["config"])
        return TokenLimitEntry(
            key=data.get("key"),
            call_cost=data.get("callCost", data.get("call_cost")),
            response_cost=data.get("responseCost", data.get("response_cost")),
            failure_cost=data.get("failureCost", data.get("failure_cost")),
            config=data.get("config"),
        )

    def _coerce_cache_entry(self, value: Any) -> CacheEntry:
        if isinstance(value, CacheEntry):
            return value
        data = dict(value)
        return CacheEntry(
            key=data["key"],
            ttl=data.get("ttl"),
            methods=data.get("methods"),
        )

    def _coerce_bucket_config(self, value: Any) -> BucketConfig:
        if isinstance(value, BucketConfig):
            return value
        data = dict(value)
        return BucketConfig(
            max_balance=data["maxBalance"] if "maxBalance" in data else data["max_balance"],
            fill_interval=data["fillInterval"] if "fillInterval" in data else data["fill_interval"],
            fill_amount=data["fillAmount"] if "fillAmount" in data else data["fill_amount"],
            refunded_status_codes=data.get("refundedStatusCodes", data.get("refunded_status_codes")),
            refund_successful=data.get("refundSuccessful", data.get("refund_successful")),
            min_balance=data.get("minBalance", data.get("min_balance", 0)),
        )

    def _apply_response_headers(self, response: Any, ctx: RouteContext) -> None:
        cache_header_enabled = not self.options.cache or self.options.cache.get("cache_header", True) is not False
        if cache_header_enabled:
            cache_value = "true" if ctx.cache and ctx.cache.hit else "false"
            response.headers["X-Cache"] = cache_value
        token_header_enabled = not self.options.token_limit or self.options.token_limit.get("response_cost_header", True) is not False
        if token_header_enabled:
            total_cost = 0
            if ctx.token_limit and ctx.token_limit.response_costs:
                total_cost = sum(ctx.token_limit.response_costs)
            response.headers["X-Token-Cost"] = str(total_cost)


def create_server(options: PLATServerOptions | dict[str, Any] | None = None, *controller_classes: type[Any]) -> PLATServer:
    return PLATServer(options, *controller_classes)
