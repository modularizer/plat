from __future__ import annotations

from .server_types import ControllerMeta, RouteMeta

CONTROLLER_METADATA_KEY = "__plat_controller_meta__"


def get_controller_meta(ctor: type) -> ControllerMeta | None:
    return getattr(ctor, CONTROLLER_METADATA_KEY, None)


def ensure_controller_meta(ctor: type) -> ControllerMeta:
    meta = get_controller_meta(ctor)
    if meta is None:
        meta = ControllerMeta()
        setattr(ctor, CONTROLLER_METADATA_KEY, meta)
    return meta


def ensure_route_meta(ctor: type, key: str) -> RouteMeta:
    controller_meta = ensure_controller_meta(ctor)
    route_meta = controller_meta.routes.get(key)
    if route_meta is None:
        route_meta = RouteMeta(name=key)
        controller_meta.routes[key] = route_meta
    return route_meta
