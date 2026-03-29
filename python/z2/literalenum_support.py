from __future__ import annotations

import inspect
from collections.abc import Mapping
from functools import lru_cache
from typing import Any, Literal, get_args, get_origin
import types


def is_literal_enum_type(annotation: Any) -> bool:
    if not inspect.isclass(annotation):
        return False

    literal_enum_base = _get_literal_enum_base()
    if literal_enum_base is not None:
        try:
            matched = issubclass(annotation, literal_enum_base)
            if matched:
                _ensure_pydantic_support(annotation)
            return matched
        except TypeError:
            return False

    mapping = getattr(annotation, "mapping", None)
    values = getattr(annotation, "values", None)
    matched = isinstance(mapping, Mapping) and callable(values)
    if matched:
        _ensure_pydantic_support(annotation)
    return matched


def literal_enum_values(annotation: type[Any]) -> tuple[Any, ...]:
    values = getattr(annotation, "values", None)
    if callable(values):
        result = values()
        if isinstance(result, Mapping):
            return tuple(result.values())
        return tuple(result)
    try:
        return tuple(annotation)
    except TypeError as exc:
        raise TypeError(f"{annotation!r} does not expose iterable literal values") from exc


def normalize_annotation(annotation: Any) -> Any:
    if annotation is inspect.Signature.empty:
        return annotation
    if annotation is Any:
        return Any
    if is_literal_enum_type(annotation):
        values = literal_enum_values(annotation)
        return Literal.__getitem__(values)

    origin = get_origin(annotation)
    if origin is None:
        return annotation

    args = get_args(annotation)
    if origin is types.UnionType:
        normalized_args = tuple(normalize_annotation(arg) for arg in args)
        return _rebuild_union(normalized_args)

    if str(origin).endswith("Annotated"):
        if not args:
            return annotation
        normalized_first = normalize_annotation(args[0])
        metadata = args[1:]
        from typing import Annotated

        return Annotated.__class_getitem__((normalized_first, *metadata))

    normalized_args = tuple(normalize_annotation(arg) for arg in args)

    if origin in {list, set, frozenset, tuple, dict}:
        return origin[normalized_args]  # type: ignore[index]

    if origin is tuple and len(normalized_args) == 2 and normalized_args[1] is Ellipsis:
        return tuple[normalized_args]  # type: ignore[index]

    if origin in {types.UnionType, getattr(types, "UnionType", object())}:
        return _rebuild_union(normalized_args)

    try:
        return origin[normalized_args]  # type: ignore[index]
    except TypeError:
        return annotation


def make_pydantic_annotation(annotation: Any) -> Any:
    normalized = normalize_annotation(annotation)
    try:
        from pydantic import BaseModel
    except ImportError:
        return normalized

    if inspect.isclass(normalized) and issubclass(normalized, BaseModel):
        return _normalize_pydantic_model(normalized)
    return normalized


@lru_cache(maxsize=256)
def _normalize_pydantic_model(model_cls: type[Any]) -> type[Any]:
    from pydantic import Field, create_model

    fields: dict[str, tuple[Any, Any]] = {}
    changed = False
    for field_name, field_info in model_cls.model_fields.items():
        normalized_annotation = make_pydantic_annotation(field_info.annotation)
        if normalized_annotation is not field_info.annotation:
            changed = True

        if field_info.is_required():
            default_value: Any = ...
        elif field_info.default_factory is not None:
            default_value = Field(default_factory=field_info.default_factory)
        else:
            default_value = field_info.default

        fields[field_name] = (normalized_annotation, default_value)

    if not changed:
        return model_cls

    normalized_model = create_model(
        f"{model_cls.__name__}LiteralEnumCompat",
        __base__=model_cls,
        __module__=model_cls.__module__,
        **fields,
    )
    return normalized_model


def _rebuild_union(args: tuple[Any, ...]) -> Any:
    if not args:
        return Any
    result = args[0]
    for arg in args[1:]:
        result = result | arg
    return result


def _get_literal_enum_base():
    try:
        from literalenum import LiteralEnum
    except Exception:
        return None
    return LiteralEnum


def _ensure_pydantic_support(annotation: type[Any]) -> None:
    if hasattr(annotation, "__get_pydantic_core_schema__"):
        return

    try:
        from pydantic_core import core_schema
    except Exception:
        return

    literal_values = literal_enum_values(annotation)

    @classmethod
    def __get_pydantic_core_schema__(cls, source_type: Any, handler: Any) -> Any:
        return core_schema.literal_schema(list(literal_values))

    @classmethod
    def __get_pydantic_json_schema__(cls, schema: Any, handler: Any) -> Any:
        return handler(schema)

    setattr(annotation, "__get_pydantic_core_schema__", __get_pydantic_core_schema__)
    setattr(annotation, "__get_pydantic_json_schema__", __get_pydantic_json_schema__)
