from __future__ import annotations

import asyncio
import json
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from pathlib import Path

from plat.cli_main import generate_python_client
import plat.openapi_client as openapi_client_module
from plat.openapi_client import (
    DeferredCallHandle,
    OpenAPIPromiseClient,
    OpenAPISyncClient,
    PLATPromise,
    connect_async_client_side_server,
    connect_client_side_server,
)
from plat.css_identity import CSSAuthorityKeyPair, trust_on_first_use
from plat.authority_server import create_authority_server_controller, AuthorityServerOptions


SPEC = {
    "openapi": "3.1.0",
    "info": {"title": "Sample API", "version": "1.0.0"},
    "servers": [{"url": "http://localhost:3000"}],
    "components": {
        "schemas": {
            "Product": {
                "type": "object",
                "required": ["id", "name", "price"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "price": {"type": "number"},
                },
            }
        }
    },
    "paths": {
        "/products/{id}": {
            "get": {
                "operationId": "getProduct",
                "parameters": [
                    {"name": "id", "in": "path", "required": True, "schema": {"type": "string"}},
                    {"name": "includeMeta", "in": "query", "required": False, "schema": {"type": "boolean"}},
                ],
                "responses": {
                    "200": {
                        "description": "ok",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Product"}}},
                    }
                },
            }
        },
        "/products": {
            "post": {
                "operationId": "createProduct",
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "required": ["name", "price"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "price": {"type": "number"},
                                },
                            }
                        }
                    },
                },
                "responses": {
                    "200": {
                        "description": "ok",
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Product"}}},
                    }
                },
            }
        },
    },
}


class RecordingOpenAPIClient(OpenAPISyncClient):
    def __init__(self):
        super().__init__(SPEC)
        self.calls: list[tuple[str, str, dict | None, dict | None]] = []

    def _request(self, method: str, path: str, *, params=None, json=None):
        self.calls.append((method, path, params, json))
        return {"id": "p1", "name": "Widget", "price": 12.5}


class RecordingPromiseOpenAPIClient(OpenAPIPromiseClient):
    def __init__(self):
        super().__init__(SPEC)
        self.calls: list[tuple[str, str, dict | None, dict | None]] = []

    def _request(self, method: str, path: str, *, params=None, json=None):
        import time

        time.sleep(0.01)
        self.calls.append((method, path, params, json))
        return {"id": "p1", "name": "Widget", "price": 12.5}


class RecordingDeferredOpenAPIClient(OpenAPISyncClient):
    def __init__(self):
        super().__init__(SPEC)
        self.calls: list[tuple[str, str, dict | None, dict | None, dict | None]] = []
        self.result_polls = 0

    def _request(self, method: str, path: str, *, params=None, json=None, headers=None):
        self.calls.append((method, path, params, json, headers))
        if path == "/products":
            return {
                "id": "call-1",
                "status": "pending",
                "statusPath": "/platCallStatus?id=call-1",
                "eventsPath": "/platCallEvents?id=call-1",
                "resultPath": "/platCallResult?id=call-1",
                "cancelPath": "/platCallCancel",
            }
        if path == "/platCallStatus":
            return {
                "id": "call-1",
                "status": "running",
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-01T00:00:01Z",
                "completedAt": None,
                "statusCode": None,
                "result": None,
                "error": None,
            }
        if path == "/platCallEvents":
            return {
                "events": [
                    {"seq": 1, "at": "2026-01-01T00:00:00Z", "event": "log", "data": "Starting"},
                ]
            }
        if path == "/platCallResult":
            self.result_polls += 1
            if self.result_polls == 1:
                return {
                    "id": "call-1",
                    "status": "running",
                    "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:01Z",
                    "completedAt": None,
                    "statusCode": None,
                    "result": None,
                    "error": None,
                }
            return {
                "id": "call-1",
                "status": "completed",
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-01T00:00:02Z",
                "completedAt": "2026-01-01T00:00:02Z",
                "statusCode": 201,
                "result": {"id": "p9", "name": "Deferred Widget", "price": 99.0},
                "error": None,
            }
        if path == "/platCallCancel":
            return {"cancelled": True}
        raise AssertionError(f"Unexpected deferred request: {(method, path, params, json, headers)}")


