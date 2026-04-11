from __future__ import annotations

import ast
import inspect
import logging
import re
from dataclasses import dataclass, field
import time
import sys
from typing import Any, Awaitable, Callable, Literal, Mapping, get_args, get_origin, get_type_hints

from .decorators import ROUTE_METADATA_KEY
from .errors import HttpError
from .metadata import get_controller_meta
from .plugins import (
    BucketConfig,
    CacheEntry,
    CacheMeta,
    CacheContext,
    RateLimitContext,
    RateLimitEntry,
    RateLimitMeta,
    TokenLimitContext,
    TokenLimitEntry,
    TokenLimitMeta,
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
from .types import ControllerMeta, RouteContext, RouteMeta


UndecoratedMode = Literal["GET", "POST", "private"]
ServerMessage = Mapping[str, Any]
RESERVED_METHOD_NAMES = {"tools", "routes", "endpoints", "help", "openapi"}
LEGACY_PAYLOAD_PARAM_NAMES = {"input", "payload", "body", "data"}
PYTHON_BROWSER_STDLIB_MODULES = {
    "__future__",
    "abc",
    "argparse",
    "asyncio",
    "base64",
    "collections",
    "copy",
    "csv",
    "dataclasses",
    "datetime",
    "decimal",
    "enum",
    "functools",
    "hashlib",
    "itertools",
    "json",
    "logging",
    "math",
    "pathlib",
    "random",
    "re",
    "statistics",
    "string",
    "sys",
    "textwrap",
    "time",
    "typing",
    "uuid",
}


@dataclass(slots=True)
class BrowserPackagePlan:
    python_source: str
    requested_packages: list[str] = field(default_factory=list)
    imported_modules: list[str] = field(default_factory=list)
    import_rewrites: list[str] = field(default_factory=list)


@dataclass(slots=True)
class BrowserServerDefinition:
    server_name: str
    controllers: list[type[Any]]
    requested_packages: list[str] = field(default_factory=list)
    imported_modules: list[str] = field(default_factory=list)
    options: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class BrowserResolvedOperation:
    method_name: str
    method: str
    path: str
    bound_method: Any
    route_meta: RouteMeta
    controller_meta: ControllerMeta
    input_annotation: Any
    output_annotation: Any
    params: list[inspect.Parameter]


BrowserMiddlewareContext = dict[str, Any]
BrowserMiddleware = Callable[[BrowserMiddlewareContext, Callable[[], Awaitable[Any]]], Awaitable[Any] | Any]


class CallBridge:
    def __init__(self, emit=None):
        self._emit = emit

    def emit(self, event: str, data: Any) -> None:
        if callable(self._emit):
            self._emit({"event": event, "data": data})

    def progress(self, data: Any) -> None:
        self.emit("progress", data)

    def log(self, data: Any) -> None:
        self.emit("log", data)

    def chunk(self, data: Any) -> None:
        self.emit("chunk", data)

    def message(self, data: Any) -> None:
        self.emit("message", data)


class BrowserPLATServer:
    def __init__(
        self,
        options: Mapping[str, Any] | None = None,
        *controller_classes: type[Any],
        server_name: str | None = None,
        undecorated_mode: UndecoratedMode = "POST",
    ) -> None:
        self.options = dict(options or {})
        self.server_name = server_name or self.options.get("server_name") or "browser-python-server"
        self.undecorated_mode = cast_undecorated_mode(self.options.get("undecorated_mode"), undecorated_mode)
        self.logger = self.options.get("logger") or logging.getLogger("plat_browser.server")
        self.middleware: list[BrowserMiddleware] = list(self.options.get("middleware") or [])
        self.routes: list[dict[str, str]] = []
        self.tools: dict[str, dict[str, Any]] = {}
        self.operations_by_id: dict[str, BrowserResolvedOperation] = {}
        self.operations_by_route: dict[str, BrowserResolvedOperation] = {}
        self.registered_method_names: set[str] = set()
        self.registered_controller_names: set[str] = set()
        self._setup_policy_defaults()
        if controller_classes:
            self.register(*controller_classes)

    def use(self, middleware: BrowserMiddleware) -> "BrowserPLATServer":
        self.middleware.append(middleware)
        return self

    @property
    def openapi(self) -> dict[str, Any]:
        return self.generate_openapi()

    def _setup_policy_defaults(self) -> None:
        if self.options.get("rate_limit") is not None and not self.options["rate_limit"].get("controller"):
            self.options["rate_limit"]["controller"] = create_in_memory_rate_limit()
        if self.options.get("token_limit") is not None and not self.options["token_limit"].get("controller"):
            self.options["token_limit"]["controller"] = create_in_memory_token_limit()
        if self.options.get("cache") is not None and not self.options["cache"].get("controller"):
            self.options["cache"]["controller"] = create_in_memory_cache()

    def register(self, *controller_classes: type[Any]) -> "BrowserPLATServer":
        for controller_class in controller_classes:
            meta = get_controller_meta(controller_class) or ControllerMeta(
                base_path=controller_class.__name__,
                tag=controller_class.__name__,
            )
            instance = controller_class()
            controller_tag = meta.tag or meta.base_path or controller_class.__name__
            lower_controller_tag = controller_tag.lower()
            if lower_controller_tag in RESERVED_METHOD_NAMES:
                raise ValueError(f"Controller '{controller_tag}' uses a reserved plat system name.")
            if controller_tag in self.registered_method_names:
                raise ValueError(f"Controller '{controller_tag}' conflicts with an existing method name.")
            self.registered_controller_names.add(controller_tag)

            methods = inspect.getmembers(controller_class, predicate=inspect.isfunction)
            for method_name, method_fn in methods:
                route_meta = getattr(method_fn, ROUTE_METADATA_KEY, None)
                if route_meta is None:
                    route_meta = self._build_implicit_route_meta(method_name)
                    if route_meta is None:
                        continue
                self._hydrate_route_meta(route_meta, method_fn)
                self._validate_method_name(method_name, controller_class.__name__)
                if method_name in self.registered_controller_names:
                    raise ValueError(f"Method '{method_name}' in {controller_class.__name__} conflicts with controller name '{method_name}'.")
                if method_name in self.registered_method_names:
                    raise ValueError(f'Duplicate operationId: method "{method_name}" is defined in multiple controllers.')
                self.registered_method_names.add(method_name)

                bound_method = getattr(instance, method_name)
                full_path = route_meta.path or f"/{method_name}"
                operation = BrowserResolvedOperation(
                    method_name=method_name,
                    method=(route_meta.method or "POST").upper(),
                    path=full_path,
                    bound_method=bound_method,
                    route_meta=route_meta,
                    controller_meta=meta,
                    input_annotation=route_meta.input_model,
                    output_annotation=route_meta.output_model,
                    params=list(inspect.signature(method_fn).parameters.values())[1:],
                )
                self.operations_by_id[method_name] = operation
                self.operations_by_route[f"{operation.method} {operation.path}"] = operation
                self.routes.append({"method": operation.method, "path": operation.path, "methodName": method_name})
                self.tools[method_name] = {
                    "name": method_name,
                    "summary": route_meta.summary,
                    "description": route_meta.description or f"{operation.method} {full_path}",
                    "method": operation.method,
                    "path": full_path,
                    "controller": controller_tag,
                    "tags": [controller_tag],
                    "input_schema": self._build_schema(route_meta.input_model),
                    "response_schema": self._build_schema(route_meta.output_model),
                }
        return self

    def generate_openapi(self) -> dict[str, Any]:
        paths: dict[str, dict[str, Any]] = {}
        for operation in self.operations_by_id.values():
            path_item = paths.setdefault(operation.path, {})
            entry: dict[str, Any] = {
                "operationId": operation.method_name,
                "summary": operation.route_meta.summary,
                "description": operation.route_meta.description,
                "responses": {"200": {"description": "ok"}},
            }
            input_schema = self._build_schema(operation.input_annotation)
            if input_schema is not None:
                entry["requestBody"] = {
                    "required": True,
                    "content": {"application/json": {"schema": input_schema}},
                }
            response_schema = self._build_schema(operation.output_annotation)
            if response_schema is not None:
                entry["responses"]["200"]["content"] = {"application/json": {"schema": response_schema}}
            path_item[operation.method.lower()] = trim_none(entry)
        return {
            "openapi": "3.1.0",
            "info": {"title": "plat browser python server", "version": "0.1.0"},
            "paths": paths,
        }

    async def handle_request(self, message: ServerMessage, emit=None) -> Any:
        message = normalize_server_message(message)
        operation = self._resolve_operation(
            operation_id=coerce_str(message.get("operationId")),
            method=coerce_str(message.get("method")) or "POST",
            path=coerce_str(message.get("path")) or "",
        )
        if operation is None:
            raise KeyError("No browser operation matched the incoming request.")

        payload = (
            message.get("input")
            if "input" in message
            else message.get("body")
            if "body" in message
            else message.get("params")
            if "params" in message
            else {}
        )
        ctx = RouteContext(
            method=operation.method,
            url=operation.path,
            headers=dict(message.get("headers") or {}),
            call=CallBridge(emit),
            opts={"transport": "browser-python"},
            request=dict(message),
        )
        status_code = 200
        rate_limit_entries = []
        token_limit_entries = []
        token_limit_start_ms = int(time.time() * 1000)
        handler_called = False
        on_request = self.options.get("on_request") or self.options.get("onRequest")
        on_response = self.options.get("on_response") or self.options.get("onResponse")
        on_error = self.options.get("on_error") or self.options.get("onError")
        if callable(on_request):
            maybe = on_request(message, ctx)
            if inspect.isawaitable(maybe):
                await maybe
        auth_mode = operation.route_meta.auth or operation.controller_meta.auth or self.options.get("default_auth")
        auth_handler = self.options.get("auth")
        if auth_mode and auth_handler and callable(auth_handler.get("verify")):
            auth_result = auth_handler["verify"](auth_mode, message, ctx)
            if inspect.isawaitable(auth_result):
                auth_result = await auth_result
            ctx.auth = auth_result
        rate_limit_meta = self._get_rate_limit_meta(operation.route_meta, operation.controller_meta)
        if rate_limit_meta is not None and self.options.get("rate_limit", {}).get("controller"):
            entries, balances = apply_rate_limit_check(
                rate_limit_meta,
                self.options["rate_limit"]["controller"],
                self.options["rate_limit"].get("configs", {}),
                operation.method_name,
                operation.controller_meta.base_path,
                ctx.auth,
            )
            rate_limit_entries = entries
            ctx.rate_limit = RateLimitContext(entries=entries, remaining_balances=balances)
        token_limit_meta = self._get_token_limit_meta(operation.route_meta, operation.controller_meta)
        if token_limit_meta is not None and self.options.get("token_limit", {}).get("controller"):
            entries, balances = apply_token_limit_check(
                token_limit_meta,
                self.options["token_limit"]["controller"],
                self.options["token_limit"].get("configs", {}),
                operation.method_name,
                operation.controller_meta.base_path,
                payload,
                ctx,
                ctx.auth,
            )
            token_limit_entries = entries
            ctx.token_limit = TokenLimitContext(entries=entries, remaining_balances=balances)
        cache_key = None
        cache_entry = None
        cache_meta = self._get_cache_meta(operation.route_meta, operation.controller_meta)
        if cache_meta is not None and self.options.get("cache", {}).get("controller"):
            cache_key, hit, cached_value, cache_entry = apply_cache_check(
                cache_meta,
                self.options["cache"]["controller"],
                dict(payload) if isinstance(payload, Mapping) else {},
                operation.method,
                operation.method_name,
                operation.controller_meta.base_path,
                ctx.auth,
            )
            ctx.cache = CacheContext(key=cache_key, hit=hit, stored=False)
            if hit:
                return cached_value
        middleware_context: BrowserMiddlewareContext = {
            "request": dict(message),
            "operation": operation,
            "ctx": ctx,
            "input": payload,
            "logger": self.logger,
        }
        try:
            handler_called = True
            result = await self._run_middleware_chain(
                middleware_context,
                lambda: self._invoke_handler(operation.bound_method, operation.params, payload, ctx),
            )
            if token_limit_entries and self.options.get("token_limit", {}).get("controller"):
                timing = TokenLimitTiming(
                    start_ms=token_limit_start_ms,
                    end_ms=int(time.time() * 1000),
                    duration_ms=max(0, int(time.time() * 1000) - token_limit_start_ms),
                )
                response_costs = apply_token_limit_response(
                    token_limit_entries,
                    self.options["token_limit"]["controller"],
                    result,
                    timing,
                    payload,
                    status_code,
                )
                if ctx.token_limit:
                    ctx.token_limit.timing = timing
                    ctx.token_limit.response_costs = response_costs
            if rate_limit_entries and self.options.get("rate_limit", {}).get("controller"):
                apply_rate_limit_refund(rate_limit_entries, self.options["rate_limit"]["controller"], status_code)
            if cache_entry is not None and self.options.get("cache", {}).get("controller"):
                apply_cache_store(cache_key, cache_entry, self.options["cache"]["controller"], result)
                if ctx.cache:
                    ctx.cache.stored = True
            if callable(on_response):
                maybe = on_response(message, ctx, result)
                if inspect.isawaitable(maybe):
                    await maybe
            return result
        except Exception as error:
            status_code = getattr(error, "status_code", 500)
            if token_limit_entries and self.options.get("token_limit", {}).get("controller") and handler_called:
                timing = TokenLimitTiming(
                    start_ms=token_limit_start_ms,
                    end_ms=int(time.time() * 1000),
                    duration_ms=max(0, int(time.time() * 1000) - token_limit_start_ms),
                )
                failure_costs = apply_token_limit_failure(
                    token_limit_entries,
                    self.options["token_limit"]["controller"],
                    error,
                    timing,
                    payload,
                    status_code,
                )
                if ctx.token_limit:
                    ctx.token_limit.timing = timing
                    ctx.token_limit.failure_costs = failure_costs
            if rate_limit_entries and self.options.get("rate_limit", {}).get("controller"):
                apply_rate_limit_refund(rate_limit_entries, self.options["rate_limit"]["controller"], status_code)
            self.logger.error("BrowserPLATServer request failed", exc_info=error)
            if callable(on_error):
                maybe = on_error(message, ctx, error)
                if inspect.isawaitable(maybe):
                    await maybe
            raise

    def _resolve_operation(self, *, operation_id: str | None, method: str, path: str) -> BrowserResolvedOperation | None:
        if operation_id and operation_id in self.operations_by_id:
            return self.operations_by_id[operation_id]
        return self.operations_by_route.get(f"{method.upper()} {path}")

    async def _run_middleware_chain(
        self,
        context: BrowserMiddlewareContext,
        final_handler: Callable[[], Any],
    ) -> Any:
        index = -1

        async def dispatch(next_index: int) -> Any:
            nonlocal index
            if next_index <= index:
                raise RuntimeError("Browser middleware called next() multiple times")
            index = next_index
            if next_index >= len(self.middleware):
                result = final_handler()
                if inspect.isawaitable(result):
                    return await result
                return result
            middleware = self.middleware[next_index]
            result = middleware(context, lambda: dispatch(next_index + 1))
            if inspect.isawaitable(result):
                return await result
            return result

        return await dispatch(0)

    def _invoke_handler(self, bound_method: Any, params: list[inspect.Parameter], parsed_input: Any, ctx: RouteContext) -> Any:
        if not params:
            return bound_method()
        non_context_params = [param for param in params if not self._is_context_parameter(param)]
        use_legacy_payload_param = (
            len(non_context_params) == 1
            and non_context_params[0].name in LEGACY_PAYLOAD_PARAM_NAMES
        )
        is_mapping_payload = isinstance(parsed_input, Mapping)

        if len(params) == 1:
            only_param = params[0]
            if self._is_context_parameter(only_param):
                return bound_method(ctx)
            if use_legacy_payload_param or not is_mapping_payload:
                return bound_method(parsed_input)
            if only_param.kind is inspect.Parameter.VAR_KEYWORD:
                return bound_method(**dict(parsed_input))
            return bound_method(**{only_param.name: parsed_input.get(only_param.name, parsed_input)})

        args: list[Any] = []
        kwargs: dict[str, Any] = {}
        payload_mapping = dict(parsed_input) if is_mapping_payload else {}

        for param in params:
            if self._is_context_parameter(param):
                if param.kind is inspect.Parameter.POSITIONAL_ONLY:
                    args.append(ctx)
                else:
                    kwargs[param.name] = ctx
                continue

            if use_legacy_payload_param:
                if param.kind is inspect.Parameter.POSITIONAL_ONLY:
                    args.append(parsed_input)
                else:
                    kwargs[param.name] = parsed_input
                continue

            if param.kind is inspect.Parameter.VAR_KEYWORD:
                kwargs.update(payload_mapping)
                continue

            if not is_mapping_payload:
                if param.kind is inspect.Parameter.POSITIONAL_ONLY:
                    args.append(parsed_input)
                else:
                    kwargs[param.name] = parsed_input
                continue

            if param.name not in payload_mapping:
                continue

            if param.kind is inspect.Parameter.POSITIONAL_ONLY:
                args.append(payload_mapping[param.name])
            else:
                kwargs[param.name] = payload_mapping[param.name]

        return bound_method(*args, **kwargs)

    def _is_context_parameter(self, param: inspect.Parameter) -> bool:
        return param.annotation is RouteContext or param.name in {"ctx", "context"}

    def _build_implicit_route_meta(self, method_name: str) -> RouteMeta | None:
        if self.undecorated_mode == "private" or method_name.startswith("_"):
            return None
        return RouteMeta(name=method_name, method=self.undecorated_mode, path=f"/{method_name}")

    def _hydrate_route_meta(self, route_meta: RouteMeta, method_fn: Any) -> None:
        signature = inspect.signature(method_fn)
        params = list(signature.parameters.values())[1:]
        module = sys.modules.get(getattr(method_fn, "__module__", ""))
        try:
          resolved_hints = get_type_hints(
              method_fn,
              globalns=vars(module) if module is not None else None,
          )
        except Exception:
          resolved_hints = {}
        input_params = [
            param.replace(annotation=resolved_hints.get(param.name, param.annotation))
            for param in params
            if not self._is_context_parameter(param)
        ]
        route_meta.input_model = build_input_model_from_params(input_params)
        route_meta.output_model = resolved_hints.get("return", signature.return_annotation)
        if route_meta.path is None:
            route_meta.path = f"/{route_meta.name}"
        if route_meta.method is None:
            route_meta.method = self.undecorated_mode if self.undecorated_mode != "private" else "POST"
        docstring = inspect.getdoc(method_fn)
        if docstring and not route_meta.summary:
            first_line, *_ = docstring.splitlines()
            route_meta.summary = first_line.strip() or None
            if len(docstring.splitlines()) > 1 and not route_meta.description:
                route_meta.description = docstring.strip()

    def _validate_method_name(self, method_name: str, controller_name: str) -> None:
        if not method_name:
            return
        if method_name[0].isalpha() and method_name[0].isupper():
            raise ValueError(f"Method '{method_name}' in {controller_name} violates plat naming convention: method names must start with a lowercase letter.")
        if "_" in method_name:
            raise ValueError(f"Method '{method_name}' in {controller_name} violates plat naming convention: underscores are not allowed.")
        if method_name.lower() in RESERVED_METHOD_NAMES:
            raise ValueError(f"Method '{method_name}' in {controller_name} uses a reserved plat system name.")

    def _build_schema(self, annotation: Any) -> dict[str, Any] | None:
        if isinstance(annotation, dict) and "type" in annotation:
            return annotation
        if annotation in {None, inspect.Signature.empty, Any}:
            return None
        return annotation_to_schema(annotation)

    def _get_rate_limit_meta(self, route_meta: RouteMeta, controller_meta: ControllerMeta):
        route_value = (route_meta.opts or {}).get("rateLimit", route_meta.rate_limit)
        controller_value = getattr(controller_meta, "rate_limit", None)
        return self._coerce_rate_limit_meta(route_value or controller_value)

    def _get_token_limit_meta(self, route_meta: RouteMeta, controller_meta: ControllerMeta):
        route_value = (route_meta.opts or {}).get("tokenLimit", route_meta.token_limit)
        controller_value = getattr(controller_meta, "token_limit", None)
        return self._coerce_token_limit_meta(route_value or controller_value)

    def _get_cache_meta(self, route_meta: RouteMeta, controller_meta: ControllerMeta):
        route_value = (route_meta.opts or {}).get("cache", route_meta.cache)
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


def create_browser_server(
    options: Mapping[str, Any] | None = None,
    *controller_classes: type[Any],
    server_name: str | None = None,
    undecorated_mode: UndecoratedMode = "POST",
) -> BrowserPLATServer:
    return BrowserPLATServer(options, *controller_classes, server_name=server_name, undecorated_mode=undecorated_mode)


# Server-style parity alias.
create_server = create_browser_server


def serve_client_side_server(
    server_name: str,
    controllers: list[type[Any]] | tuple[type[Any], ...],
    **options: Any,
) -> BrowserServerDefinition:
    definition = BrowserServerDefinition(
        server_name=server_name,
        controllers=list(controllers),
        requested_packages=list(options.pop("requested_packages", []) or []),
        imported_modules=list(options.pop("imported_modules", []) or []),
        options=dict(options),
    )
    frame = inspect.currentframe()
    caller_globals = frame.f_back.f_globals if frame and frame.f_back else None
    if isinstance(caller_globals, dict):
        caller_globals["__plat_browser_server_definition__"] = definition
        caller_globals.setdefault("client_side_server", definition)
    return definition


# Server-style parity alias.
serve_server = serve_client_side_server


def prepare_python_source(source: str) -> BrowserPackagePlan:
    requested_packages: list[str] = []
    rewrites: list[str] = []
    python_lines: list[str] = []
    for raw_line in source.splitlines():
        stripped = raw_line.strip()
        if stripped.startswith("!pip install "):
            package_args = stripped[len("!pip install ") :].strip().split()
            requested_packages.extend(arg for arg in package_args if arg and not arg.startswith("-"))
            continue
        fixed_line, note = _rewrite_server_side_import_for_browser(raw_line)
        if note is not None:
            rewrites.append(note)
        python_lines.append(fixed_line)
    python_source = "\n".join(python_lines)
    imported_modules = [
        module
        for module in detect_imports(python_source)
        if module not in PYTHON_BROWSER_STDLIB_MODULES and module != "plat" and module != "plat_browser"
    ]
    return BrowserPackagePlan(
        python_source=python_source,
        requested_packages=dedupe_keep_order(requested_packages),
        imported_modules=dedupe_keep_order(imported_modules),
        import_rewrites=rewrites,
    )


def _rewrite_server_side_import_for_browser(raw_line: str) -> tuple[str, str | None]:
    """
    Best-effort autofix for browser runtime code that accidentally imports from `plat`.
    Rewrites imports to `plat_browser` while preserving alias style where possible.
    """
    from_import = re.match(r"^(\s*)from\s+plat\s+import\s+(.+?)\s*$", raw_line)
    if from_import:
        indent = from_import.group(1)
        names = from_import.group(2)
        fixed = f"{indent}from plat_browser import {names}"
        return fixed, "rewrote: from plat import ... -> from plat_browser import ..."

    import_alias = re.match(r"^(\s*)import\s+plat\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$", raw_line)
    if import_alias:
        indent = import_alias.group(1)
        alias = import_alias.group(2)
        fixed = f"{indent}import plat_browser as {alias}"
        return fixed, "rewrote: import plat as ... -> import plat_browser as ..."

    import_plain = re.match(r"^(\s*)import\s+plat\s*$", raw_line)
    if import_plain:
        indent = import_plain.group(1)
        fixed = f"{indent}import plat_browser as plat"
        return fixed, "rewrote: import plat -> import plat_browser as plat"

    return raw_line, None


def detect_imports(source: str) -> list[str]:
    tree = ast.parse(source)
    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.append(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                modules.append(node.module.split(".")[0])
    return dedupe_keep_order(modules)


def annotation_to_schema(annotation: Any) -> dict[str, Any]:
    origin = get_origin(annotation)
    args = get_args(annotation)
    if annotation is str:
        return {"type": "string"}
    if annotation is int:
        return {"type": "integer"}
    if annotation is float:
        return {"type": "number"}
    if annotation is bool:
        return {"type": "boolean"}
    if annotation in {dict, Mapping}:
        return {"type": "object", "additionalProperties": True}
    if annotation in {list, tuple}:
        return {"type": "array", "items": {}}
    if origin is Literal:
        values = list(args)
        schema: dict[str, Any] = {"enum": values}
        if values:
            schema.update(annotation_to_schema(type(values[0])))
        return schema
    if origin in {list, tuple}:
        item_annotation = args[0] if args else Any
        return {"type": "array", "items": annotation_to_schema(item_annotation)}
    if origin in {dict, Mapping}:
        value_annotation = args[1] if len(args) > 1 else Any
        return {"type": "object", "additionalProperties": annotation_to_schema(value_annotation) if value_annotation is not Any else True}
    if origin is not None and str(origin) == "typing.Union":
        variants = [annotation_to_schema(arg) for arg in args if arg is not type(None)]
        if len(variants) == 1:
            schema = variants[0]
            if len(args) != len(variants):
                schema = {**schema, "nullable": True}
            return schema
        return {"anyOf": variants}
    if hasattr(annotation, "__annotations__") and isinstance(getattr(annotation, "__annotations__"), dict):
        return typed_mapping_schema(annotation.__annotations__)
    return {"type": "object", "additionalProperties": True}


def build_input_model_from_params(params: list[inspect.Parameter]) -> Any:
    if not params:
        return None
    if len(params) == 1 and params[0].name in LEGACY_PAYLOAD_PARAM_NAMES:
        return params[0].annotation

    properties: dict[str, Any] = {}
    required: list[str] = []
    for param in params:
        if param.kind is inspect.Parameter.VAR_POSITIONAL:
            continue
        if param.kind is inspect.Parameter.VAR_KEYWORD:
            return {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": True,
            }
        annotation = param.annotation
        properties[param.name] = annotation_to_schema(annotation) if annotation is not inspect.Signature.empty else {"type": "object", "additionalProperties": True}
        if param.default is inspect.Signature.empty:
            required.append(param.name)

    return {
        "type": "object",
        "properties": properties,
        "required": required,
    }


def typed_mapping_schema(annotations: Mapping[str, Any]) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    required: list[str] = []
    for key, value in annotations.items():
        properties[key] = annotation_to_schema(value)
        required.append(key)
    return {"type": "object", "properties": properties, "required": required}


def dedupe_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped


def trim_none(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: trim_none(inner) for key, inner in value.items() if inner is not None}
    if isinstance(value, list):
        return [trim_none(item) for item in value]
    return value


def coerce_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def cast_undecorated_mode(value: Any, fallback: UndecoratedMode) -> UndecoratedMode:
    if value in {"GET", "POST", "private"}:
        return value
    return fallback


def normalize_server_message(message: Any) -> dict[str, Any]:
    if isinstance(message, dict):
        return message
    if isinstance(message, Mapping):
        return dict(message)

    to_py = getattr(message, "to_py", None)
    if callable(to_py):
        try:
            converted = to_py()
        except TypeError:
            converted = to_py(depth=-1)
        return normalize_server_message(converted)

    keys = ("operationId", "method", "path", "input", "body", "params", "headers")
    normalized: dict[str, Any] = {}
    for key in keys:
        value = None
        if hasattr(message, key):
            value = getattr(message, key)
        else:
            try:
                value = message[key]
            except Exception:
                value = None
        if value is not None:
            normalized[key] = value
    return normalized
