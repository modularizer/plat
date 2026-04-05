from __future__ import annotations

import asyncio
import textwrap
import unittest

from plat_browser import (
    BrowserPLATServer,
    BucketConfig,
    Controller,
    HttpError,
    POST,
    RouteContext,
    connect_client_side_server,
    prepare_python_source,
    run_python_client_source,
    serve_client_side_server,
)
from plat_browser.client import _set_browser_client_bridge


class PlatBrowserTests(unittest.TestCase):
    def setUp(self) -> None:
        async def missing_connect(_: str):
            raise RuntimeError("connect bridge not installed")

        async def missing_call(_: int, __: str, ___):
            raise RuntimeError("call bridge not installed")

        _set_browser_client_bridge(missing_connect, missing_call)

    def test_prepare_python_source_hides_pip_lines_and_detects_imports(self) -> None:
        plan = prepare_python_source(
            textwrap.dedent(
                """
                !pip install pandas fastapi
                import pandas as pd
                import json
                from plat_browser import serve_client_side_server
                from numpy.random import rand
                """
            ).strip()
        )

        self.assertEqual(plan.requested_packages, ["pandas", "fastapi"])
        self.assertEqual(plan.imported_modules, ["pandas", "numpy"])
        self.assertNotIn("!pip install", plan.python_source)

    def test_serve_client_side_server_returns_definition(self) -> None:
        class DemoApi:
            def add(self, a, b, ctx):
                return a + b

        definition = serve_client_side_server("browser-math", [DemoApi], undecorated_mode="POST")

        self.assertEqual(definition.server_name, "browser-math")
        self.assertEqual(definition.controllers, [DemoApi])
        self.assertEqual(definition.options["undecorated_mode"], "POST")

    def test_browser_server_registers_undecorated_public_methods_as_post(self) -> None:
        class DemoApi:
            def add(self, a: int, b: int, ctx: RouteContext) -> int:
                return a + b

            def _private(self, input, ctx):
                return None

        server = BrowserPLATServer({}, DemoApi)

        self.assertIn({"method": "POST", "path": "/add", "methodName": "add"}, server.routes)
        self.assertNotIn("_private", server.operations_by_id)
        self.assertEqual(server.openapi["paths"]["/add"]["post"]["operationId"], "add")
        schema = server.openapi["paths"]["/add"]["post"]["requestBody"]["content"]["application/json"]["schema"]
        self.assertEqual(schema["properties"]["a"]["type"], "integer")
        self.assertEqual(schema["properties"]["b"]["type"], "integer")
        self.assertEqual(schema["required"], ["a", "b"])

    def test_browser_server_uses_decorated_metadata_and_docstrings(self) -> None:
        @Controller()
        class OrdersApi:
            @POST()
            def createOrder(self, input: dict[str, str], ctx: RouteContext) -> dict[str, str]:
                """Create one order.

                Longer description for docs.
                """

                return {"orderId": "ord_123"}

        server = BrowserPLATServer({}, OrdersApi)
        operation = server.openapi["paths"]["/createOrder"]["post"]

        self.assertEqual(operation["summary"], "Create one order.")
        self.assertIn("Longer description", operation["description"])

    def test_browser_server_dispatches_requests_and_emits_progress(self) -> None:
        class JobsApi:
            async def countTo(self, end: int, ctx: RouteContext) -> dict[str, int]:
                for index in range(1, end + 1):
                    ctx.call.progress({"current": index, "end": end})
                return {"done": end}

        server = BrowserPLATServer({}, JobsApi)
        events: list[dict[str, object]] = []

        result = asyncio.run(
            server.handle_request(
                {
                    "operationId": "countTo",
                    "method": "POST",
                    "path": "/countTo",
                    "input": {"end": 3},
                },
                emit=events.append,
            )
        )

        self.assertEqual(result, {"done": 3})
        self.assertEqual(
            events,
            [
                {"event": "progress", "data": {"current": 1, "end": 3}},
                {"event": "progress", "data": {"current": 2, "end": 3}},
                {"event": "progress", "data": {"current": 3, "end": 3}},
            ],
        )

    def test_browser_server_keeps_legacy_single_input_param_working(self) -> None:
        class LegacyApi:
            def add(self, input: dict[str, int], ctx: RouteContext) -> int:
                return input["a"] + input["b"]

        server = BrowserPLATServer({}, LegacyApi)
        result = asyncio.run(
            server.handle_request(
                {
                    "operationId": "add",
                    "method": "POST",
                    "path": "/add",
                    "input": {"a": 2, "b": 5},
                }
            )
        )
        self.assertEqual(result, 7)

    def test_browser_server_normalizes_proxy_like_request_objects(self) -> None:
        class DemoApi:
            def add(self, a: int, b: int, ctx: RouteContext) -> int:
                return a + b

        class FakeProxy:
            def __init__(self, payload):
                self._payload = payload

            def to_py(self):
                return self._payload

        server = BrowserPLATServer({}, DemoApi)
        result = asyncio.run(
            server.handle_request(
                FakeProxy(
                    {
                        "operationId": "add",
                        "method": "POST",
                        "path": "/add",
                        "input": {"a": 9, "b": 4},
                    }
                )
            )
        )
        self.assertEqual(result, 13)

    def test_browser_server_enforces_auth_and_populates_ctx(self) -> None:
        class SecureApi:
            def secret(self, ctx: RouteContext) -> str:
                return f"hello {ctx.auth['sub']}"

        async def verify(mode, request, ctx):
            self.assertEqual(mode, "user")
            token = request.get("headers", {}).get("authorization")
            if token != "Bearer good":
                raise HttpError(401, "Missing or invalid authorization token")
            return {"sub": "demo-user"}

        server = BrowserPLATServer(
            {
                "auth": {"verify": verify},
                "default_auth": "user",
            },
            SecureApi,
        )

        result = asyncio.run(
            server.handle_request(
                {
                    "operationId": "secret",
                    "method": "POST",
                    "path": "/secret",
                    "headers": {"authorization": "Bearer good"},
                }
            )
        )

        self.assertEqual(result, "hello demo-user")
        with self.assertRaises(HttpError) as error:
            asyncio.run(
                server.handle_request(
                    {
                        "operationId": "secret",
                        "method": "POST",
                        "path": "/secret",
                        "headers": {},
                    }
                )
            )
        self.assertEqual(error.exception.status_code, 401)

    def test_browser_server_supports_cache(self) -> None:
        calls = 0

        class DemoApi:
            def add(self, a: int, b: int, ctx: RouteContext) -> int:
                nonlocal calls
                calls += 1
                return a + b

        server = BrowserPLATServer(
            {
                "cache": {
                    "controller": None,
                },
            },
            DemoApi,
        )
        operation = server.operations_by_id["add"]
        operation.route_meta.cache = {"key": "sum:{a}:{b}", "methods": ["POST"], "ttl": 60}

        first = asyncio.run(
            server.handle_request(
                {
                    "operationId": "add",
                    "method": "POST",
                    "path": "/add",
                    "input": {"a": 1, "b": 4},
                }
            )
        )
        second = asyncio.run(
            server.handle_request(
                {
                    "operationId": "add",
                    "method": "POST",
                    "path": "/add",
                    "input": {"a": 1, "b": 4},
                }
            )
        )

        self.assertEqual(first, 5)
        self.assertEqual(second, 5)
        self.assertEqual(calls, 1)

    def test_browser_server_supports_rate_limit(self) -> None:
        class DemoApi:
            def add(self, a: int, b: int, ctx: RouteContext) -> int:
                return a + b

        server = BrowserPLATServer(
            {
                "rate_limit": {
                    "configs": {
                        "add": BucketConfig(max_balance=1, fill_interval=60_000, fill_amount=1),
                    },
                },
            },
            DemoApi,
        )
        operation = server.operations_by_id["add"]
        operation.route_meta.rate_limit = {"key": "add", "cost": 1}

        self.assertEqual(
            asyncio.run(
                server.handle_request(
                    {
                        "operationId": "add",
                        "method": "POST",
                        "path": "/add",
                        "input": {"a": 2, "b": 3},
                    }
                )
            ),
            5,
        )
        with self.assertRaises(HttpError) as error:
            asyncio.run(
                server.handle_request(
                    {
                        "operationId": "add",
                        "method": "POST",
                        "path": "/add",
                        "input": {"a": 2, "b": 3},
                    }
                )
            )
        self.assertEqual(error.exception.status_code, 429)

    def test_browser_server_supports_token_limit(self) -> None:
        class DemoApi:
            def add(self, a: int, b: int, ctx: RouteContext) -> int:
                return a + b

        server = BrowserPLATServer(
            {
                "token_limit": {
                    "configs": {
                        "tokens": BucketConfig(max_balance=2, fill_interval=60_000, fill_amount=1),
                    },
                },
            },
            DemoApi,
        )
        operation = server.operations_by_id["add"]
        operation.route_meta.token_limit = {"key": "tokens", "call_cost": 2}

        self.assertEqual(
            asyncio.run(
                server.handle_request(
                    {
                        "operationId": "add",
                        "method": "POST",
                        "path": "/add",
                        "input": {"a": 10, "b": 5},
                    }
                )
            ),
            15,
        )
        with self.assertRaises(HttpError) as error:
            asyncio.run(
                server.handle_request(
                    {
                        "operationId": "add",
                        "method": "POST",
                        "path": "/add",
                        "input": {"a": 10, "b": 5},
                    }
                )
            )
        self.assertEqual(error.exception.status_code, 429)

    def test_browser_python_client_connects_and_calls_with_kwargs(self) -> None:
        async def fake_connect(base_url: str, options=None):
            return {"client_id": 7, "base_url": base_url, "openapi": {"paths": {"/add": {"post": {}}}}}

        async def fake_call(client_id: int, method_name: str, payload):
            self.assertEqual(client_id, 7)
            self.assertEqual(method_name, "add")
            self.assertEqual(payload, {"a": 20, "b": 22})
            return 42

        _set_browser_client_bridge(fake_connect, fake_call)

        async def scenario():
            client = await connect_client_side_server("css://browser-python-math")
            return await client.add(a=20, b=22)

        self.assertEqual(asyncio.run(scenario()), 42)

    def test_run_python_client_source_returns_last_expression(self) -> None:
        async def fake_connect(base_url: str, options=None):
            return {"client_id": 11, "base_url": base_url}

        async def fake_call(client_id: int, method_name: str, payload):
            self.assertEqual(client_id, 11)
            self.assertEqual(method_name, "add")
            self.assertEqual(payload, {"a": 3, "b": 9})
            return 12

        _set_browser_client_bridge(fake_connect, fake_call)

        result = asyncio.run(
            run_python_client_source(
                """
from plat_browser import connect_client_side_server

client = await connect_client_side_server("css://browser-python-math")
await client.add(a=3, b=9)
""".strip()
            )
        )
        self.assertEqual(result, 12)
