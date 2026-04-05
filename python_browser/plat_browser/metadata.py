from __future__ import annotations

from .types import ControllerMeta


CONTROLLER_METADATA_KEY = "__plat_browser_controller_meta__"


def get_controller_meta(ctor: type) -> ControllerMeta | None:
    return getattr(ctor, CONTROLLER_METADATA_KEY, None)


def ensure_controller_meta(ctor: type) -> ControllerMeta:
    meta = get_controller_meta(ctor)
    if meta is None:
        meta = ControllerMeta()
        setattr(ctor, CONTROLLER_METADATA_KEY, meta)
    return meta
