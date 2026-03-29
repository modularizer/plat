from __future__ import annotations

import importlib.util
import unittest
from http import HTTPStatus

from plat import BadRequest, HttpError, ImATeapot, NotFound, TooManyRequests, created, no_content, ok
from plat.cli_main import coerce_toggle_or_path, parse_cors_flag, parse_toggle_or_path_flag
from plat.errors import HTTP_ERROR_TYPES, _status_to_class_name


class CliHelperTests(unittest.TestCase):
    def test_parse_toggle_or_path_flag_supports_boolean_values(self) -> None:
        self.assertTrue(parse_toggle_or_path_flag(["--swagger"], "--swagger"))
        self.assertFalse(parse_toggle_or_path_flag(["--swagger", "false"], "--swagger"))
        self.assertEqual(parse_toggle_or_path_flag(["--swagger", "/api-docs"], "--swagger"), "/api-docs")

    def test_parse_cors_flag_supports_boolean_or_origin(self) -> None:
        self.assertTrue(parse_cors_flag(["--cors"]))
        self.assertFalse(parse_cors_flag(["--cors", "off"]))
        self.assertEqual(parse_cors_flag(["--cors", "https://example.com"]), {"origin": "https://example.com"})

    def test_coerce_toggle_or_path_preserves_custom_paths(self) -> None:
        self.assertEqual(coerce_toggle_or_path("/docs-custom"), "/docs-custom")
        self.assertTrue(coerce_toggle_or_path("yes"))
        self.assertFalse(coerce_toggle_or_path("no"))

    def test_http_error_and_http_response_helpers(self) -> None:
        error = HttpError(404, "Missing widget", {"id": "w1"})
        self.assertEqual(error.status_code, 404)
        self.assertEqual(error.body, {"error": "Missing widget", "data": {"id": "w1"}})

        self.assertEqual(ok({"ok": True}).status_code, 200)
        self.assertEqual(created({"id": "w1"}).status_code, 201)
        self.assertEqual(no_content().status_code, 204)

    def test_named_http_error_types_are_exported(self) -> None:
        self.assertEqual(BadRequest().status_code, 400)
        self.assertEqual(NotFound("Missing").body["error"], "Missing")
        self.assertEqual(TooManyRequests().status_code, 429)
        self.assertEqual(ImATeapot().status_code, 418)

    def test_all_standard_http_error_statuses_have_named_types(self) -> None:
        expected = [status for status in HTTPStatus if int(status) >= 400]
        self.assertEqual(len(HTTP_ERROR_TYPES), len(expected))
        for status in expected:
            self.assertIn(_status_to_class_name(status), HTTP_ERROR_TYPES)
        for name, cls in HTTP_ERROR_TYPES.items():
            self.assertTrue(issubclass(cls, HttpError), name)


@unittest.skipUnless(importlib.util.find_spec("jwt") is not None, "PyJWT not installed")
class JwtHelperTests(unittest.TestCase):
    def test_sign_and_verify_token_round_trip(self) -> None:
        from plat import JwtAuthConfig, create_jwt_auth, sign_token

        class Request:
            headers = {"authorization": "Bearer PLACEHOLDER"}

        config = JwtAuthConfig(secret="secret", algorithms=["HS256"], issuer="plat", audience="tests", expires_in="1h")
        token = sign_token({"sub": "user-123"}, config)
        Request.headers["authorization"] = f"Bearer {token}"

        payload = create_jwt_auth(config).verify("jwt", Request(), None)

        self.assertEqual(payload["sub"], "user-123")
        self.assertEqual(payload["iss"], "plat")
        self.assertEqual(payload["aud"], "tests")
