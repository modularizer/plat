from __future__ import annotations

import asyncio
import importlib.util
import json
import unittest
from typing import Any
from unittest import mock

from plat import Controller, GET, RouteContext, create_server
from plat.css_server_transport_plugin import _ServerConnection, CSSServerTransportConfig
from plat.css_identity import CSSAuthorityKeyPair


def ensure_server_runtime() -> None:
    required = ("fastapi", "starlette", "pydantic")
    missing = [name for name in required if importlib.util.find_spec(name) is None]
    if missing:
        raise unittest.SkipTest(
            f"Server tests require optional deps: {', '.join(missing)}"
        )


class _CapturingChannel:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def send(self, text: str) -> None:
        self.sent.append(json.loads(text))


def _build_connection(runtime: Any, info_provider: Any = None) -> tuple[_ServerConnection, _CapturingChannel]:
    key_pair = CSSAuthorityKeyPair(
        public_key_jwk={"kty": "EC", "crv": "P-256", "x": "x", "y": "y"},
        private_key_jwk={"kty": "EC", "crv": "P-256", "x": "x", "y": "y", "d": "d"},
    )
    config = CSSServerTransportConfig(
        server_name="test-server",
        identity_key_pair=key_pair,
    )
    fake_aiortc = mock.MagicMock()
    fake_aiortc.RTCPeerConnection.return_value = mock.MagicMock(on=lambda *_a, **_k: (lambda f: f))
    fake_mqtt = mock.MagicMock()
    conn = _ServerConnection(
        aiortc=fake_aiortc,
        mqtt=fake_mqtt,
        config=config,
        resolved_ice=[],
        server_instance_id="pyserver:test",
        connection_id="conn-1",
        client_target_id="pyclient:test",
        runtime=runtime,
        info_provider=info_provider,
    )
    channel = _CapturingChannel()
    conn._channel = channel
    return conn, channel


class CSSServerTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        ensure_server_runtime()

    def test_dispatches_operation_through_runtime(self) -> None:
        @Controller("Greeter")
        class Greeter:
            @GET()
            def hello(self, input: dict, ctx: RouteContext):
                return {"msg": f"hi {input.get('name', 'world')}"}

        server = create_server()
        server.register(Greeter)
        runtime = server.create_transport_runtime()
        conn, channel = _build_connection(runtime)

        asyncio.run(conn._handle_request(json.dumps({
            "jsonrpc": "2.0",
            "id": "r1",
            "method": "GET",
            "path": "/hello",
            "input": {"name": "plat"},
        })))

        self.assertEqual(len(channel.sent), 1)
        response = channel.sent[0]
        self.assertEqual(response["id"], "r1")
        self.assertTrue(response["ok"])
        self.assertEqual(response["result"], {"msg": "hi plat"})

    def test_returns_404_for_unknown_operation(self) -> None:
        server = create_server()
        runtime = server.create_transport_runtime()
        conn, channel = _build_connection(runtime)

        asyncio.run(conn._handle_request(json.dumps({
            "jsonrpc": "2.0",
            "id": "x1",
            "method": "POST",
            "path": "/nope",
        })))

        self.assertEqual(len(channel.sent), 1)
        response = channel.sent[0]
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["status"], 404)

    def test_serves_openapi_and_tools_from_info_provider(self) -> None:
        spec = {"openapi": "3.1.0", "info": {"title": "x", "version": "0"}, "paths": {}}
        tools = [{"name": "hello"}]

        class Info:
            def get_openapi_spec(self) -> Any:
                return spec

            def get_tools_list(self) -> Any:
                return tools

            def get_server_started_at(self) -> int:
                return 1234

        conn, channel = _build_connection(runtime=None, info_provider=Info())

        asyncio.run(conn._handle_request(json.dumps({
            "jsonrpc": "2.0", "id": "o1", "method": "GET", "path": "/openapi.json",
        })))
        asyncio.run(conn._handle_request(json.dumps({
            "jsonrpc": "2.0", "id": "t1", "method": "GET", "path": "/tools",
        })))

        self.assertEqual(channel.sent[0], {"jsonrpc": "2.0", "id": "o1", "ok": True, "result": spec})
        self.assertEqual(channel.sent[1], {"jsonrpc": "2.0", "id": "t1", "ok": True, "result": tools})


if __name__ == "__main__":
    unittest.main()
