from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import tempfile
import textwrap
import unittest
from pathlib import Path

from plat import Controller, GET, RouteContext, create_server, discover_controller_classes
from plat import HttpError, created
from plat.cli_main import generate_openapi_from_source, write_openapi_spec


def ensure_server_runtime() -> None:
    required = ("fastapi", "starlette", "pydantic")
    missing = [name for name in required if importlib.util.find_spec(name) is None]
    if missing:
        raise unittest.SkipTest(
            f"Python server tests require optional dependencies: {', '.join(missing)}"
        )


def invoke_route(server, path: str, method: str = "GET", query_string: bytes = b"", body: bytes = b"", headers: list[tuple[bytes, bytes]] | None = None):
    from starlette.requests import Request
    from starlette.responses import Response

    route = next(
        route
        for route in server.get_app().routes
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set())
    )
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "scheme": "http",
        "query_string": query_string,
        "headers": headers or [],
        "client": ("testclient", 123),
        "server": ("testserver", 80),
        "path_params": {},
        "app": server.get_app(),
    }

    received = False

    async def receive():
        nonlocal received
        if received:
            return {"type": "http.disconnect"}
        received = True
        return {"type": "http.request", "body": body, "more_body": False}

    request = Request(scope, receive)
    response = Response()
    result = asyncio.run(route.endpoint(request, response))
    if hasattr(result, "status_code") and hasattr(result, "body"):
        body_value = getattr(result, "body", b"")
        payload = None
        if isinstance(body_value, bytes) and body_value:
            try:
                payload = json.loads(body_value.decode())
            except Exception:
                payload = body_value.decode()
        if getattr(result, "status_code", 200) >= 400:
            exc = Exception(payload)
            setattr(exc, "status_code", result.status_code)
            setattr(exc, "detail", payload)
            raise exc
        return payload
    return result


class DecoratorAndServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        ensure_server_runtime()

    def test_registers_flat_routes_from_controller_methods(self) -> None:
        @Controller("inventory", {"tag": "Inventory"})
        class InventoryApi:
            @GET()
            def listInventory(self, input: dict, ctx: RouteContext):
                return {"ok": True}

        server = create_server()
        server.register(InventoryApi)

        self.assertIn(
            {"method": "GET", "path": "/listInventory", "methodName": "listInventory"},
            server.routes,
        )

    def test_decorated_methods_remain_plain_instance_methods(self) -> None:
        @Controller("orders")
        class OrdersApi:
            @GET()
            def getOrder(self, input: dict[str, str], ctx: RouteContext):
                return {"id": input["id"], "status": "pending"}

            def duplicateOrder(self, order_id: str) -> dict[str, str]:
                return self.getOrder({"id": order_id}, RouteContext(method="GET", url="/getOrder"))

        instance = OrdersApi()

        self.assertEqual(
            instance.duplicateOrder("ord_123"),
            {"id": "ord_123", "status": "pending"},
        )
        self.assertIn("__plat_route_meta__", OrdersApi.getOrder.__dict__)

    def test_normalizes_query_aliases_and_passes_context(self) -> None:
        captured: dict[str, object] = {}

        @Controller("search")
        class SearchApi:
            @GET()
            def listProducts(self, input: dict, ctx: RouteContext):
                captured["input"] = input
                captured["url"] = ctx.url
                return {"ok": True, "q": input.get("q")}

        server = create_server()
        server.register(SearchApi)
        result = invoke_route(server, "/listProducts", query_string=b"query=apple&page=2&pageSize=5")

        self.assertEqual(result, {"ok": True, "q": "apple"})
        self.assertEqual(captured["url"], "/listProducts")
        self.assertEqual(
            captured["input"],
            {"q": "apple", "limit": 5, "offset": 5},
        )

    def test_tools_endpoint_includes_metadata_and_filters(self) -> None:
        @Controller("orders")
        class OrdersApi:
            @GET(
                {
                    "summary": "List orders",
                    "description": "List all visible orders",
                    "tags": ["public"],
                    "safe": True,
                }
            )
            def listOrders(self, input: dict, ctx: RouteContext):
                return {"items": []}

            @GET(
                {
                    "description": "Start a background import",
                    "tags": ["internal"],
                    "hidden": True,
                    "longRunning": True,
                    "safe": False,
                }
            )
            def importOrders(self, input: dict, ctx: RouteContext):
                return {"ok": True}

        server = create_server()
        server.register(OrdersApi)

        tools_route = next(
            route
            for route in server.get_app().routes
            if getattr(route, "path", None) == "/tools" and "GET" in getattr(route, "methods", set())
        )

        visible = asyncio.run(tools_route.endpoint())
        safe_only = asyncio.run(tools_route.endpoint(safeOnly=True))
        internal = asyncio.run(tools_route.endpoint(includeHidden=True, tag="internal", longRunning=True))
        openai_visible = asyncio.run(tools_route.endpoint(fmt="openai"))

        self.assertEqual([tool["name"] for tool in visible], ["listOrders"])
        self.assertEqual(visible[0]["summary"], "List orders")
        self.assertEqual(visible[0]["description"], "List all visible orders")
        self.assertEqual(visible[0]["tags"], ["orders", "public"])
        self.assertEqual([tool["name"] for tool in safe_only], ["listOrders"])
        self.assertEqual([tool["name"] for tool in internal], ["importOrders"])
        self.assertTrue(internal[0]["hidden"])
        self.assertTrue(internal[0]["longRunning"])
        self.assertEqual(openai_visible[0]["type"], "function")
        self.assertEqual(openai_visible[0]["function"]["name"], "listOrders")

    def test_discovers_python_api_modules_from_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            api_path = root / "widgets.api.py"
            api_path.write_text(
                textwrap.dedent(
                    """
                    from plat import Controller, GET

                    @Controller("widgets")
                    class WidgetsApi:
                        @GET()
                        def listWidgets(self, input, ctx):
                            return {"items": []}
                    """
                ).strip()
            )

            controllers = discover_controller_classes("*.api.py", root=root)

        self.assertEqual([controller.__name__ for controller in controllers], ["WidgetsApi"])

    def test_generates_openapi_from_python_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            api_path = root / "widgets.api.py"
            api_path.write_text(
                textwrap.dedent(
                    """
                    from pydantic import BaseModel
                    from plat import Controller, GET, POST, RouteContext

                    class ListWidgetsInput(BaseModel):
                        q: str | None = None

                    class Widget(BaseModel):
                        id: str
                        name: str

                    @Controller("widgets", {"tag": "Widgets"})
                    class WidgetsApi:
                        @GET()
                        def listWidgets(self, input: ListWidgetsInput, ctx: RouteContext) -> list[Widget]:
                            return [Widget(id="w1", name=input.q or "demo")]

                        @POST()
                        def createWidget(self, input: dict, ctx: RouteContext) -> dict:
                            return {"ok": True}
                    """
                ).strip()
            )

            cwd = Path.cwd()
            try:
                os.chdir(root)
                spec = generate_openapi_from_source("*.api.py")
            finally:
                os.chdir(cwd)

        self.assertEqual(spec["openapi"], "3.1.0")
        self.assertIn("/listWidgets", spec["paths"])
        self.assertIn("get", spec["paths"]["/listWidgets"])
        self.assertEqual(spec["paths"]["/listWidgets"]["get"]["operationId"], "listWidgets")

    def test_writes_openapi_as_json_and_yaml(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            json_path = root / "openapi.json"
            yaml_path = root / "openapi.yaml"
            spec = {
                "openapi": "3.1.0",
                "info": {"title": "Test", "version": "1.0.0"},
                "paths": {},
            }

            write_openapi_spec(json_path, spec)
            write_openapi_spec(yaml_path, spec)

            self.assertEqual(json.loads(json_path.read_text(encoding="utf-8"))["openapi"], "3.1.0")
            yaml_text = yaml_path.read_text(encoding="utf-8")
            self.assertIn("openapi: 3.1.0", yaml_text)

    def test_rate_limit_blocks_when_bucket_exhausted(self) -> None:
        @Controller("limited")
        class LimitedApi:
            @GET({"rateLimit": {"key": ":route", "cost": 1, "config": {"maxBalance": 1, "fillInterval": 60_000, "fillAmount": 1}}})
            def listLimited(self, input: dict, ctx: RouteContext):
                return {"ok": True}

        server = create_server({"rate_limit": {"configs": {}}})
        server.register(LimitedApi)

        first = invoke_route(server, "/listLimited")
        self.assertEqual(first, {"ok": True})

        with self.assertRaises(Exception) as second:
            invoke_route(server, "/listLimited")

        self.assertEqual(getattr(second.exception, "status_code", None), 429)

    def test_cache_returns_cached_value_on_second_request(self) -> None:
        calls = {"count": 0}

        @Controller("cached")
        class CachedApi:
            @GET({"cache": {"key": ":route:{q}", "ttl": 60}})
            def listCached(self, input: dict, ctx: RouteContext):
                calls["count"] += 1
                return {"count": calls["count"], "q": input.get("q")}

        server = create_server({"cache": {}})
        server.register(CachedApi)

        first = invoke_route(server, "/listCached", query_string=b"q=apple")
        second = invoke_route(server, "/listCached", query_string=b"q=apple")

        self.assertEqual(first, {"count": 1, "q": "apple"})
        self.assertEqual(second, {"count": 1, "q": "apple"})
        self.assertEqual(calls["count"], 1)

    def test_token_limit_deducts_response_cost(self) -> None:
        @Controller("tokened")
        class TokenedApi:
            @GET(
                {
                    "tokenLimit": {
                        "key": ":route",
                        "callCost": 2,
                        "responseCost": 3,
                        "config": {
                            "maxBalance": 10,
                            "fillInterval": 60_000,
                            "fillAmount": 1,
                        },
                    }
                }
            )
            def listTokened(self, input: dict, ctx: RouteContext):
                return {"ok": True, "seen": True}

        balances: list[float] = []

        class TokenController:
            def __init__(self):
                self.balance = 10

            def check(self, key, config):
                return self.balance

            def deduct(self, key, cost, config):
                self.balance -= cost
                balances.append(self.balance)
                return self.balance

            def refund(self, key, cost, config):
                self.balance += cost

        server = create_server({"token_limit": {"controller": TokenController(), "configs": {}}})
        server.register(TokenedApi)

        result = invoke_route(server, "/listTokened")

        self.assertEqual(result, {"ok": True, "seen": True})
        self.assertEqual(balances, [8, 5])

    def test_file_queue_processes_requests_without_http(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            inbox = Path(tmpdir) / "inbox"
            outbox = Path(tmpdir) / "outbox"
            inbox.mkdir()
            outbox.mkdir()

            @Controller("queued")
            class QueuedApi:
                @GET()
                def listQueued(self, input: dict, ctx: RouteContext):
                    if ctx.call:
                        ctx.call["log"]({"seen": input.get("q")})
                    return {"ok": True, "q": input.get("q")}

            server = create_server({"file_queue": {"inbox": str(inbox), "outbox": str(outbox)}})
            server.register(QueuedApi)

            (inbox / "job-1.json").write_text(
                json.dumps({
                    "id": "job-1",
                    "operationId": "listQueued",
                    "method": "GET",
                    "path": "/listQueued",
                    "input": {"q": "apple"},
                }),
                encoding="utf-8",
            )

            server._process_file_queue_once()

            response = json.loads((outbox / "job-1.response.json").read_text(encoding="utf-8"))
            events = (outbox / "job-1.events.jsonl").read_text(encoding="utf-8").strip().splitlines()

            self.assertEqual(response["ok"], True)
            self.assertEqual(response["result"], {"ok": True, "q": "apple"})
            self.assertEqual(json.loads(events[0])["event"], "log")

    def test_http_error_bubbles_with_status_code(self) -> None:
        @Controller("errors")
        class ErrorApi:
            @GET()
            def getError(self, input: dict, ctx: RouteContext):
                raise HttpError(409, "Conflict", {"code": "already_exists"})

        server = create_server()
        server.register(ErrorApi)

        with self.assertRaises(Exception) as raised:
            invoke_route(server, "/getError")

        self.assertEqual(getattr(raised.exception, "status_code", None), 409)

    def test_success_response_can_be_raised(self) -> None:
        @Controller("created")
        class CreatedApi:
            @GET()
            def getCreated(self, input: dict, ctx: RouteContext):
                raise created({"id": "item-1"})

        server = create_server()
        server.register(CreatedApi)
        route = next(
            route
            for route in server.get_app().routes
            if getattr(route, "path", None) == "/getCreated" and "GET" in getattr(route, "methods", set())
        )

        from starlette.requests import Request
        from starlette.responses import Response

        scope = {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "path": "/getCreated",
            "raw_path": b"/getCreated",
            "root_path": "",
            "scheme": "http",
            "query_string": b"",
            "headers": [],
            "client": ("testclient", 123),
            "server": ("testserver", 80),
            "path_params": {},
            "app": server.get_app(),
        }

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        response = asyncio.run(route.endpoint(Request(scope, receive), Response()))

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.body, b'{"id":"item-1"}')
