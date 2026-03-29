from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from .server_types import RouteContext
from .transports import CallEnvelope, ResolvedOperation

@dataclass
class ConnectionRequest:
    protocol: str
    meta: dict[str, Any] | None = None


@dataclass
class RequestEnvelope:
    id: str
    protocol: str
    method: str
    path: str
    operation_id: str | None = None
    input: Any = None
    headers: dict[str, str] | None = None


@dataclass
class UpdateEnvelope:
    id: str
    event: str
    data: Any = None


@dataclass
class ResponseEnvelope:
    id: str
    ok: bool
    result: Any = None
    error: Any = None
    status_code: int | None = None

@dataclass
class ServerHostContext:
    kind: str
    app: Any = None
    server: Any = None
    meta: dict[str, Any] | None = None


@dataclass
class ServerTransportRuntime:
    logger: Any
    resolve_operation: Any
    dispatch: Any
    normalize_input: Any
    serialize_value: Any
    create_call_context: Any
    create_envelope: Any


class ServerProtocolPlugin(Protocol):
    name: str

    def setup(self, runtime: ServerTransportRuntime) -> Any:
        ...

    def attach(self, runtime: ServerTransportRuntime, host: ServerHostContext) -> Any:
        ...

    def get_connection_request(self, runtime: ServerTransportRuntime) -> Any:
        ...

    def on_connection_request(self, request: ConnectionRequest, runtime: ServerTransportRuntime) -> Any:
        ...

    def get_request(self, runtime: ServerTransportRuntime) -> Any:
        ...

    def on_request(self, request: RequestEnvelope, runtime: ServerTransportRuntime) -> Any:
        ...

    def handle_request(self, request: RequestEnvelope, runtime: ServerTransportRuntime) -> Any:
        ...

    def send_update(self, update: UpdateEnvelope, runtime: ServerTransportRuntime) -> Any:
        ...

    def send_response(self, response: ResponseEnvelope, runtime: ServerTransportRuntime) -> Any:
        ...

    def teardown(self, runtime: ServerTransportRuntime) -> Any:
        ...

    def start(self, runtime: ServerTransportRuntime) -> Any:
        ...
