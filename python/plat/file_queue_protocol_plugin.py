from __future__ import annotations

import json
import os
import threading
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .file_queue import FileQueueRequest, FileQueueSuccessResponse, FileQueueErrorResponse
from .protocol_plugin import ServerTransportRuntime
from .server_types import RouteContext

logger = logging.getLogger("plat")


@dataclass
class FileQueueProtocolPluginOptions:
    """Configuration for the file queue protocol plugin."""
    inbox: str
    outbox: str
    poll_interval_ms: int = 250
    archive: str | bool = True
    http_error_class: type | None = None


def create_file_queue_protocol_plugin(options: FileQueueProtocolPluginOptions) -> Any:
    """Create a self-contained file queue protocol plugin for the Python server."""

    HttpError = options.http_error_class

    runtime_ref: list[ServerTransportRuntime | None] = [None]
    stop_event = threading.Event()
    thread: list[threading.Thread | None] = [None]

    def archive_request(source_path: Path) -> None:
        if options.archive is False:
            source_path.unlink(missing_ok=True)
            return
        if isinstance(options.archive, str):
            source_path.rename(Path(options.archive) / source_path.name)
            return
        source_path.unlink(missing_ok=True)

    def process_once() -> None:
        import asyncio

        rt = runtime_ref[0]
        if rt is None:
            return

        os.makedirs(options.inbox, exist_ok=True)
        os.makedirs(options.outbox, exist_ok=True)
        if isinstance(options.archive, str):
            os.makedirs(options.archive, exist_ok=True)

        for name in sorted(entry for entry in os.listdir(options.inbox) if entry.endswith(".json")):
            source_path = Path(options.inbox) / name
            request_id = source_path.stem

            try:
                payload = json.loads(source_path.read_text(encoding="utf-8"))
                request = FileQueueRequest(**payload)
            except Exception as exc:
                response = FileQueueErrorResponse(
                    id=request_id,
                    ok=False,
                    error={"status": 400, "message": str(exc) or "Invalid file queue request"},
                )
                (Path(options.outbox) / f"{request_id}.response.json").write_text(
                    json.dumps(response.__dict__, indent=2), encoding="utf-8",
                )
                source_path.unlink(missing_ok=True)
                continue

            operation = rt.resolve_operation(
                operation_id=getattr(request, "operationId", None),
                method=request.method,
                path=request.path,
            )
            if operation is None:
                response = FileQueueErrorResponse(
                    id=request.id,
                    ok=False,
                    error={"status": 404, "message": f"Operation not found for {request.method} {request.path}"},
                )
                (Path(options.outbox) / f"{request.id}.response.json").write_text(
                    json.dumps(response.__dict__, indent=2), encoding="utf-8",
                )
                archive_request(source_path)
                continue

            events_path = Path(options.outbox) / f"{request.id}.events.jsonl"
            input_data = rt.normalize_input(dict(request.input or {}))

            ctx = RouteContext(
                method=request.method,
                url=request.path,
                headers=dict(request.headers or {}),
                opts=operation.route_meta.opts if operation.route_meta else None,
            )

            def make_emit(req_id: str, ev_path: Path):
                def emit(event: str, data: Any = None) -> None:
                    line = json.dumps({
                        "id": req_id, "event": event,
                        "data": rt.serialize_value(data),
                    }) + "\n"
                    with open(ev_path, "a", encoding="utf-8") as f:
                        f.write(line)
                return emit

            emit_fn = make_emit(request.id, events_path)
            rt.create_call_context(
                ctx=ctx,
                session_id=request.id,
                mode="deferred",
                emit=emit_fn,
                signal=None,
            )

            try:
                execution = asyncio.run(
                    rt.dispatch(
                        operation,
                        rt.create_envelope(
                            protocol="file",
                            operation=operation,
                            input=input_data,
                            ctx=ctx,
                            headers=dict(request.headers or {}),
                            request_id=request.id,
                            request=type("FileQueueRequest", (), {"headers": dict(request.headers or {})})(),
                            allow_help=False,
                            help_requested=False,
                        ),
                    )
                )
                response = FileQueueSuccessResponse(
                    id=request.id,
                    ok=True,
                    result=rt.serialize_value(execution["result"]),
                    statusCode=execution["status_code"],
                )
                (Path(options.outbox) / f"{request.id}.response.json").write_text(
                    json.dumps(response.__dict__, indent=2), encoding="utf-8",
                )
            except Exception as exc:
                status = 500
                if HttpError and isinstance(exc, HttpError):
                    status = exc.status_code
                else:
                    status = getattr(exc, "status_code", None) or getattr(exc, "status", None) or 500
                response = FileQueueErrorResponse(
                    id=request.id,
                    ok=False,
                    error={
                        "status": status,
                        "message": str(exc) or "Internal server error",
                        **({"data": getattr(exc, "data")} if getattr(exc, "data", None) is not None else {}),
                    },
                )
                (Path(options.outbox) / f"{request.id}.response.json").write_text(
                    json.dumps(response.__dict__, indent=2), encoding="utf-8",
                )

            archive_request(source_path)

    class FileQueueProtocolPlugin:
        name = "file"

        def setup(self, runtime: ServerTransportRuntime) -> None:
            runtime_ref[0] = runtime

        def start(self, runtime: ServerTransportRuntime) -> None:
            if thread[0] is not None:
                return
            poll_seconds = max(0.05, options.poll_interval_ms / 1000)

            def worker() -> None:
                while not stop_event.is_set():
                    try:
                        process_once()
                    except Exception as exc:
                        logger.error("File queue processing failed: %s", exc)
                    stop_event.wait(poll_seconds)

            t = threading.Thread(target=worker, name="plat-file-queue", daemon=True)
            thread[0] = t
            t.start()

        def teardown(self, runtime: ServerTransportRuntime) -> None:
            stop_event.set()
            if thread[0] is not None:
                thread[0].join(timeout=5)
                thread[0] = None
            runtime_ref[0] = None

        def process_once(self) -> None:
            process_once()

    return FileQueueProtocolPlugin()
