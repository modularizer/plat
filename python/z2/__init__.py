"""plat — Python client, CLI, and server helpers for plat."""

from .errors import HTTP_ERROR_TYPES

__all__ = [
    "AsyncClient",
    "Controller",
    "JwtAuthConfig",
    "DELETE",
    "DEFAULT_RPC_PATH",
    "GET",
    "HttpError",
    "HttpResponse",
    "OpenAPIAsyncClient",
    "OpenAPIPromiseClient",
    "OpenAPISyncClient",
    "PATCH",
    "POST",
    "PUT",
    "BucketConfig",
    "CacheEntry",
    "RETRYABLE_STATUS",
    "RateLimitEntry",
    "RouteContext",
    "SyncClient",
    "TokenCallCostFormula",
    "TokenLimitEntry",
    "TokenResponseCostFormula",
    "PLATPromise",
    "PLATServer",
    "PLATServerOptions",
    "create_jwt_auth",
    "create_async_client",
    "create_async_openapi_client",
    "create_in_memory_cache",
    "create_in_memory_rate_limit",
    "create_in_memory_token_limit",
    "create_openapi_client",
    "create_promise_openapi_client",
    "create_server",
    "created",
    "discover_controller_classes",
    "load_openapi_spec",
    "OpenAPIClientTransportPlugin",
    "TransportPluginRequest",
    "ServerProtocolPlugin",
    "ServerTransportRuntime",
    "no_content",
    "ok",
    "register_input_coercer",
    "register_output_serializer",
    "sign_refresh_token",
    "sign_token",
    *sorted(HTTP_ERROR_TYPES.keys()),
]


def __getattr__(name):
    if name in {
        "SyncClient",
        "AsyncClient",
        "RETRYABLE_STATUS",
        "DEFAULT_RPC_PATH",
        "OpenAPISyncClient",
        "OpenAPIAsyncClient",
        "OpenAPIPromiseClient",
        "PLATPromise",
        "create_openapi_client",
        "create_async_openapi_client",
        "create_async_client",
        "create_promise_openapi_client",
        "load_openapi_spec",
    }:
        from .client import AsyncClient, RETRYABLE_STATUS, SyncClient
        from .rpc import DEFAULT_RPC_PATH
        from .openapi_client import (
            OpenAPIAsyncClient,
            OpenAPIPromiseClient,
            OpenAPISyncClient,
            PLATPromise,
            create_async_openapi_client,
            create_openapi_client,
            create_promise_openapi_client,
            load_openapi_spec,
        )

        exports = {
            "SyncClient": SyncClient,
            "AsyncClient": AsyncClient,
            "RETRYABLE_STATUS": RETRYABLE_STATUS,
            "DEFAULT_RPC_PATH": DEFAULT_RPC_PATH,
            "OpenAPISyncClient": OpenAPISyncClient,
            "OpenAPIAsyncClient": OpenAPIAsyncClient,
            "OpenAPIPromiseClient": OpenAPIPromiseClient,
            "PLATPromise": PLATPromise,
            "create_openapi_client": create_openapi_client,
            "create_async_openapi_client": create_async_openapi_client,
            "create_async_client": create_async_openapi_client,
            "create_promise_openapi_client": create_promise_openapi_client,
            "load_openapi_spec": load_openapi_spec,
        }
        return exports[name]
    if name in {"Controller", "GET", "POST", "PUT", "PATCH", "DELETE"}:
        from .decorators import Controller, DELETE, GET, PATCH, POST, PUT

        exports = {
            "Controller": Controller,
            "GET": GET,
            "POST": POST,
            "PUT": PUT,
            "PATCH": PATCH,
            "DELETE": DELETE,
        }
        return exports[name]
    if name in {"RouteContext", "PLATServerOptions"}:
        from .server_types import RouteContext, PLATServerOptions

        exports = {
            "RouteContext": RouteContext,
            "PLATServerOptions": PLATServerOptions,
        }
        return exports[name]
    if name in {"OpenAPIClientTransportPlugin", "TransportPluginRequest"}:
        from .transport_plugin import OpenAPIClientTransportPlugin, TransportPluginRequest

        exports = {
            "OpenAPIClientTransportPlugin": OpenAPIClientTransportPlugin,
            "TransportPluginRequest": TransportPluginRequest,
        }
        return exports[name]
    if name in {"ServerProtocolPlugin", "ServerTransportRuntime"}:
        from .protocol_plugin import ServerProtocolPlugin, ServerTransportRuntime

        exports = {
            "ServerProtocolPlugin": ServerProtocolPlugin,
            "ServerTransportRuntime": ServerTransportRuntime,
        }
        return exports[name]
    if name in {"register_input_coercer", "register_output_serializer"}:
        from .type_registry import register_input_coercer, register_output_serializer

        exports = {
            "register_input_coercer": register_input_coercer,
            "register_output_serializer": register_output_serializer,
        }
        return exports[name]
    if name in {"JwtAuthConfig", "create_jwt_auth", "sign_token", "sign_refresh_token"}:
        from .auth import JwtAuthConfig, create_jwt_auth, sign_refresh_token, sign_token

        exports = {
            "JwtAuthConfig": JwtAuthConfig,
            "create_jwt_auth": create_jwt_auth,
            "sign_token": sign_token,
            "sign_refresh_token": sign_refresh_token,
        }
        return exports[name]
    if name in {"HttpError", "HttpResponse", "ok", "created", "no_content", *HTTP_ERROR_TYPES.keys()}:
        from .errors import HttpError, HttpResponse, created, no_content, ok

        exports = {
            "HttpError": HttpError,
            "HttpResponse": HttpResponse,
            "ok": ok,
            "created": created,
            "no_content": no_content,
            **HTTP_ERROR_TYPES,
        }
        return exports[name]
    if name in {
        "BucketConfig",
        "CacheEntry",
        "RateLimitEntry",
        "TokenCallCostFormula",
        "TokenLimitEntry",
        "TokenResponseCostFormula",
        "create_in_memory_cache",
        "create_in_memory_rate_limit",
        "create_in_memory_token_limit",
    }:
        from .plugins import (
            BucketConfig,
            CacheEntry,
            RateLimitEntry,
            TokenCallCostFormula,
            TokenLimitEntry,
            TokenResponseCostFormula,
            create_in_memory_cache,
            create_in_memory_rate_limit,
            create_in_memory_token_limit,
        )

        exports = {
            "BucketConfig": BucketConfig,
            "CacheEntry": CacheEntry,
            "RateLimitEntry": RateLimitEntry,
            "TokenCallCostFormula": TokenCallCostFormula,
            "TokenLimitEntry": TokenLimitEntry,
            "TokenResponseCostFormula": TokenResponseCostFormula,
            "create_in_memory_cache": create_in_memory_cache,
            "create_in_memory_rate_limit": create_in_memory_rate_limit,
            "create_in_memory_token_limit": create_in_memory_token_limit,
        }
        return exports[name]
    if name in {"PLATServer", "create_server", "discover_controller_classes"}:
        from .server import PLATServer, create_server, discover_controller_classes

        exports = {
            "PLATServer": PLATServer,
            "create_server": create_server,
            "discover_controller_classes": discover_controller_classes,
        }
        return exports[name]
    raise AttributeError(name)


def __dir__():
    return sorted(set(globals().keys()) | set(__all__))
