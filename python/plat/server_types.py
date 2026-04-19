from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Protocol

from .plugins import CacheController, RateLimitConfigs, RateLimitController, TokenLimitConfigs, TokenLimitController
from .call_sessions import InMemoryCallSessionController


AuthMode = str
HttpMethod = Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
ErrorExposure = Literal["none", "message", "full"]
InputCoercer = Callable[[Any], Any]
OutputSerializer = Callable[[Any], Any]
RequestHook = Callable[[Any, Any, str, str], Any]
ResponseHook = Callable[[Any, Any, int, Any], Any]
ErrorHook = Callable[[Any, Any, Exception, int], Any]
HandleErrorHook = Callable[[Any, Any, Exception], bool | Any]
LifecycleHook = Callable[[dict[str, Any]], Any]
HttpMiddleware = Callable[[Any, Any], Any]


@dataclass
class RouteMeta:
    name: str
    method: HttpMethod | None = None
    path: str | None = None
    decorator_path: str | None = None
    auth: AuthMode | None = None
    summary: str | None = None
    description: str | None = None
    opts: dict[str, Any] | None = None
    input_model: Any = None
    output_model: Any = None


@dataclass
class ControllerMeta:
    base_path: str = ""
    tag: str | None = None
    auth: AuthMode | None = None
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
    response: Any = None


class AuthHandler(Protocol):
    def verify(self, mode: AuthMode, request: Any, ctx: RouteContext) -> Any:
        ...


@dataclass
class CORSOptions:
    origin: str | list[str] | bool | None = "*"
    credentials: bool = False
    methods: list[str] | None = None
    headers: list[str] | None = None
    exposed_headers: list[str] | None = None
    max_age: int | None = None


@dataclass
class FileQueueOptions:
    inbox: str
    outbox: str
    poll_interval_ms: int = 250
    archive: str | bool | None = None


@dataclass
class WebRTCOptions:
    """Configuration for serving a PLATServer over WebRTC.

    When set on PLATServerOptions.webrtc, the server additionally starts an
    MQTT-signalled WebRTC endpoint reachable at ``css://<name>``.
    """
    name: str
    mqtt_broker: str | None = None
    mqtt_topic: str | None = None
    ice_servers: list[str] = field(default_factory=list)
    connection_timeout: float = 15.0
    server_id_prefix: str = "pyserver"
    authority_record: Any = None
    identity_key_pair: Any = None
    trust_on_first_use: bool = True


@dataclass
class PLATServerOptions:
    error_exposure: ErrorExposure = "message"
    cors: CORSOptions | bool = False
    headers: dict[str, str] = field(default_factory=dict)
    logger: Any | None = None
    on_request: RequestHook | None = None
    on_response: ResponseHook | None = None
    on_error: ErrorHook | None = None
    handle_error: HandleErrorHook | None = None
    on_start: LifecycleHook | None = None
    on_stop: LifecycleHook | None = None
    middlewares: list[HttpMiddleware] = field(default_factory=list)
    port: int = 3000
    host: str = "localhost"
    protocol: str = "http"
    rpc: bool | str = True
    openapi: bool | str = True
    swagger: bool | str = True
    redoc: bool | str = True
    auth: AuthHandler | None = None
    default_auth: AuthMode = "public"
    rate_limit: dict[str, RateLimitController | RateLimitConfigs | bool | None] | None = None
    token_limit: dict[str, TokenLimitController | TokenLimitConfigs | bool | None] | None = None
    cache: dict[str, CacheController | bool | None] | None = None
    authority_server: Any | bool | None = None
    allowed_method_prefixes: str | list[str] = "*"
    dis_allowed_method_prefixes: list[str] = field(default_factory=list)
    param_coercions: dict[str, str] = field(
        default_factory=lambda: {
            "query": "q",
            "search": "q",
            "format": "fmt",
        }
    )
    dis_allowed_params: list[str] = field(default_factory=list)
    input_coercers: dict[type[Any], InputCoercer] = field(default_factory=dict)
    output_serializers: dict[type[Any], OutputSerializer] = field(default_factory=dict)
    calls: dict[str, InMemoryCallSessionController | str | None] | None = field(
        default_factory=lambda: {
            "path": "/platCall",
            "controller": None,
        }
    )
    file_queue: FileQueueOptions | bool = False
    webrtc: WebRTCOptions | None = None
    protocol_plugins: list[Any] = field(default_factory=list)
