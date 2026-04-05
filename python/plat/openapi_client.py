from __future__ import annotations

import asyncio
import inspect
import json
import os
import queue
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Generic, Mapping, TypeVar
from urllib.parse import quote, urlparse

from .client import AsyncClient, SyncClient
from .file_transport_plugin import create_file_transport_plugin
from .http_transport_plugin import create_http_transport_plugin, HTTPTransportConfig
from .css_transport_plugin import CSSTransportConfig, create_css_transport_plugin, fetch_client_side_server_openapi
from .rpc import DEFAULT_RPC_PATH
from .rpc_transport_plugin import create_rpc_transport_plugin
from .response_serialize import serialize_for_response
from .tools import extract_tools_from_openapi
from .transport_plugin import TransportRequest, execute_transport_plugin


HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}
T = TypeVar("T")
RPCEventHandler = Callable[[dict[str, Any]], Any]


@dataclass
class DeferredCallSnapshot:
    id: str
    status: str
    created_at: str
    updated_at: str
    completed_at: str | None = None
    status_code: int | None = None
    result: Any = None
    error: dict[str, Any] | None = None


class DeferredCallHandle(Generic[T]):
    def __init__(self, client: "OpenAPISyncClient", call_id: str, *, poll_interval: float = 1.0) -> None:
        self._client = client
        self.id = call_id
        self._poll_interval = poll_interval

    def status(self) -> DeferredCallSnapshot:
        payload = self._client._request("GET", f"{self._client.calls_path}Status", params={"id": self.id})
        return DeferredCallSnapshot(
            id=payload["id"],
            status=payload["status"],
            created_at=payload["createdAt"],
            updated_at=payload["updatedAt"],
            completed_at=payload.get("completedAt"),
            status_code=payload.get("statusCode"),
            result=payload.get("result"),
            error=payload.get("error"),
        )

    def ready(self) -> bool:
        return self.status().status in {"completed", "failed", "cancelled"}

    def events(self, *, since: int = 0, event: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"id": self.id, "since": since}
        if event is not None:
            params["event"] = event
        payload = self._client._request("GET", f"{self._client.calls_path}Events", params=params)
        return list(payload.get("events", []))

    def logs(self, *, since: int = 0) -> list[dict[str, Any]]:
        return self.events(since=since, event="log")

    def result(self) -> T:
        payload = self._client._request("GET", f"{self._client.calls_path}Result", params={"id": self.id})
        status = payload["status"]
        if status == "completed":
            return payload.get("result")
        if status == "failed":
            raise RuntimeError((payload.get("error") or {}).get("message", "Deferred call failed"))
        if status == "cancelled":
            raise RuntimeError("Deferred call was cancelled")
        raise RuntimeError(f"Deferred call {self.id} is still {status}")

    def wait(self, timeout: float | None = None, poll_interval: float | None = None) -> T:
        interval = self._poll_interval if poll_interval is None else poll_interval
        started = time.monotonic()
        while True:
            payload = self._client._request("GET", f"{self._client.calls_path}Result", params={"id": self.id})
            snapshot = DeferredCallSnapshot(
                id=payload["id"],
                status=payload["status"],
                created_at=payload["createdAt"],
                updated_at=payload["updatedAt"],
                completed_at=payload.get("completedAt"),
                status_code=payload.get("statusCode"),
                result=payload.get("result"),
                error=payload.get("error"),
            )
            if snapshot.status == "completed":
                return snapshot.result
            if snapshot.status == "failed":
                raise RuntimeError((snapshot.error or {}).get("message", "Deferred call failed"))
            if snapshot.status == "cancelled":
                raise RuntimeError("Deferred call was cancelled")
            if timeout is not None and time.monotonic() - started >= timeout:
                raise TimeoutError(f"Deferred call {self.id} did not complete within {timeout} seconds")
            time.sleep(interval)

    def cancel(self) -> bool:
        payload = self._client._request("POST", f"{self._client.calls_path}Cancel", json={"id": self.id})
        return bool(payload.get("cancelled"))


