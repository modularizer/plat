from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass
class TransportRequest:
    id: str
    base_url: str
    transport_mode: str
    method: str
    path: str
    operation_id: str | None
    params: Any
    headers: dict[str, str]
    execution: str = "immediate"
    signal: Any = None
    on_event: Any = None


@dataclass
class TransportUpdate:
    id: str
    event: str
    data: Any = None


@dataclass
class TransportResult:
    id: str
    ok: bool
    result: Any = None
    error: Any = None


class OpenAPIClientTransportPlugin(Protocol):
    name: str

    def can_handle(self, request: dict[str, str]) -> bool:
        ...

    def connect(self, request: TransportRequest) -> Any:
        ...

    def send_request(self, connection: Any, request: TransportRequest) -> Any:
        ...

    def get_update(self, connection: Any, request: TransportRequest) -> Any:
        ...

    def get_result(self, connection: Any, request: TransportRequest) -> Any:
        ...

    def disconnect(self, connection: Any, request: TransportRequest) -> Any:
        ...


def execute_transport_plugin(plugin: Any, request: TransportRequest) -> Any:
    connection = plugin.connect(request) if hasattr(plugin, "connect") else None
    try:
        plugin.send_request(connection, request)
        result = plugin.get_result(connection, request)
        if isinstance(result, TransportResult):
            if result.ok:
                return result.result
            raise result.error if isinstance(result.error, BaseException) else RuntimeError(result.error)
        return result
    finally:
        if hasattr(plugin, "disconnect"):
            plugin.disconnect(connection, request)
