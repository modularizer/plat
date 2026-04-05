from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, TypeVar, cast

from .metadata import ensure_controller_meta
from .types import ControllerMeta, HttpMethod, RouteMeta

F = TypeVar("F", bound=Callable[..., Any])
ROUTE_METADATA_KEY = "__plat_browser_route_meta__"


def Controller(
    controller_name: str | None = None,
    opts: Mapping[str, Any] | None = None,
):
    options = dict(opts or {})

    def decorator(cls: type) -> type:
        meta = ensure_controller_meta(cls)
        _apply_controller_options(meta, cls, controller_name, options)
        return cls

    return decorator


def _apply_controller_options(
    meta: ControllerMeta,
    cls: type,
    controller_name: str | None,
    options: dict[str, Any],
) -> None:
    meta.base_path = controller_name or cls.__name__
    meta.tag = cast(str | None, options.get("tag")) or controller_name or cls.__name__
    meta.auth = cast(str | None, options.get("auth"))
    meta.rate_limit = options.get("rateLimit", options.get("rate_limit"))
    meta.token_limit = options.get("tokenLimit", options.get("token_limit"))
    meta.cache = options.get("cache")


def _route_decorator(method: HttpMethod):
    def factory(
        arg: str | Mapping[str, Any] | F | None = None,
        opts: Mapping[str, Any] | None = None,
    ):
        if callable(arg):
            return _decorate_route(cast(F, arg), method, None, {})

        decorator_path: str | None = None
        options: dict[str, Any] = dict(opts or {})
        if isinstance(arg, str):
            decorator_path = arg
        elif isinstance(arg, Mapping):
            options = dict(arg)
        elif arg is not None:
            raise TypeError(f"Unsupported decorator argument for {method}: {arg!r}")

        def decorator(fn: F) -> F:
            return _decorate_route(fn, method, decorator_path, options)

        return decorator

    return factory


def _decorate_route(
    fn: F,
    method: HttpMethod,
    decorator_path: str | None,
    options: dict[str, Any],
) -> F:
    meta = RouteMeta(
        name=fn.__name__,
        method=method,
        path=f"/{fn.__name__}",
        decorator_path=decorator_path,
        auth=cast(str | None, options.get("auth")),
        summary=cast(str | None, options.get("summary")),
        description=cast(str | None, options.get("description")),
        rate_limit=options.get("rateLimit", options.get("rate_limit")),
        token_limit=options.get("tokenLimit", options.get("token_limit")),
        cache=options.get("cache"),
        opts=options or None,
    )
    fn.__dict__[ROUTE_METADATA_KEY] = meta
    return fn


GET = _route_decorator("GET")
POST = _route_decorator("POST")
PUT = _route_decorator("PUT")
PATCH = _route_decorator("PATCH")
DELETE = _route_decorator("DELETE")
