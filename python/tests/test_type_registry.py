from __future__ import annotations

import unittest
from decimal import Decimal

from plat.date_coerce import coerce_dateish_for_annotation
from plat.response_serialize import serialize_for_response
from plat.type_registry import register_input_coercer, register_output_serializer


class TypeRegistryTests(unittest.TestCase):
    def test_registered_input_coercer_runs_for_exact_type(self) -> None:
        registry: dict[type[object], object] = {}
        register_input_coercer(registry, Decimal, lambda value: Decimal(str(value)))

        coerced = coerce_dateish_for_annotation("12.50", Decimal, registry)

        self.assertEqual(coerced, Decimal("12.50"))

    def test_registered_input_coercer_runs_for_nested_annotations(self) -> None:
        registry: dict[type[object], object] = {}
        register_input_coercer(registry, Decimal, lambda value: Decimal(str(value)))

        coerced = coerce_dateish_for_annotation({"prices": ["1.25", "2.50"]}, dict[str, list[Decimal]], registry)

        self.assertEqual(coerced, {"prices": [Decimal("1.25"), Decimal("2.50")]})

    def test_registered_output_serializer_runs_for_exact_type(self) -> None:
        registry: dict[type[object], object] = {}
        register_output_serializer(registry, Decimal, lambda value: f"{value:.2f}")

        serialized = serialize_for_response({"price": Decimal("12.5")}, registry)

        self.assertEqual(serialized, {"price": "12.50"})

    def test_registered_output_serializer_runs_for_subclasses(self) -> None:
        class Money:
            def __init__(self, amount: str) -> None:
                self.amount = amount

        class Price(Money):
            ...

        registry: dict[type[object], object] = {}
        register_output_serializer(registry, Money, lambda value: value.amount)

        serialized = serialize_for_response(Price("3.0"), registry)

        self.assertEqual(serialized, "3.0")
