from __future__ import annotations

import inspect
import re
import types
from dataclasses import fields, is_dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, get_args, get_origin, get_type_hints


RELATIVE_RE = re.compile(
    r"^(\d+)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|yr|year|years)(?:\s+ago)?$",
    re.IGNORECASE,
)


def parse_relative_date(input_value: str, now: datetime | None = None) -> datetime | None:
    now = now or datetime.now()
    s = input_value.strip().lower()

    if s in {"now", "today"}:
        return now
    if s == "yesterday":
        return now - timedelta(days=1)
    if s == "tomorrow":
        return now + timedelta(days=1)

    match = RELATIVE_RE.match(s)
    if match is None:
        return None

    amount = int(match.group(1))
    unit = match.group(2).lower()
    sign = -1 if "ago" in s else 1

    ms_units = {
        "ms": 1,
        "millisecond": 1,
        "milliseconds": 1,
        "s": 1000,
        "sec": 1000,
        "secs": 1000,
        "second": 1000,
        "seconds": 1000,
        "m": 60_000,
        "min": 60_000,
        "mins": 60_000,
        "minute": 60_000,
        "minutes": 60_000,
        "h": 3_600_000,
        "hr": 3_600_000,
        "hrs": 3_600_000,
        "hour": 3_600_000,
        "hours": 3_600_000,
        "d": 86_400_000,
        "day": 86_400_000,
        "days": 86_400_000,
        "w": 604_800_000,
        "week": 604_800_000,
        "weeks": 604_800_000,
    }

    if unit in ms_units:
        return now + timedelta(milliseconds=sign * amount * ms_units[unit])
    if unit in {"mo", "month", "months"}:
        return _add_months(now, sign * amount)
    if unit in {"y", "yr", "year", "years"}:
        return _add_years(now, sign * amount)
    return None


def parse_dateish(value: Any, now: datetime | None = None, date_only: bool = False) -> datetime | date | None:
    now = now or datetime.now()

    if isinstance(value, datetime):
        return _start_of_day(value).date() if date_only else value
    if isinstance(value, date):
        return value if date_only else datetime.combine(value, datetime.min.time())
    if isinstance(value, (int, float)):
        dt = datetime.fromtimestamp(value / 1000 if value > 10_000_000_000 else value)
        return _start_of_day(dt).date() if date_only else dt
    if not isinstance(value, str):
        return None

    s = value.strip()
    if not s:
        return None

    rel = parse_relative_date(s, now)
    if rel is not None:
        return _start_of_day(rel).date() if date_only else rel

    absolute = _parse_datetime_string(s)
    if absolute is None:
        return None
    return _start_of_day(absolute).date() if date_only else absolute


