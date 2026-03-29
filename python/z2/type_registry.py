from __future__ import annotations

from typing import Any

from .server_types import InputCoercer, OutputSerializer


def register_input_coercer(
    registry: dict[type[Any], InputCoercer],
    type_: type[Any],
    coercer: InputCoercer,
) -> dict[type[Any], InputCoercer]:
    registry[type_] = coercer
    return registry


def register_output_serializer(
    registry: dict[type[Any], OutputSerializer],
    type_: type[Any],
    serializer: OutputSerializer,
) -> dict[type[Any], OutputSerializer]:
    registry[type_] = serializer
    return registry
