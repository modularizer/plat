from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .rpc import DEFAULT_RPC_PATH
from .protocol_plugin import ServerHostContext, ServerTransportRuntime


@dataclass
class RpcProtocolPluginOptions:
    """Configuration for the RPC protocol plugin."""
    enabled: bool | str = True
    http_error_class: type | None = None  # HttpError class for status code extraction


def create_rpc_protocol_plugin(options: RpcProtocolPluginOptions) -> Any:
    """Create a self-contained RPC (WebSocket) protocol plugin for the Python server."""

    if options.enabled is False:
        class _NoOpPlugin:
            name = "rpc"
            def setup(self, runtime: Any) -> None: pass
            def attach(self, runtime: Any, host: Any) -> None: pass
            def start(self, runtime: Any) -> None: pass
        return _NoOpPlugin()

    rpc_path = options.enabled if isinstance(options.enabled, str) else DEFAULT_RPC_PATH
    HttpError = options.http_error_class

    runtime_ref: list[ServerTransportRuntime | None] = [None]
    app_ref: list[Any | None] = [None]

    async def send_event(websocket: Any, request_id: str, event: str, data: Any = None) -> None:
        await websocket.send_text(json.dumps({
            "jsonrpc": "2.0",
            "id": request_id,
            "ok": True,
            "event": event,
            "data": serialize(data),
        }))

    async def handle_payload(payload: dict[str, Any], websocket: Any) -> dict[str, Any]:
        rt = runtime_ref[0]
        if rt is None:
            return {"jsonrpc": "2.0", "id": "error", "ok": False, "error": {"status": 500, "message": "RPC runtime not ready"}}

        request_id = str(payload.get("id", "invalid"))

        if payload.get("cancel"):
            # Cancel not yet wired (no abort controller in Python), but ack it
            return {"jsonrpc": "2.0", "id": request_id, "ok": True, "result": {"cancelled": True}}

        operation = rt.resolve_operation(
            operation_id=payload.get("operationId") if isinstance(payload.get("operationId"), str) else None,
            method=str(payload.get("method", "")).upper(),
            path=str(payload.get("path", "")),
        )
        if operation is None:
            return {
                "jsonrpc": "2.0", "id": request_id, "ok": False,
                "error": {"status": 404, "message": "RPC operation not found"},
            }

        try:
            input_data = payload.get("input") or {}
            if not isinstance(input_data, dict):
                input_data = {}
            input_data = rt.normalize_input(input_data)

            headers = payload.get("headers") or {}
            route_meta = operation.route_meta

            from .server_types import RouteContext
            ctx = RouteContext(
                method=operation.method,
                url=operation.path,
                headers=dict(headers),
                opts=route_meta.opts if route_meta else None,
            )

            async def emit(event: str, data: Any = None) -> None:
                await send_event(websocket, request_id, event, data)

            rt.create_call_context(
                ctx=ctx,
                session_id=request_id,
                mode="rpc",
                emit=emit,
                signal=None,
            )

            execution = await rt.dispatch(
                operation,
                rt.create_envelope(
                    protocol="rpc",
                    operation=operation,
                    input=input_data,
                    ctx=ctx,
                    headers=dict(headers),
                    request_id=request_id,
                    request=type("RpcRequest", (), {"headers": dict(headers)})(),
                    allow_help=False,
                    help_requested=False,
                ),
            )

            result = execution.get("result") if isinstance(execution, dict) else execution
            # Handle http_response execution kind
            if isinstance(execution, dict) and execution.get("kind") == "http_response":
                result = rt.serialize_value(getattr(execution.get("http_response"), "body", result))
            else:
                result = rt.serialize_value(result)

            return {"jsonrpc": "2.0", "id": request_id, "ok": True, "result": result}

        except Exception as exc:
            status = 500
            if HttpError and isinstance(exc, HttpError):
                status = exc.status_code
            else:
                status = getattr(exc, "status_code", None) or getattr(exc, "status", None) or 500
            return {
                "jsonrpc": "2.0", "id": request_id, "ok": False,
                "error": {
                    "status": status,
                    "message": str(exc) or "Internal server error",
                    **({"data": getattr(exc, "data")} if getattr(exc, "data", None) is not None else {}),
                },
            }

    class RpcProtocolPlugin:
        name = "rpc"

        def setup(self, runtime: ServerTransportRuntime) -> None:
            runtime_ref[0] = runtime

        def attach(self, runtime: ServerTransportRuntime, host: ServerHostContext) -> None:
            if host.kind != "fastapi-uvicorn":
                return
            app_ref[0] = host.app

        def start(self, runtime: ServerTransportRuntime) -> None:
            # Register the WebSocket route on the FastAPI app
            app = app_ref[0]
            if app is None:
                return

            try:
                from fastapi import WebSocket as WSType
            except ImportError:
                return

            @app.websocket(rpc_path)
            async def rpc_socket(websocket: WSType):
                await websocket.accept()
                while True:
                    try:
                        payload = await websocket.receive_json()
                    except Exception:
                        break
                    response = await handle_payload(payload, websocket)
                    await websocket.send_text(json.dumps(response))

        def teardown(self, runtime: ServerTransportRuntime) -> None:
            runtime_ref[0] = None

    return RpcProtocolPlugin()
