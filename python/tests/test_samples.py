from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import unittest
from pathlib import Path

from plat import create_server


BASIC_SAMPLES_ROOT = Path(__file__).resolve().parent.parent / "samples" / "basic"
LONG_RUNNING_SAMPLES_ROOT = Path(__file__).resolve().parent.parent / "samples" / "long_running"


def ensure_server_runtime() -> None:
    required = ("fastapi", "starlette", "pydantic")
    missing = [name for name in required if importlib.util.find_spec(name) is None]
    if missing:
        raise unittest.SkipTest(
            f"Python sample tests require optional dependencies: {', '.join(missing)}"
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
        if isinstance(body_value, bytes) and body_value:
            try:
                return json.loads(body_value.decode())
            except Exception:
                return body_value.decode()
        return None
    return result


def load_module(module_name: str, file_path: Path):
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module for {file_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class SampleServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        ensure_server_runtime()
        load_module("samples", BASIC_SAMPLES_ROOT.parent / "__init__.py")
        load_module("samples.basic", BASIC_SAMPLES_ROOT / "__init__.py")
        load_module("samples.long_running", LONG_RUNNING_SAMPLES_ROOT / "__init__.py")
        cls.samples_pkg = load_module("samples.basic.models", BASIC_SAMPLES_ROOT / "models.py")
        cls.products_mod = load_module("samples.basic.products_api", BASIC_SAMPLES_ROOT / "products.api.py")
        cls.orders_mod = load_module("samples.basic.orders_api", BASIC_SAMPLES_ROOT / "orders.api.py")
        cls.long_running_models = load_module("samples.long_running.models", LONG_RUNNING_SAMPLES_ROOT / "models.py")
        cls.long_running_mod = load_module("samples.long_running.imports_api", LONG_RUNNING_SAMPLES_ROOT / "imports.api.py")

    def test_sample_server_registers_both_controllers(self) -> None:
        server = create_server()
        server.register(self.products_mod.ProductsApi, self.orders_mod.OrdersApi)

        self.assertEqual(
            {route["path"] for route in server.routes},
            {"/listProducts", "/createProduct", "/listOrders"},
        )

    def test_sample_products_controller_filters_and_validates(self) -> None:
        server = create_server()
        server.register(self.products_mod.ProductsApi)

        result = invoke_route(server, "/listProducts", query_string=b"query=app&limit=2")

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["q"], "app")
        self.assertEqual(result["items"][0]["name"], "Apple")

    def test_sample_products_controller_creates_records(self) -> None:
        server = create_server()
        server.register(self.products_mod.ProductsApi)

        result = invoke_route(
            server,
            "/createProduct",
            method="POST",
            body=b'{"name":"Banana","price":2.25}',
            headers=[(b"content-type", b"application/json")],
        )

        self.assertEqual(result["name"], "Banana")
        self.assertEqual(result["price"], 2.25)

    def test_long_running_sample_emits_progress_and_completes(self) -> None:
        server = create_server()
        server.register(self.long_running_mod.CatalogImportsApi)

        result = invoke_route(
            server,
            "/importCatalog",
            method="POST",
            body=b'{"source":"s3://demo/catalog.csv","items":3}',
            headers=[(b"content-type", b"application/json")],
        )

        self.assertEqual(result["source"], "s3://demo/catalog.csv")
        self.assertEqual(result["imported"], 3)
        self.assertEqual(result["status"], "completed")