def coerce_dateish_for_annotation(
    value: Any,
    annotation: Any,
    input_coercers: dict[type[Any], Callable[[Any], Any]] | None = None,
) -> Any:
    if value is None or annotation in {None, Any, inspect.Signature.empty}:
        return value

    custom = _apply_registered_input_coercer(value, annotation, input_coercers)
    if custom is not _UNHANDLED:
        return custom

    if annotation is datetime:
        return parse_dateish(value, date_only=False) or value
    if annotation is date:
        return parse_dateish(value, date_only=True) or value
    if annotation is int:
        return _coerce_int(value)
    if annotation is float:
        return _coerce_float(value)
    if annotation is bool:
        return _coerce_bool(value)

    origin = get_origin(annotation)
    if origin in {types.UnionType, getattr(types, "UnionType", object())} or str(origin).endswith("Union"):
        union_args = list(get_args(annotation))
        # Prefer concrete numeric/date branches before bool so strings like "1"
        # become ints in `int | bool` annotations instead of eagerly becoming True.
        union_args.sort(key=_union_annotation_priority)
        for arg in union_args:
            coerced = coerce_dateish_for_annotation(value, arg, input_coercers)
            if coerced is not value:
                return coerced
        return value

    if origin in {list, set, frozenset} and isinstance(value, list):
        item_annotation = get_args(annotation)[0] if get_args(annotation) else Any
        coerced_items = [coerce_dateish_for_annotation(item, item_annotation, input_coercers) for item in value]
        if origin is set:
            return set(coerced_items)
        if origin is frozenset:
            return frozenset(coerced_items)
        return coerced_items

    if origin is tuple and isinstance(value, (list, tuple)):
        args = get_args(annotation)
        if len(args) == 2 and args[1] is Ellipsis:
            return tuple(coerce_dateish_for_annotation(item, args[0], input_coercers) for item in value)
        return tuple(
            coerce_dateish_for_annotation(item, args[index], input_coercers) if index < len(args) else item
            for index, item in enumerate(value)
        )

    if origin is dict and isinstance(value, dict):
        args = get_args(annotation)
        value_annotation = args[1] if len(args) > 1 else Any
        return {key: coerce_dateish_for_annotation(item, value_annotation, input_coercers) for key, item in value.items()}

    try:
        from pydantic import BaseModel
    except ImportError:
        BaseModel = None  # type: ignore[assignment]

    if BaseModel is not None and inspect.isclass(annotation) and issubclass(annotation, BaseModel) and isinstance(value, dict):
        coerced = dict(value)
        for field_name, field_info in annotation.model_fields.items():
            if field_name in coerced:
                coerced[field_name] = coerce_dateish_for_annotation(
                    coerced[field_name],
                    field_info.annotation,
                    input_coercers,
                )
        return coerced

    if inspect.isclass(annotation) and is_dataclass(annotation) and isinstance(value, dict):
        coerced = dict(value)
        field_types = get_type_hints(annotation)
        for field in fields(annotation):
            if field.name in coerced:
                coerced[field.name] = coerce_dateish_for_annotation(
                    coerced[field.name],
                    field_types.get(field.name, field.type),
                    input_coercers,
                )
        return coerced

    return value


_UNHANDLED = object()


def _apply_registered_input_coercer(
    value: Any,
    annotation: Any,
    input_coercers: dict[type[Any], Callable[[Any], Any]] | None,
) -> Any:
    if not input_coercers:
        return _UNHANDLED

    target_type = _resolve_runtime_target_type(annotation)
    if target_type is None:
        return _UNHANDLED

    coercer = _find_registered_handler(target_type, input_coercers)
    if coercer is None:
        return _UNHANDLED
    return coercer(value)


def _resolve_runtime_target_type(annotation: Any) -> type[Any] | None:
    if inspect.isclass(annotation):
        return annotation
    origin = get_origin(annotation)
    if inspect.isclass(origin):
        return origin
    return None


def _find_registered_handler(
    target_type: type[Any],
    registry: dict[type[Any], Callable[[Any], Any]],
) -> Callable[[Any], Any] | None:
    if target_type in registry:
        return registry[target_type]
    for cls in target_type.__mro__[1:]:
        if cls in registry:
            return registry[cls]
    return None


def _parse_datetime_string(value: str) -> datetime | None:
    try:
        if value.endswith("Z"):
            return datetime.fromisoformat(value[:-1] + "+00:00")
        return datetime.fromisoformat(value)
    except ValueError:
        pass

    for parser in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, parser)
        except ValueError:
            continue
    return None


def _start_of_day(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, _days_in_month(year, month))
    return value.replace(year=year, month=month, day=day)


def _add_years(value: datetime, years: int) -> datetime:
    target_year = value.year + years
    day = min(value.day, _days_in_month(target_year, value.month))
    return value.replace(year=target_year, day=day)


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        next_month = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        next_month = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    current_month = datetime(year, month, 1, tzinfo=timezone.utc)
    return (next_month - current_month).days


def _coerce_int(value: Any) -> Any:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        s = value.strip()
        if re.fullmatch(r"[-+]?\d+", s):
            return int(s)
    return value


def _coerce_float(value: Any) -> Any:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        s = value.strip()
        try:
            return float(s)
        except ValueError:
            return value
    return value


def _coerce_bool(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        s = value.strip().lower()
        if s in {"true", "1", "yes", "y", "on"}:
            return True
        if s in {"false", "0", "no", "n", "off", ""}:
            return False
    return value


def _union_annotation_priority(annotation: Any) -> int:
    if annotation is bool:
        return 100
    if annotation is Any or annotation is inspect.Signature.empty:
        return 200
    return 0
