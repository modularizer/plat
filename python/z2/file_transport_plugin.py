from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .transport_plugin import OpenAPIClientTransportPlugin, TransportRequest, TransportResult


class _FileRuntime(Protocol):
    _file_poll_interval: float

    def next_rpc_id(self) -> str:
        ...

    def _resolve_file_queue_paths(self) -> tuple[Path, Path]:
        ...

    def _coerce_input_model(self, input_data: Any) -> Any:
        ...


@dataclass
class _FileConnection:
    operation: Any
    request_id: str
    response_path: Path
    events_path: Path
    seen_events: int = 0


def create_file_transport_plugin(runtime: _FileRuntime, operation: Any) -> OpenAPIClientTransportPlugin:
    class FileTransportPlugin:
        name = "file"

        def can_handle(self, request: dict[str, str]) -> bool:
            return request.get("transport_mode") == "file"

        def connect(self, request: TransportRequest) -> _FileConnection:
            inbox, outbox = runtime._resolve_file_queue_paths()
            inbox.mkdir(parents=True, exist_ok=True)
            outbox.mkdir(parents=True, exist_ok=True)
            request_id = f"file-{int(time.time() * 1000)}-{runtime.next_rpc_id()}"
            return _FileConnection(
                operation=operation,
                request_id=request_id,
                response_path=outbox / f"{request_id}.response.json",
                events_path=outbox / f"{request_id}.events.jsonl",
            )

        def send_request(self, connection: _FileConnection, request: TransportRequest) -> None:
            inbox, _ = runtime._resolve_file_queue_paths()
            request_path = inbox / f"{connection.request_id}.json"
            request_path.write_text(
                json.dumps({
                    "id": connection.request_id,
                    "operationId": connection.operation.operation_id,
                    "method": connection.operation.method,
                    "path": connection.operation.path,
                    "headers": request.headers,
                    "input": runtime._coerce_input_model(request.params),
                }),
                encoding="utf-8",
            )

        def get_result(self, connection: _FileConnection, request: TransportRequest) -> Any:
            while True:
                if request.on_event is not None and connection.events_path.exists():
                    lines = connection.events_path.read_text(encoding="utf-8").splitlines()
                    for line in lines[connection.seen_events:]:
                        if line.strip():
                            maybe = request.on_event(json.loads(line))
                            if hasattr(maybe, "__await__"):
                                asyncio.run(maybe)
                    connection.seen_events = len(lines)
                if connection.response_path.exists():
                    response = json.loads(connection.response_path.read_text(encoding="utf-8"))
                    if not response.get("ok"):
                        error = response.get("error") or {}
                        return TransportResult(id=request.id, ok=False, error=RuntimeError(error.get("message", "File queue request failed")))
                    return TransportResult(id=request.id, ok=True, result=response.get("result"))
                time.sleep(runtime._file_poll_interval)

    return FileTransportPlugin()
