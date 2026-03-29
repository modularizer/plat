from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class FileQueueRequest:
    id: str
    method: str
    path: str
    operationId: str | None = None
    headers: dict[str, str] | None = None
    input: dict[str, Any] | None = None


@dataclass
class FileQueueSuccessResponse:
    id: str
    ok: bool
    result: Any
    statusCode: int


@dataclass
class FileQueueErrorResponse:
    id: str
    ok: bool
    error: dict[str, Any]