class AsyncDeferredCallHandle(Generic[T]):
    def __init__(self, client: "OpenAPIAsyncClient", call_id: str, *, poll_interval: float = 1.0) -> None:
        self._client = client
        self.id = call_id
        self._poll_interval = poll_interval

    async def status(self) -> DeferredCallSnapshot:
        payload = await self._client._request("GET", f"{self._client.calls_path}Status", params={"id": self.id})
        return DeferredCallSnapshot(
            id=payload["id"],
            status=payload["status"],
            created_at=payload["createdAt"],
            updated_at=payload["updatedAt"],
            completed_at=payload.get("completedAt"),
            status_code=payload.get("statusCode"),
            result=payload.get("result"),
            error=payload.get("error"),
        )

    async def ready(self) -> bool:
        return (await self.status()).status in {"completed", "failed", "cancelled"}

    async def events(self, *, since: int = 0, event: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"id": self.id, "since": since}
        if event is not None:
            params["event"] = event
        payload = await self._client._request("GET", f"{self._client.calls_path}Events", params=params)
        return list(payload.get("events", []))

    async def logs(self, *, since: int = 0) -> list[dict[str, Any]]:
        return await self.events(since=since, event="log")

    async def result(self) -> T:
        payload = await self._client._request("GET", f"{self._client.calls_path}Result", params={"id": self.id})
        status = payload["status"]
        if status == "completed":
            return payload.get("result")
        if status == "failed":
            raise RuntimeError((payload.get("error") or {}).get("message", "Deferred call failed"))
        if status == "cancelled":
            raise RuntimeError("Deferred call was cancelled")
        raise RuntimeError(f"Deferred call {self.id} is still {status}")

    async def wait(self, timeout: float | None = None, poll_interval: float | None = None) -> T:
        interval = self._poll_interval if poll_interval is None else poll_interval
        started = time.monotonic()
        while True:
            payload = await self._client._request("GET", f"{self._client.calls_path}Result", params={"id": self.id})
            snapshot = DeferredCallSnapshot(
                id=payload["id"],
                status=payload["status"],
                created_at=payload["createdAt"],
                updated_at=payload["updatedAt"],
                completed_at=payload.get("completedAt"),
                status_code=payload.get("statusCode"),
                result=payload.get("result"),
                error=payload.get("error"),
            )
            if snapshot.status == "completed":
                return snapshot.result
            if snapshot.status == "failed":
                raise RuntimeError((snapshot.error or {}).get("message", "Deferred call failed"))
            if snapshot.status == "cancelled":
                raise RuntimeError("Deferred call was cancelled")
            if timeout is not None and time.monotonic() - started >= timeout:
                raise TimeoutError(f"Deferred call {self.id} did not complete within {timeout} seconds")
            await asyncio.sleep(interval)

    async def cancel(self) -> bool:
        payload = await self._client._request("POST", f"{self._client.calls_path}Cancel", json={"id": self.id})
        return bool(payload.get("cancelled"))


class PLATPromise(Generic[T]):
    def __init__(self) -> None:
        self._queue: "queue.Queue[tuple[str, Any]]" = queue.Queue(maxsize=1)
        self._cached: tuple[str, Any] | None = None

    def _resolve(self, value: T) -> None:
        if self._cached is None:
            self._queue.put(("result", value))

    def _reject(self, error: BaseException) -> None:
        if self._cached is None:
            self._queue.put(("error", error))

    def ready(self) -> bool:
        return self._cached is not None or not self._queue.empty()

    def wait(self, timeout: float | None = None) -> T:
        if self._cached is None:
            self._cached = self._queue.get(timeout=timeout)
        kind, value = self._cached
        if kind == "error":
            raise value
        return value

    def result(self, timeout: float | None = None) -> T:
        return self.wait(timeout=timeout)


@dataclass
class OpenAPIOperation:
    operation_id: str
    method: str
    path: str
    parameters: list[dict[str, Any]]
    request_body_schema: dict[str, Any] | None
    response_schema: dict[str, Any] | None
    input_aliases: dict[str, str]


