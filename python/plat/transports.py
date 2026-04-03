from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .server_types import RouteContext


@dataclass
class ResolvedOperation:
    method: str
    path: str
    method_name: str
    bound_method: Any
    route_meta: Any
    controller_meta: Any


@dataclass
class CallEnvelope:
    protocol: str
    method: str
    path: str
    headers: dict[str, str]
    input: dict[str, Any]
    ctx: RouteContext
    operation_id: str | None = None
    request_id: str | None = None
    request: Any = None
    response: Any = None
    allow_help: bool = False
    help_requested: bool = False
