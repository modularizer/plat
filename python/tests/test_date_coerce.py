from __future__ import annotations

import importlib.util
import unittest
from dataclasses import dataclass
from datetime import date, datetime

from plat.date_coerce import coerce_dateish_for_annotation, parse_dateish, parse_relative_date


class DateCoerceTests(unittest.TestCase):
    def test_parse_dateish_date_only(self) -> None:
        parsed = parse_dateish("2024-03-16", now=datetime(2024, 3, 20), date_only=True)
        self.assertEqual(parsed, date(2024, 3, 16))

    def test_parse_dateish_datetime(self) -> None:
        parsed = parse_dateish("2024-03-16T14:30:00+00:00", date_only=False)
        self.assertEqual(parsed.year, 2024)
        self.assertEqual(parsed.month, 3)
        self.assertEqual(parsed.day, 16)
        self.assertEqual(parsed.hour, 14)

    def test_parse_relative_date_keywords(self) -> None:
        now = datetime(2024, 3, 20, 12, 0, 0)
        self.assertEqual(parse_relative_date("today", now), now)
        self.assertEqual(parse_relative_date("yesterday", now).date(), date(2024, 3, 19))
        self.assertEqual(parse_relative_date("tomorrow", now).date(), date(2024, 3, 21))

    def test_parse_relative_date_offsets(self) -> None:
        now = datetime(2024, 3, 20, 12, 0, 0)
        self.assertEqual(parse_relative_date("1 day ago", now).date(), date(2024, 3, 19))
        self.assertEqual(parse_relative_date("2 hours", now).hour, 14)
        self.assertEqual(parse_relative_date("6 months", now).month, 9)

    def test_coerce_annotation_for_date_and_datetime(self) -> None:
        coerced_date = coerce_dateish_for_annotation("2024-03-16", date)
        coerced_datetime = coerce_dateish_for_annotation("1 hour ago", datetime)

        self.assertEqual(coerced_date, date(2024, 3, 16))
        self.assertIsInstance(coerced_datetime, datetime)

    def test_coerce_scalar_strings_to_numbers_and_bool(self) -> None:
        self.assertEqual(coerce_dateish_for_annotation("42", int), 42)
        self.assertEqual(coerce_dateish_for_annotation("3.14", float), 3.14)
        self.assertIs(coerce_dateish_for_annotation("yes", bool), True)
        self.assertIs(coerce_dateish_for_annotation("off", bool), False)

    def test_coerce_nested_collections(self) -> None:
        coerced_list = coerce_dateish_for_annotation(["1", "2"], list[int])
        coerced_tuple = coerce_dateish_for_annotation(["1", "true"], tuple[int, bool])
        coerced_dict = coerce_dateish_for_annotation({"a": "1.5"}, dict[str, float])

        self.assertEqual(coerced_list, [1, 2])
        self.assertEqual(coerced_tuple, (1, True))
        self.assertEqual(coerced_dict, {"a": 1.5})

    def test_coerce_nested_dataclass_fields(self) -> None:
        @dataclass
        class Event:
            count: int
            enabled: bool
            starts_on: date

        value = {
            "count": "7",
            "enabled": "true",
            "starts_on": "2024-03-16",
        }

        coerced = coerce_dateish_for_annotation(value, Event)

        self.assertEqual(coerced["count"], 7)
        self.assertIs(coerced["enabled"], True)
        self.assertEqual(coerced["starts_on"], date(2024, 3, 16))

    def test_union_prefers_number_over_bool_for_numeric_string(self) -> None:
        coerced = coerce_dateish_for_annotation("1", int | bool)
        self.assertEqual(coerced, 1)
        self.assertNotIsInstance(coerced, bool)

    @unittest.skipUnless(importlib.util.find_spec("pydantic") is not None, "pydantic not installed")
    def test_coerce_nested_pydantic_model_fields(self) -> None:
        from pydantic import BaseModel

        class Event(BaseModel):
            count: int
            enabled: bool
            starts_at: datetime
            starts_on: date

        value = {
            "count": "7",
            "enabled": "true",
            "starts_at": "2024-03-16T14:30:00+00:00",
            "starts_on": "2024-03-16",
        }

        coerced = coerce_dateish_for_annotation(value, Event)

        self.assertEqual(coerced["count"], 7)
        self.assertIs(coerced["enabled"], True)
        self.assertIsInstance(coerced["starts_at"], datetime)
        self.assertIsInstance(coerced["starts_on"], date)
