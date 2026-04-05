from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


HttpMethod = Literal["GET", "POST", "PUT", "PATCH", "DELETE"]


@dataclass
class RouteMeta:
    name: str
    method: HttpMethod | None = None
    path: str | None = None
    decorator_path: str | None = None
    auth: str | None = None
    summary: str | None = None
    description: str | None = None
    rate_limit: Any = None
    token_limit: Any = None
    cache: Any = None
    opts: dict[str, Any] | None = None
    input_model: Any = None
    output_model: Any = None


@dataclass
class ControllerMeta:
    base_path: str = ""
    tag: str | None = None
    auth: str | None = None
    rate_limit: Any = None
    token_limit: Any = None
    cache: Any = None
    routes: dict[str, RouteMeta] = field(default_factory=dict)


@dataclass
class RouteContext:
    method: str | None = None
    url: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    auth: dict[str, Any] | None = None
    rate_limit: Any = None
    token_limit: Any = None
    cache: Any = None
    opts: dict[str, Any] | None = None
    call: Any = None
    rpc: Any = None
    request: Any = None
