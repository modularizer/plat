from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from typing import Any, Callable


def serialize_for_response(
    value: Any,
    output_serializers: dict[type[Any], Callable[[Any], Any]] | None = None,
) -> Any:
    if value is None:
        return None

    custom = _apply_registered_output_serializer(value, output_serializers)
    if custom is not _UNHANDLED:
        return serialize_for_response(custom, output_serializers)

    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()

    numpy_serialized = _serialize_numpy(value)
    if numpy_serialized is not _UNHANDLED:
        return serialize_for_response(numpy_serialized, output_serializers)

    if isinstance(value, dict):
        return {key: serialize_for_response(item, output_serializers) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [serialize_for_response(item, output_serializers) for item in value]

    if is_dataclass(value):
        return serialize_for_response(asdict(value), output_serializers)

    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return serialize_for_response(model_dump(), output_serializers)

    return value


_UNHANDLED = object()


def _serialize_numpy(value: Any) -> Any:
    try:
        import numpy as np
    except Exception:
        return _UNHANDLED

    if isinstance(value, np.ndarray):
        return serialize_for_response(value.tolist())
    if isinstance(value, np.generic):
        return serialize_for_response(value.item())
    return _UNHANDLED


def _apply_registered_output_serializer(
    value: Any,
    output_serializers: dict[type[Any], Callable[[Any], Any]] | None,
) -> Any:
    if not output_serializers:
        return _UNHANDLED

    value_type = type(value)
    serializer = output_serializers.get(value_type)
    if serializer is not None:
        return serializer(value)

    for cls in value_type.__mro__[1:]:
        serializer = output_serializers.get(cls)
        if serializer is not None:
            return serializer(value)

    return _UNHANDLED
