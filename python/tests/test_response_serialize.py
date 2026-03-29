from __future__ import annotations

import importlib.util
import unittest
from dataclasses import dataclass
from datetime import date, datetime, timezone

from plat.response_serialize import serialize_for_response


class ResponseSerializeTests(unittest.TestCase):
    def test_date_and_datetime_serialize_to_strings(self) -> None:
        value = {
            "created_at": datetime(2024, 3, 16, 14, 30, tzinfo=timezone.utc),
            "birthday": date(2024, 3, 16),
        }

        serialized = serialize_for_response(value)

        self.assertEqual(serialized["created_at"], "2024-03-16T14:30:00+00:00")
        self.assertEqual(serialized["birthday"], "2024-03-16")

    def test_nested_collections_serialize_recursively(self) -> None:
        value = [date(2024, 1, 1), {"items": (datetime(2024, 1, 2, 3, 4),)}]

        serialized = serialize_for_response(value)

        self.assertEqual(
            serialized,
            ["2024-01-01", {"items": ["2024-01-02T03:04:00"]}],
        )

    def test_dataclass_serializes_to_plain_dict(self) -> None:
        @dataclass
        class Event:
            starts_on: date
            counts: tuple[int, int]

        serialized = serialize_for_response(Event(date(2024, 3, 16), (1, 2)))

        self.assertEqual(serialized, {"starts_on": "2024-03-16", "counts": [1, 2]})

    @unittest.skipUnless(importlib.util.find_spec("pydantic") is not None, "pydantic not installed")
    def test_pydantic_model_serializes_to_plain_dict(self) -> None:
        from pydantic import BaseModel

        class Event(BaseModel):
            starts_on: date
            counts: tuple[int, int]

        serialized = serialize_for_response(Event(starts_on=date(2024, 3, 16), counts=(1, 2)))

        self.assertEqual(serialized, {"starts_on": "2024-03-16", "counts": [1, 2]})

    @unittest.skipUnless(importlib.util.find_spec("numpy") is not None, "numpy not installed")
    def test_numpy_values_serialize_to_plain_python(self) -> None:
        import numpy as np

        value = {
            "vector": np.array([1, 2, 3]),
            "scalar": np.int64(7),
        }

        serialized = serialize_for_response(value)

        self.assertEqual(serialized, {"vector": [1, 2, 3], "scalar": 7})