class OpenAPIClientTests(unittest.TestCase):
    def test_python_authority_controller_uses_standard_methods(self) -> None:
        key_pair = CSSAuthorityKeyPair(
            public_key_jwk={
                "kty": "EC",
            },
            private_key_jwk={
                "kty": "EC",
            },
        )
        known_host = trust_on_first_use(
            "browser-math",
            {
                "kty": "EC",
                "crv": "P-256",
                "x": "demo-x",
                "y": "demo-y",
            },
        )
        with patch("plat.authority_server.create_signed_authority_record") as create_record:
            create_record.side_effect = lambda *_args, **kwargs: type(
                "SignedRecord",
                (),
                {
                    "protocol": "plat-css-authority-v1",
                    "server_name": kwargs["server_name"],
                    "public_key_jwk": kwargs["public_key_jwk"],
                    "key_id": kwargs.get("key_id"),
                    "authority_name": kwargs.get("authority_name"),
                    "issued_at": 123,
                    "signature": "sig",
                },
            )()

            Controller = create_authority_server_controller(
                AuthorityServerOptions(
                    authority_key_pair=key_pair,
                    known_hosts={"browser-math": known_host},
                    authority_name="demo-authority",
                )
            )
            api = Controller()
            resolved = api.resolveAuthorityHost("browser-math")
            listed = api.listAuthorityHosts()
            exported = api.exportAuthorityHosts()

            self.assertEqual(sorted([name for name in dir(api) if name in {"resolveAuthorityHost", "listAuthorityHosts", "exportAuthorityHosts"}]), [
                "exportAuthorityHosts",
                "listAuthorityHosts",
                "resolveAuthorityHost",
            ])
            self.assertEqual(resolved["serverName"], "browser-math")
            self.assertEqual(listed["hosts"][0]["serverName"], "browser-math")
            self.assertEqual(exported["records"][0]["serverName"], "browser-math")
    def test_rpc_url_defaults_to_rpc_path_for_websocket_base_urls(self) -> None:
        client = RecordingOpenAPIClient()
        client._default_base_url = "ws://localhost:3000"

        self.assertEqual(client.resolve_rpc_url(), "ws://localhost:3000/rpc")

    def test_dynamic_operation_proxy_by_operation_id_and_snake_case(self) -> None:
        client = RecordingOpenAPIClient()

        by_camel = client.getProduct({"id": "p1", "includeMeta": True})
        by_snake = client.get_product(id="p2", include_meta=True)

        self.assertEqual(by_camel["id"], "p1")
        self.assertEqual(by_snake["id"], "p1")
        self.assertEqual(
            client.calls,
            [
                ("GET", "/products/p1", {"includeMeta": True}, None),
                ("GET", "/products/p2", {"includeMeta": True}, None),
            ],
        )

    def test_dynamic_operation_proxy_splits_body_and_query(self) -> None:
        client = RecordingOpenAPIClient()

        client.create_product(name="Banana", price=2.25)

        self.assertEqual(
            client.calls[-1],
            ("POST", "/products", None, {"name": "Banana", "price": 2.25}),
        )

    def test_css_transport_mode_is_detected_from_base_url(self) -> None:
        client = RecordingOpenAPIClient()
        client._default_base_url = "css://browser-math"

        self.assertEqual(client._transport_mode(), "css")

    def test_connect_client_side_server_fetches_spec_and_builds_client(self) -> None:
        original_fetch = openapi_client_module.fetch_client_side_server_openapi
        try:
            async def fake_fetch(base_url: str, *, css_options=None):
                self.assertEqual(base_url, "css://browser-math")
                self.assertEqual(css_options, {"mqtt_topic": "demo/topic"})
                return SPEC

            openapi_client_module.fetch_client_side_server_openapi = fake_fetch
            client = connect_client_side_server(
                "css://browser-math",
                css_options={"mqtt_topic": "demo/topic"},
            )
            self.assertIsInstance(client, OpenAPISyncClient)
            self.assertEqual(client._default_base_url, "css://browser-math")
            self.assertEqual(client._css_options, {"mqtt_topic": "demo/topic"})
        finally:
            openapi_client_module.fetch_client_side_server_openapi = original_fetch

    def test_connect_async_client_side_server_fetches_spec_and_builds_client(self) -> None:
        original_fetch = openapi_client_module.fetch_client_side_server_openapi
        try:
            async def fake_fetch(base_url: str, *, css_options=None):
                self.assertEqual(base_url, "css://browser-math")
                self.assertEqual(css_options, {"mqtt_topic": "demo/topic"})
                return SPEC

            openapi_client_module.fetch_client_side_server_openapi = fake_fetch
            client = asyncio.run(
                connect_async_client_side_server(
                    "css://browser-math",
                    css_options={"mqtt_topic": "demo/topic"},
                )
            )
            self.assertEqual(client._default_base_url, "css://browser-math")
            self.assertEqual(client._css_options, {"mqtt_topic": "demo/topic"})
        finally:
            openapi_client_module.fetch_client_side_server_openapi = original_fetch

    def test_extracts_tool_metadata_from_openapi(self) -> None:
        client = RecordingOpenAPIClient()

        tools = client.tools

        self.assertEqual([tool["name"] for tool in tools], ["getProduct", "createProduct"])
        self.assertEqual(tools[0]["controller"], None)
        self.assertEqual(tools[0]["input_schema"]["required"], ["id"])
        self.assertEqual(tools[1]["input_schema"]["required"], ["name", "price"])
        self.assertEqual(tools[1]["response_schema"], {"$ref": "#/components/schemas/Product"})

    def test_generated_python_client_contains_models_and_typed_wrappers(self) -> None:
        generated = generate_python_client(SPEC, "sample/openapi.json", "http://localhost:3000")

        self.assertIn("class Product(BaseModel):", generated)
        self.assertIn("class GetProductInput(BaseModel):", generated)
        self.assertIn("class GetProductOutput(RootModel[Product]):", generated)
        self.assertIn("class CreateProductInput(BaseModel):", generated)
        self.assertIn("class ApiClient(OpenAPISyncClient):", generated)
        self.assertIn("class PromiseApiClient(OpenAPIPromiseClient):", generated)
        self.assertIn("payload = input if input is not None else (GetProductInput(**kwargs) if kwargs else None)", generated)
        self.assertIn('return self.call_typed_route("GET", "/products/{id}", payload, GetProductOutput)', generated)
        self.assertIn("-> PLATPromise[GetProductOutput]:", generated)
        self.assertIn("async def get_product", generated)

    def test_promise_client_returns_waitable_queue_backed_promise(self) -> None:
        client = RecordingPromiseOpenAPIClient()

        promise = client.get_product(id="p2", include_meta=True)

        self.assertIsInstance(promise, PLATPromise)
        self.assertFalse(promise.ready())
        result = promise.wait(timeout=1.0)

        self.assertEqual(result["id"], "p1")
        self.assertTrue(promise.ready())
        self.assertEqual(
            client.calls,
            [("GET", "/products/p2", {"includeMeta": True}, None)],
        )

    def test_deferred_execution_returns_handle(self) -> None:
        client = RecordingDeferredOpenAPIClient()

        handle = client.create_product(name="Queue Me", price=4.5, _execution="deferred", _poll_interval=0.0)

        self.assertIsInstance(handle, DeferredCallHandle)
        self.assertEqual(handle.id, "call-1")
        self.assertEqual(handle.status().status, "running")
        self.assertEqual(handle.logs()[0]["data"], "Starting")
        self.assertEqual(handle.wait(timeout=1.0), {"id": "p9", "name": "Deferred Widget", "price": 99.0})
        self.assertTrue(handle.cancel())
        self.assertEqual(
            client.calls[0],
            ("POST", "/products", None, {"name": "Queue Me", "price": 4.5}, {"X-PLAT-Execution": "deferred"}),
        )

    def test_file_transport_uses_queue_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            inbox = root / "inbox"
            outbox = root / "outbox"
            inbox.mkdir()
            outbox.mkdir()

            client = RecordingOpenAPIClient()
            client._default_base_url = root.as_uri()

            captured_events: list[dict[str, object]] = []

            def responder() -> None:
                request_paths: list[Path] = []
                while not request_paths:
                    request_paths = list(inbox.glob("*.json"))
                    time.sleep(0.01)
                request_path = request_paths[0]
                request = json.loads(request_path.read_text(encoding="utf-8"))
                self.assertEqual(request["operationId"], "getProduct")
                self.assertEqual(request["input"]["id"], "p7")
                request_id = request["id"]
                (outbox / f"{request_id}.events.jsonl").write_text(
                    json.dumps({"id": request_id, "event": "log", "data": {"stage": "queued"}}) + "\n",
                    encoding="utf-8",
                )
                (outbox / f"{request_id}.response.json").write_text(
                    json.dumps({"id": request_id, "ok": True, "result": {"id": "p7", "name": "Queued", "price": 7.0}}),
                    encoding="utf-8",
                )

            thread = threading.Thread(target=responder, daemon=True)
            thread.start()
            result = client.call_operation("getProduct", {"id": "p7"}, rpc_events=captured_events.append)
            thread.join(timeout=1.0)

            self.assertEqual(result["id"], "p7")
            self.assertEqual(captured_events[0]["event"], "log")
