from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Any

from .transport_plugin import TransportRequest, TransportResult

RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


def _httpx():
    import httpx
    return httpx


@dataclass
class HTTPTransportConfig:
    base_url: str
    headers: dict[str, str] = field(default_factory=dict)
    timeout: float = 30.0
    retries: int = 3
    backoff: float = 0.5
    calls_path: str = "/platCall"


@dataclass
class _HTTPConnection:
    client: Any = None
    response: Any = None
    response_data: Any = None
    status_code: int | None = None


def create_http_transport_plugin(
    config: HTTPTransportConfig,
    *,
    prepare_call: Any = None,
    request_fn: Any = None,
    deferred_handle_factory: Any = None,
    poll_interval: float = 1.0,
) -> Any:
    """Create a self-contained HTTP transport plugin.

    Args:
        config: HTTP connection configuration (base_url, headers, timeout, retry).
        prepare_call: Callable(operation, input_data) -> (path, query_params, json_body).
                      If provided, the plugin uses it to build the request from operation + input.
        deferred_handle_factory: Callable(client, call_id, poll_interval) -> DeferredCallHandle.
                                 If provided, 202 responses return a deferred handle.
        poll_interval: Polling interval for deferred handles.
    """

    class HTTPTransportPlugin:
        name = "http"

        def can_handle(self, request: dict[str, str]) -> bool:
            mode = request.get("transport_mode", "http")
            return mode == "http" or mode == "auto"

        def connect(self, request: TransportRequest) -> _HTTPConnection:
            httpx = _httpx()
            client = httpx.Client(
                base_url=config.base_url,
                headers=config.headers,
                timeout=config.timeout,
            )
            return _HTTPConnection(client=client)

        def send_request(self, connection: _HTTPConnection, request: TransportRequest) -> None:
            path = request.path
            query_params: dict[str, Any] | None = None
            json_body: dict[str, Any] | None = None

            if prepare_call is not None:
                path, query_params, json_body = prepare_call(request)
            else:
                # Default: GET puts params in query, POST/PUT/PATCH puts them in body
                params = request.params
                if isinstance(params, dict):
                    params = {k: v for k, v in params.items() if v is not None}
                    if request.method.upper() in ("GET", "DELETE", "HEAD", "OPTIONS"):
                        query_params = params or None
                    else:
                        json_body = params or None

            merged_headers: dict[str, str] = {}
            if request.headers:
                merged_headers.update(request.headers)
            if request.execution == "deferred":
                merged_headers["X-PLAT-Execution"] = "deferred"

            if query_params is not None:
                query_params = {k: v for k, v in query_params.items() if v is not None}
            if json_body is not None:
                json_body = {k: v for k, v in json_body.items() if v is not None}

            last_exc: Exception | None = None
            for attempt in range(config.retries + 1):
                try:
                    if request_fn is not None:
                        connection.response_data = request_fn(
                            request.method,
                            path,
                            params=query_params,
                            json=json_body,
                            headers=merged_headers or None,
                        )
                        connection.status_code = None
                        return
                    r = connection.client.request(
                        request.method,
                        path,
                        params=query_params,
                        json=json_body,
                        headers=merged_headers or None,
                    )
                    if r.status_code not in RETRYABLE_STATUS or attempt == config.retries:
                        r.raise_for_status()
                        connection.response = r
                        connection.response_data = r.json()
                        connection.status_code = r.status_code
                        return
                    last_exc = _httpx().HTTPStatusError(
                        f"{request.method} {path} returned {r.status_code}",
                        request=r.request,
                        response=r,
                    )
                except _httpx().TransportError as exc:
                    if attempt == config.retries:
                        raise
                    last_exc = exc
                delay = config.backoff * (2 ** attempt) + random.uniform(0, config.backoff)
                time.sleep(delay)
            raise last_exc  # type: ignore[misc]

        def get_result(self, connection: _HTTPConnection, request: TransportRequest) -> TransportResult:
            data = connection.response_data

            # Handle deferred execution (202 Accepted)
            is_deferred_response = (
                connection.status_code == 202
                or (
                    isinstance(data, dict)
                    and isinstance(data.get("id"), str)
                    and (
                        "statusPath" in data
                        or "resultPath" in data
                        or data.get("status") in {"pending", "running"}
                    )
                )
            )
            if request.execution == "deferred" and is_deferred_response and deferred_handle_factory is not None:
                call_id = data.get("id") if isinstance(data, dict) else None
                if call_id:
                    handle = deferred_handle_factory(call_id, poll_interval=poll_interval)
                    return TransportResult(id=request.id, ok=True, result=handle)

            return TransportResult(id=request.id, ok=True, result=data)

        def disconnect(self, connection: _HTTPConnection, request: TransportRequest) -> None:
            if connection.client is not None:
                connection.client.close()
                connection.client = None

    return HTTPTransportPlugin()
