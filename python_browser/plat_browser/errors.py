from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class HttpResponse(Exception):
    status_code: int
    body: Any = None
    headers: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        super().__init__(f"HTTP {self.status_code}")


class HttpError(HttpResponse):
    def __init__(
        self,
        status_code: int,
        message: str,
        data: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        body: dict[str, Any] = {"error": message}
        if data is not None:
            body["data"] = data
        super().__init__(status_code=status_code, body=body, headers=headers or {})
        self.message = message
        self.data = data
