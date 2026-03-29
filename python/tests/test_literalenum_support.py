from __future__ import annotations

import importlib.util
import inspect
import unittest
from typing import Literal, get_args, get_origin

from plat.literalenum_support import is_literal_enum_type, make_pydantic_annotation, normalize_annotation


class _FakeLiteralEnumMeta(type):
    def __iter__(cls):
        return iter(cls.values())


class Color(metaclass=_FakeLiteralEnumMeta):
    RED = "red"
    BLUE = "blue"
    mapping = {"RED": "red", "BLUE": "blue"}

    @classmethod
    def values(cls):
        return ["red", "blue"]


class LiteralEnumSupportTests(unittest.TestCase):
    def test_detects_literal_enum_like_classes(self) -> None:
        self.assertTrue(is_literal_enum_type(Color))
        self.assertFalse(is_literal_enum_type(str))

    def test_normalizes_literal_enum_to_literal_values(self) -> None:
        normalized = normalize_annotation(Color)
        self.assertIs(get_origin(normalized), Literal)
        self.assertEqual(get_args(normalized), ("red", "blue"))

    @unittest.skipUnless(importlib.util.find_spec("pydantic") is not None, "pydantic not installed")
    def test_normalizes_pydantic_models_that_reference_literal_enum(self) -> None:
        from pydantic import BaseModel

        class Palette(BaseModel):
            color: Color

        normalized = make_pydantic_annotation(Palette)

        self.assertTrue(inspect.isclass(normalized))
        self.assertNotEqual(normalized, Palette)
        self.assertIs(get_origin(normalized.model_fields["color"].annotation), Literal)
