from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Literal


CallEventKind = Literal["progress", "log", "chunk", "message"]
CallSessionStatus = Literal["pending", "running", "completed", "failed", "cancelled"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class CallSessionEvent:
    seq: int
    at: str
    event: CallEventKind
    data: Any = None


@dataclass
class CallSessionRecord:
    id: str
    operation_id: str
    method: str
    path: str
    status: CallSessionStatus
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None
    status_code: int | None = None
    result: Any = None
    error: dict[str, Any] | None = None
    events: list[CallSessionEvent] = field(default_factory=list)


class InMemoryCallSessionController:
    def __init__(self) -> None:
        self._sessions: dict[str, CallSessionRecord] = {}
        self._seq = 0
        self._active_cancels: dict[str, Callable[[], None]] = {}

    def create(self, *, operation_id: str, method: str, path: str) -> CallSessionRecord:
        self._seq += 1
        now = _now()
        session = CallSessionRecord(
            id=f"call-{self._seq}",
            operation_id=operation_id,
            method=method,
            path=path,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> CallSessionRecord | None:
        return self._sessions.get(session_id)

    def set_cancel(self, session_id: str, cancel: Callable[[], None]) -> None:
        self._active_cancels[session_id] = cancel

    def start(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        now = _now()
        session.status = "running"
        session.started_at = session.started_at or now
        session.updated_at = now

    def append_event(self, session_id: str, event: CallEventKind, data: Any = None) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        session.events.append(
            CallSessionEvent(
                seq=len(session.events) + 1,
                at=_now(),
                event=event,
                data=data,
            )
        )
        session.updated_at = _now()

    def complete(self, session_id: str, result: Any, status_code: int) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        now = _now()
        session.status = "completed"
        session.completed_at = now
        session.updated_at = now
        session.status_code = status_code
        session.result = result
        self._active_cancels.pop(session_id, None)

    def fail(self, session_id: str, *, message: str, status_code: int | None = None, data: Any = None) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        now = _now()
        session.status = "failed"
        session.completed_at = now
        session.updated_at = now
        session.error = {
            "message": message,
            "status_code": status_code,
            "data": data,
        }
        self._active_cancels.pop(session_id, None)

    def cancel(self, session_id: str) -> bool:
        session = self._sessions.get(session_id)
        if session is None:
            return False
        cancel = self._active_cancels.pop(session_id, None)
        if cancel is not None:
            cancel()
        now = _now()
        session.status = "cancelled"
        session.completed_at = now
        session.updated_at = now
        return True

    def list_events(self, session_id: str, *, since: int = 0, event: CallEventKind | None = None) -> list[CallSessionEvent]:
        session = self._sessions.get(session_id)
        if session is None:
            return []
        return [
            item
            for item in session.events
            if item.seq > since and (event is None or item.event == event)
        ]
