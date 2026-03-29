from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol

from .transport_plugin import OpenAPIClientTransportPlugin, TransportRequest, TransportResult


class _RPCRuntime(Protocol):
    def next_rpc_id(self) -> str:
        ...

    def resolve_rpc_url(self) -> str:
        ...

    def _coerce_input_model(self, input_data: Any) -> Any:
        ...


@dataclass
class _RPCConnection:
    operation: Any
    response: Any = None


def create_rpc_transport_plugin(runtime: _RPCRuntime, operation: Any, *, is_async: bool = False) -> OpenAPIClientTransportPlugin:
    class RPCTransportPlugin:
        name = "rpc"

        def can_handle(self, request: dict[str, str]) -> bool:
            return request.get("transport_mode") == "rpc"

        def connect(self, request: TransportRequest) -> _RPCConnection:
            return _RPCConnection(operation=operation)

        def send_request(self, connection: _RPCConnection, request: TransportRequest) -> None:
            connection.response = None

        def get_result(self, connection: _RPCConnection, request: TransportRequest) -> Any:
            request_payload = {
                "jsonrpc": "2.0",
                "id": runtime.next_rpc_id(),
                "operationId": connection.operation.operation_id,
                "method": connection.operation.method,
                "path": connection.operation.path,
                "headers": request.headers,
                "input": runtime._coerce_input_model(request.params),
            }
            from websockets.sync.client import connect
            with connect(runtime.resolve_rpc_url()) as websocket:
                websocket.send(json.dumps(request_payload))
                while True:
                    response = json.loads(websocket.recv())
                    if response.get("event"):
                        if request.on_event is not None:
                            maybe = request.on_event(response)
                            if is_async and hasattr(maybe, "__await__"):
                                import asyncio
                                asyncio.run(maybe)
                        continue
                    break
            if not response.get("ok"):
                error = response.get("error") or {}
                return TransportResult(id=request.id, ok=False, error=RuntimeError(error.get("message", "RPC request failed")))
            return TransportResult(id=request.id, ok=True, result=response.get("result"))

    return RPCTransportPlugin()