def load_openapi_spec(spec_or_source: str | Path | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(spec_or_source, Mapping):
        return dict(spec_or_source)

    source = str(spec_or_source)
    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        import httpx

        response = httpx.get(source, timeout=30.0)
        response.raise_for_status()
        text = response.text
    else:
        text = Path(source).read_text(encoding="utf-8")

    stripped = text.lstrip()
    if stripped.startswith("{"):
        return json.loads(text)

    try:
        import yaml
    except ImportError as exc:
        raise ImportError("PyYAML is required to load YAML OpenAPI specs.") from exc

    parsed_yaml = yaml.safe_load(text)
    if not isinstance(parsed_yaml, dict):
        raise TypeError("Expected the OpenAPI document to parse to a dictionary.")
    return parsed_yaml


def create_openapi_client(
    spec_or_source: str | Path | Mapping[str, Any],
    base_url: str | None = None,
    calls_path: str = "/platCall",
    css_options: dict[str, Any] | None = None,
    **kwargs: Any,
) -> "OpenAPISyncClient":
    spec = load_openapi_spec(spec_or_source)
    return OpenAPISyncClient(spec, base_url=base_url, calls_path=calls_path, css_options=css_options, **kwargs)


def create_async_openapi_client(
    spec_or_source: str | Path | Mapping[str, Any],
    base_url: str | None = None,
    calls_path: str = "/platCall",
    css_options: dict[str, Any] | None = None,
    **kwargs: Any,
) -> "OpenAPIAsyncClient":
    spec = load_openapi_spec(spec_or_source)
    return OpenAPIAsyncClient(spec, base_url=base_url, calls_path=calls_path, css_options=css_options, **kwargs)


def create_promise_openapi_client(
    spec_or_source: str | Path | Mapping[str, Any],
    base_url: str | None = None,
    calls_path: str = "/platCall",
    css_options: dict[str, Any] | None = None,
    **kwargs: Any,
) -> "OpenAPIPromiseClient":
    spec = load_openapi_spec(spec_or_source)
    return OpenAPIPromiseClient(spec, base_url=base_url, calls_path=calls_path, css_options=css_options, **kwargs)


def connect_client_side_server(
    base_url: str,
    *,
    calls_path: str = "/platCall",
    css_options: dict[str, Any] | None = None,
    **kwargs: Any,
) -> "OpenAPISyncClient":
    spec = asyncio.run(fetch_client_side_server_openapi(base_url, css_options=css_options))
    return OpenAPISyncClient(spec, base_url=base_url, calls_path=calls_path, css_options=css_options, **kwargs)


async def connect_async_client_side_server(
    base_url: str,
    *,
    calls_path: str = "/platCall",
    css_options: dict[str, Any] | None = None,
    **kwargs: Any,
) -> "OpenAPIAsyncClient":
    spec = await fetch_client_side_server_openapi(base_url, css_options=css_options)
    return OpenAPIAsyncClient(spec, base_url=base_url, calls_path=calls_path, css_options=css_options, **kwargs)


class _OpenAPIClientMixin:
    def __init__(
        self,
        spec: Mapping[str, Any],
        base_url: str | None = None,
        *,
        calls_path: str = "/platCall",
        css_options: dict[str, Any] | None = None,
    ) -> None:
        self._openapi_spec = dict(spec)
        self._operations = _extract_operations(self._openapi_spec)
        self._operations_by_id = {operation.operation_id: operation for operation in self._operations}
        self._operations_by_snake = {_to_snake_case(operation.operation_id): operation for operation in self._operations}
        self._default_base_url = base_url or self._openapi_spec.get("servers", [{}])[0].get("url", "http://localhost:3000")
        self.calls_path = calls_path
        self._css_options = dict(css_options or {})
        self._file_poll_interval = 0.1
        self._transport_plugins: list[Any] = []
        self._cached_tools: list[dict[str, Any]] | None = None

    @property
    def openapi(self) -> dict[str, Any]:
        return self._openapi_spec

    @property
    def operations(self) -> list[OpenAPIOperation]:
        return list(self._operations)

    @property
    def tools(self) -> list[dict[str, Any]]:
        if self._cached_tools is None:
            self._cached_tools = extract_tools_from_openapi(self._openapi_spec)
        return list(self._cached_tools)

    def get_operation(self, operation_id: str) -> OpenAPIOperation:
        operation = self._operations_by_id.get(operation_id) or self._operations_by_snake.get(operation_id)
        if operation is None:
            raise AttributeError(f"Unknown OpenAPI operation: {operation_id}")
        return operation

    def _operation_proxy(self, operation_id: str):
        def invoke(input: Any = None, /, **kwargs: Any) -> Any:
            rpc_events = kwargs.pop("_rpc_events", None)
            execution = kwargs.pop("_execution", "immediate")
            poll_interval = kwargs.pop("_poll_interval", 1.0)
            payload = _merge_input(input, kwargs)
            return self.call_operation(
                operation_id,
                payload,
                rpc_events=rpc_events,
                execution=execution,
                poll_interval=poll_interval,
            )

        invoke.__name__ = _to_snake_case(operation_id)
        invoke.__doc__ = f"Invoke OpenAPI operation {operation_id}."
        return invoke

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        operation = self._operations_by_id.get(name) or self._operations_by_snake.get(name)
        if operation is None:
            raise AttributeError(name)
        return self._operation_proxy(operation.operation_id)

    def _prepare_operation_call(self, operation: OpenAPIOperation, input_data: Any) -> tuple[str, dict[str, Any] | None, dict[str, Any] | None]:
        payload = _normalize_payload_keys(_normalize_input_payload(input_data), operation.input_aliases)
        path_values = {param["name"]: payload[param["name"]] for param in operation.parameters if param.get("in") == "path" and param["name"] in payload}
        query_values = {
            param["name"]: payload[param["name"]]
            for param in operation.parameters
            if param.get("in") == "query" and param["name"] in payload
        }

        body_values: dict[str, Any] | None = None
        body_schema = operation.request_body_schema
        if body_schema:
            if _schema_expects_object(body_schema):
                properties = set((body_schema.get("properties") or {}).keys())
                body_keys = properties or {
                    key
                    for key in payload
                    if key not in path_values and key not in query_values
                }
                body_values = {key: payload[key] for key in body_keys if key in payload}
            elif "body" in payload:
                body_values = payload["body"]
            else:
                remaining = {
                    key: value
                    for key, value in payload.items()
                    if key not in path_values and key not in query_values
                }
                if remaining:
                    body_values = remaining

        return _replace_path_params(operation.path, path_values), query_values or None, body_values

    def _coerce_input_model(self, input_data: Any) -> Any:
        if input_data is None:
            return None
        if hasattr(input_data, "model_dump"):
            return input_data.model_dump(by_alias=True, exclude_none=True)
        return serialize_for_response(input_data)

    def _coerce_output_model(self, value: Any, response_model: Any | None) -> Any:
        if response_model is None:
            return value
        validator = getattr(response_model, "model_validate", None)
        if callable(validator):
            return validator(value)
        return value

    def register_transport_plugin(self, plugin: Any) -> None:
        self._transport_plugins.append(plugin)

    def _resolve_transport_plugin(self) -> Any | None:
        for plugin in self._transport_plugins:
            if plugin.can_handle({"base_url": self._default_base_url, "transport_mode": self._transport_mode()}):
                return plugin
        return None

    def _create_builtin_transport_plugin(
        self,
        operation: OpenAPIOperation,
        *,
        deferred_handle_type: type[Any],
        poll_interval: float = 1.0,
        is_async: bool = False,
    ) -> Any:
        transport_mode = self._transport_mode()
        if transport_mode == "rpc":
            return create_rpc_transport_plugin(self, operation, is_async=is_async)
        if transport_mode == "file":
            return create_file_transport_plugin(self, operation)
        if transport_mode == "css":
            return create_css_transport_plugin(
                config=None if not self._css_options else CSSTransportConfig(**self._css_options),
                is_async=is_async,
            )
        client_ref = self

        def _prepare(request: Any) -> tuple[str, dict | None, dict | None]:
            return client_ref._prepare_operation_call(operation, request.params)

        def _request_via_client(method: str, path: str, *, params=None, json=None, headers=None):
            request_impl = getattr(client_ref, "_request")
            request_kwargs = {"params": params, "json": json}
            try:
                signature = inspect.signature(request_impl)
                if "headers" in signature.parameters:
                    request_kwargs["headers"] = headers
            except (TypeError, ValueError):
                request_kwargs["headers"] = headers
            result = request_impl(method, path, **request_kwargs)
            if inspect.isawaitable(result):
                return asyncio.run(result)
            return result

        def _deferred_factory(call_id: str, *, poll_interval: float = 1.0) -> Any:
            return deferred_handle_type(client_ref, call_id, poll_interval=poll_interval)

        return create_http_transport_plugin(
            HTTPTransportConfig(
                base_url=self._default_base_url,
                headers=dict(self._headers),
                timeout=getattr(self, "_timeout", 30.0),
                retries=getattr(self, "_retries", 3),
                backoff=getattr(self, "_backoff", 0.5),
                calls_path=getattr(self, "_calls_path", "/platCall"),
            ),
            prepare_call=_prepare,
            request_fn=_request_via_client,
            deferred_handle_factory=_deferred_factory,
            poll_interval=poll_interval,
        )

    def _transport_mode(self) -> str:
        if self._default_base_url.startswith("css://"):
            return "css"
        if self._default_base_url.startswith(("ws://", "wss://")):
            return "rpc"
        if self._is_file_transport():
            return "file"
        return "http"

    def _is_file_transport(self) -> bool:
        return self._default_base_url.startswith("file://")

    def _resolve_file_queue_paths(self) -> tuple[Path, Path]:
        parsed = urlparse(self._default_base_url)
        root = Path(parsed.path)
        if os.name == "nt" and root.as_posix().startswith("/") and len(root.as_posix()) > 2:
            root = Path(root.as_posix().lstrip("/"))
        return root / "inbox", root / "outbox"

    def _call_file_queue(
        self,
        operation: OpenAPIOperation,
        input_data: Any,
        *,
        rpc_events: RPCEventHandler | None = None,
    ) -> Any:
        request_id = f"file-{int(time.time() * 1000)}-{self.next_rpc_id()}"
        inbox, outbox = self._resolve_file_queue_paths()
        inbox.mkdir(parents=True, exist_ok=True)
        outbox.mkdir(parents=True, exist_ok=True)
        request_path = inbox / f"{request_id}.json"
        response_path = outbox / f"{request_id}.response.json"
        events_path = outbox / f"{request_id}.events.jsonl"
        request_path.write_text(
            json.dumps({
                "id": request_id,
                "operationId": operation.operation_id,
                "method": operation.method,
                "path": operation.path,
                "headers": dict(self._headers),
                "input": self._coerce_input_model(input_data),
            }),
            encoding="utf-8",
        )
        seen_events = 0
        while True:
            if rpc_events is not None and events_path.exists():
                lines = events_path.read_text(encoding="utf-8").splitlines()
                for line in lines[seen_events:]:
                    if line.strip():
                        rpc_events(json.loads(line))
                seen_events = len(lines)
            if response_path.exists():
                response = json.loads(response_path.read_text(encoding="utf-8"))
                if not response.get("ok"):
                    error = response.get("error") or {}
                    raise RuntimeError(error.get("message", "File queue request failed"))
                return response.get("result")
            time.sleep(self._file_poll_interval)


class OpenAPISyncClient(_OpenAPIClientMixin, SyncClient):
    def __init__(
        self,
        spec: Mapping[str, Any],
        base_url: str | None = None,
        *,
        headers: dict[str, str] | None = None,
        timeout: float = 30.0,
        retries: int = 3,
        backoff: float = 0.5,
        calls_path: str = "/platCall",
        css_options: dict[str, Any] | None = None,
    ):
        _OpenAPIClientMixin.__init__(self, spec, base_url=base_url, calls_path=calls_path, css_options=css_options)
        SyncClient.__init__(
            self,
            self._default_base_url,
            headers=headers,
            timeout=timeout,
            retries=retries,
            backoff=backoff,
        )

    def call_operation(
        self,
        operation_id: str,
        input_data: Any = None,
        *,
        rpc_events: RPCEventHandler | None = None,
        execution: str = "immediate",
        poll_interval: float = 1.0,
    ) -> Any:
        operation = self.get_operation(operation_id)
        return self.call_route(
            operation.method,
            operation.path,
            input_data,
            rpc_events=rpc_events,
            execution=execution,
            poll_interval=poll_interval,
        )

    def call_route(
        self,
        method: str,
        path: str,
        input_data: Any = None,
        *,
        rpc_events: RPCEventHandler | None = None,
        execution: str = "immediate",
        poll_interval: float = 1.0,
    ) -> Any:
        operation = next(
            candidate
            for candidate in self._operations
            if candidate.method == method.upper() and candidate.path == path
        )
        plugin = self._resolve_transport_plugin()
        if plugin is not None:
            return execute_transport_plugin(
                plugin,
                TransportRequest(
                    id=f"plugin-{self.next_rpc_id()}",
                    base_url=self._default_base_url,
                    transport_mode=self._transport_mode(),
                    method=operation.method,
                    path=operation.path,
                    operation_id=operation.operation_id,
                    params=self._coerce_input_model(input_data),
                    headers=dict(self._headers),
                    execution=execution,
                    on_event=rpc_events,
                )
            )
        plugin = self._create_builtin_transport_plugin(
            operation,
            deferred_handle_type=DeferredCallHandle,
            poll_interval=poll_interval,
            is_async=False,
        )
        return execute_transport_plugin(
            plugin,
            TransportRequest(
                id=self.next_rpc_id(),
                base_url=self._default_base_url,
                transport_mode=self._transport_mode(),
                method=operation.method,
                path=operation.path,
                operation_id=operation.operation_id,
                params=self._coerce_input_model(input_data),
                headers=dict(self._headers),
                execution=execution,
                on_event=rpc_events,
            ),
        )

    def call_typed(self, operation_id: str, input_data: Any = None, response_model: Any | None = None) -> Any:
        value = self.call_operation(operation_id, input_data)
        return self._coerce_output_model(value, response_model)

    def call_typed_route(self, method: str, path: str, input_data: Any = None, response_model: Any | None = None) -> Any:
        value = self.call_route(method, path, input_data)
        return self._coerce_output_model(value, response_model)

    def _call_rpc(
        self,
        operation: OpenAPIOperation,
        input_data: Any,
        *,
        rpc_events: RPCEventHandler | None = None,
    ) -> Any:
        from websockets.sync.client import connect

        request = {
            "jsonrpc": "2.0",
            "id": self.next_rpc_id(),
            "operationId": operation.operation_id,
            "method": operation.method,
            "path": operation.path,
            "headers": dict(self._headers),
            "input": self._coerce_input_model(input_data),
        }
        with connect(self.resolve_rpc_url()) as websocket:
            websocket.send(json.dumps(request))
            while True:
                response = json.loads(websocket.recv())
                if response.get("event"):
                    if rpc_events is not None:
                        rpc_events(response)
                    continue
                break
        if not response.get("ok"):
            error = response.get("error") or {}
            raise RuntimeError(error.get("message", "RPC request failed"))
        return response.get("result")

    def next_rpc_id(self) -> str:
        counter = getattr(self, "_rpc_counter", 0) + 1
        self._rpc_counter = counter
        return f"rpc-{counter}"

    def resolve_rpc_url(self) -> str:
        parsed = urlparse(self._default_base_url)
        path = parsed.path or ""
        if path in {"", "/"}:
            path = DEFAULT_RPC_PATH
        return parsed._replace(path=path).geturl()

    def call_typed_route(self, method: str, path: str, input_data: Any = None, response_model: Any | None = None) -> Any:
        value = self.call_route(method, path, input_data)
        return self._coerce_output_model(value, response_model)


class OpenAPIAsyncClient(_OpenAPIClientMixin, AsyncClient):
    def __init__(
        self,
        spec: Mapping[str, Any],
        base_url: str | None = None,
        *,
        headers: dict[str, str] | None = None,
        timeout: float = 30.0,
        retries: int = 3,
        backoff: float = 0.5,
        calls_path: str = "/platCall",
        css_options: dict[str, Any] | None = None,
    ):
        _OpenAPIClientMixin.__init__(self, spec, base_url=base_url, calls_path=calls_path, css_options=css_options)
        AsyncClient.__init__(
            self,
            self._default_base_url,
            headers=headers,
            timeout=timeout,
            retries=retries,
            backoff=backoff,
        )

    async def call_operation(
        self,
        operation_id: str,
        input_data: Any = None,
        *,
        rpc_events: RPCEventHandler | None = None,
        execution: str = "immediate",
        poll_interval: float = 1.0,
    ) -> Any:
        operation = self.get_operation(operation_id)
        return await self.call_route(
            operation.method,
            operation.path,
            input_data,
            rpc_events=rpc_events,
            execution=execution,
            poll_interval=poll_interval,
        )

    async def call_route(
        self,
        method: str,
        path: str,
        input_data: Any = None,
        *,
        rpc_events: RPCEventHandler | None = None,
        execution: str = "immediate",
        poll_interval: float = 1.0,
    ) -> Any:
        operation = next(
            candidate
            for candidate in self._operations
            if candidate.method == method.upper() and candidate.path == path
        )
        plugin = self._resolve_transport_plugin()
        if plugin is not None:
            return await asyncio.to_thread(
                execute_transport_plugin,
                plugin,
                TransportRequest(
                    id=f"plugin-{self.next_rpc_id()}",
                    base_url=self._default_base_url,
                    transport_mode=self._transport_mode(),
                    method=operation.method,
                    path=operation.path,
                    operation_id=operation.operation_id,
                    params=self._coerce_input_model(input_data),
                    headers=dict(self._headers),
                    execution=execution,
                    on_event=rpc_events,
                ),
            )
        plugin = self._create_builtin_transport_plugin(
            operation,
            deferred_handle_type=AsyncDeferredCallHandle,
            poll_interval=poll_interval,
            is_async=True,
        )
        return await asyncio.to_thread(
            execute_transport_plugin,
            plugin,
            TransportRequest(
                id=self.next_rpc_id(),
                base_url=self._default_base_url,
                transport_mode=self._transport_mode(),
                method=operation.method,
                path=operation.path,
                operation_id=operation.operation_id,
                params=self._coerce_input_model(input_data),
                headers=dict(self._headers),
                execution=execution,
                on_event=rpc_events,
            ),
        )

    async def call_typed(self, operation_id: str, input_data: Any = None, response_model: Any | None = None) -> Any:
        value = await self.call_operation(operation_id, input_data)
        return self._coerce_output_model(value, response_model)

    async def call_typed_route(self, method: str, path: str, input_data: Any = None, response_model: Any | None = None) -> Any:
        value = await self.call_route(method, path, input_data)
        return self._coerce_output_model(value, response_model)

    async def _call_rpc(
        self,
        operation: OpenAPIOperation,
        input_data: Any,
        *,
        rpc_events: RPCEventHandler | None = None,
    ) -> Any:
        from websockets import connect

        request = {
            "jsonrpc": "2.0",
            "id": self.next_rpc_id(),
            "operationId": operation.operation_id,
            "method": operation.method,
            "path": operation.path,
            "headers": dict(self._headers),
            "input": self._coerce_input_model(input_data),
        }
        async with connect(self.resolve_rpc_url()) as websocket:
            await websocket.send(json.dumps(request))
            while True:
                response = json.loads(await websocket.recv())
                if response.get("event"):
                    if rpc_events is not None:
                        maybe = rpc_events(response)
                        if hasattr(maybe, "__await__"):
                            await maybe
                    continue
                break
        if not response.get("ok"):
            error = response.get("error") or {}
            raise RuntimeError(error.get("message", "RPC request failed"))
        return response.get("result")

    def next_rpc_id(self) -> str:
        counter = getattr(self, "_rpc_counter", 0) + 1
        self._rpc_counter = counter
        return f"rpc-{counter}"

    def resolve_rpc_url(self) -> str:
        parsed = urlparse(self._default_base_url)
        path = parsed.path or ""
        if path in {"", "/"}:
            path = DEFAULT_RPC_PATH
        return parsed._replace(path=path).geturl()


class OpenAPIPromiseClient(OpenAPISyncClient):
    def call_operation(
        self,
        operation_id: str,
        input_data: Any = None,
        *,
        rpc_events: RPCEventHandler | None = None,
        execution: str = "immediate",
        poll_interval: float = 1.0,
    ) -> Any:
        if execution == "deferred":
            operation = self.get_operation(operation_id)
            return OpenAPISyncClient.call_route(
                self,
                operation.method,
                operation.path,
                input_data,
                rpc_events=rpc_events,
                execution=execution,
                poll_interval=poll_interval,
            )
        promise: PLATPromise[Any] = PLATPromise()

        def worker() -> None:
            try:
                operation = self.get_operation(operation_id)
                value = OpenAPISyncClient.call_route(self, operation.method, operation.path, input_data, rpc_events=rpc_events)
                promise._resolve(value)
            except BaseException as exc:
                promise._reject(exc)

        threading.Thread(target=worker, daemon=True).start()
        return promise

    def call_route(
        self,
        method: str,
        path: str,
        input_data: Any = None,
        *,
        rpc_events: RPCEventHandler | None = None,
        execution: str = "immediate",
        poll_interval: float = 1.0,
    ) -> Any:
        if execution == "deferred":
            return OpenAPISyncClient.call_route(
                self,
                method,
                path,
                input_data,
                rpc_events=rpc_events,
                execution=execution,
                poll_interval=poll_interval,
            )
        promise: PLATPromise[Any] = PLATPromise()

        def worker() -> None:
            try:
                value = OpenAPISyncClient.call_route(self, method, path, input_data, rpc_events=rpc_events)
                promise._resolve(value)
            except BaseException as exc:
                promise._reject(exc)

        threading.Thread(target=worker, daemon=True).start()
        return promise

    def call_typed(self, operation_id: str, input_data: Any = None, response_model: Any | None = None) -> PLATPromise[Any]:
        promise: PLATPromise[Any] = PLATPromise()

        def worker() -> None:
            try:
                operation = self.get_operation(operation_id)
                value = OpenAPISyncClient.call_typed_route(self, operation.method, operation.path, input_data, response_model)
                promise._resolve(value)
            except BaseException as exc:
                promise._reject(exc)

        threading.Thread(target=worker, daemon=True).start()
        return promise

    def call_typed_route(self, method: str, path: str, input_data: Any = None, response_model: Any | None = None) -> PLATPromise[Any]:
        promise: PLATPromise[Any] = PLATPromise()

        def worker() -> None:
            try:
                value = OpenAPISyncClient.call_typed_route(self, method, path, input_data, response_model)
                promise._resolve(value)
            except BaseException as exc:
                promise._reject(exc)

        threading.Thread(target=worker, daemon=True).start()
        return promise


def _extract_operations(spec: Mapping[str, Any]) -> list[OpenAPIOperation]:
    operations: list[OpenAPIOperation] = []
    for path, path_item in (spec.get("paths") or {}).items():
        if not isinstance(path_item, Mapping):
            continue
        for method, operation in path_item.items():
            if method.lower() not in HTTP_METHODS or not isinstance(operation, Mapping):
                continue
            operation_id = operation.get("operationId")
            if not operation_id:
                continue
            operations.append(
                OpenAPIOperation(
                    operation_id=str(operation_id),
                    method=method.upper(),
                    path=str(path),
                    parameters=[param for param in operation.get("parameters", []) if isinstance(param, Mapping)],
                    request_body_schema=_extract_request_body_schema(operation),
                    response_schema=_extract_response_schema(operation),
                    input_aliases=_build_input_aliases(
                        [param for param in operation.get("parameters", []) if isinstance(param, Mapping)],
                        _extract_request_body_schema(operation),
                    ),
                )
            )
    return operations


def _extract_request_body_schema(operation: Mapping[str, Any]) -> dict[str, Any] | None:
    content = (((operation.get("requestBody") or {}).get("content") or {}).get("application/json") or {})
    schema = content.get("schema")
    return dict(schema) if isinstance(schema, Mapping) else None


def _extract_response_schema(operation: Mapping[str, Any]) -> dict[str, Any] | None:
    responses = operation.get("responses") or {}
    for status_code in ("200", "201", "202", "203", "204", "default"):
        response = responses.get(status_code)
        if not isinstance(response, Mapping):
            continue
        content = (response.get("content") or {}).get("application/json") or {}
        schema = content.get("schema")
        if isinstance(schema, Mapping):
            return dict(schema)
    return None


def _replace_path_params(path: str, values: Mapping[str, Any]) -> str:
    result = path
    for key, value in values.items():
        result = result.replace("{" + key + "}", quote(str(value), safe=""))
    return result


def _merge_input(input_data: Any, kwargs: dict[str, Any]) -> Any:
    if input_data is None:
        return kwargs or None
    if kwargs:
        payload = _normalize_input_payload(input_data)
        payload.update(kwargs)
        return payload
    return input_data


def _normalize_input_payload(input_data: Any) -> dict[str, Any]:
    if input_data is None:
        return {}
    if hasattr(input_data, "model_dump"):
        return dict(input_data.model_dump(by_alias=True, exclude_none=True))
    if hasattr(input_data, "__dataclass_fields__"):
        serialized = serialize_for_response(input_data)
        return dict(serialized) if isinstance(serialized, Mapping) else {"body": serialized}
    if isinstance(input_data, Mapping):
        return dict(input_data)
    return {"body": input_data}


def _normalize_payload_keys(payload: dict[str, Any], aliases: Mapping[str, str]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in payload.items():
        normalized[aliases.get(key, key)] = value
    return normalized


def _schema_expects_object(schema: Mapping[str, Any]) -> bool:
    if schema.get("type") == "object":
        return True
    return bool(schema.get("properties"))


def _build_input_aliases(parameters: list[Mapping[str, Any]], body_schema: Mapping[str, Any] | None) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for parameter in parameters:
        name = str(parameter.get("name"))
        aliases[_to_snake_case(name)] = name
    if isinstance(body_schema, Mapping) and isinstance(body_schema.get("properties"), Mapping):
        for name in body_schema["properties"].keys():
            aliases[_to_snake_case(str(name))] = str(name)
    return aliases


def _to_snake_case(value: str) -> str:
    import re

    value = re.sub(r"[^A-Za-z0-9]+", "_", value)
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    value = re.sub(r"([A-Z])([A-Z][a-z])", r"\1_\2", value)
    return value.strip("_").lower()
