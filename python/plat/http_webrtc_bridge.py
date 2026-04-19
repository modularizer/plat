"""
HTTP⇄WebRTC bridge handler for PLAT Python server.

This handler allows forwarding HTTP requests received over a WebRTC data channel (css://) to an upstream HTTP server, and returning the response over the channel.

Mirrors the TypeScript createHTTPForwarder, but for Python.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Callable
from dataclasses import dataclass, field

import httpx

@dataclass
class HTTPBridgeOptions:
    upstream: str
    css_name: str
    bridge_name: str = "py-bridge"
    allow_methods: list[str] | None = None
    allow_paths: list[str] | None = None
    timeout: float = 30.0

class HTTPWebRTCBridgeHandler:
    def __init__(self, options: HTTPBridgeOptions):
        self.options = options
        self.client = httpx.AsyncClient(base_url=options.upstream, timeout=options.timeout)

    async def handle_channel(self, channel: Any):
        async for message in channel:
            try:
                req = json.loads(message)
                if req.get("type") != "PLAT_REQUEST":
                    continue
                resp = await self._handle_request(req)
                await channel.send(json.dumps(resp))
            except Exception as exc:
                await channel.send(json.dumps({
                    "type": "PLAT_RESPONSE",
                    "id": req.get("id"),
                    "status": 500,
                    "statusText": str(exc),
                    "headers": {},
                    "bodyEncoding": "none",
                    "body": "",
                    "error": str(exc),
                    "errorCode": "bridge-error",
                }))

    async def _handle_request(self, req: dict) -> dict:
        method = req.get("method", "GET").upper()
        path = req.get("path", "/")
        headers = req.get("headers", {})
        body = req.get("body")
        body_encoding = req.get("bodyEncoding", "none")
        allow_methods = self.options.allow_methods
        allow_paths = self.options.allow_paths
        if allow_methods and method not in allow_methods:
            return self._error_response(req, 405, "Method Not Allowed", "method-not-allowed")
        if allow_paths and not any(path.startswith(p) for p in allow_paths):
            return self._error_response(req, 403, "Forbidden", "path-not-allowed")
        data = None
        if body:
            if body_encoding == "base64":
                data = httpx.ByteStream(httpx._models._decode_base64(body))
            else:
                data = body
        try:
            resp = await self.client.request(method, path, headers=headers, content=data)
            resp_body = await resp.aread()
            content_type = resp.headers.get("content-type", "")
            if content_type.startswith("text/") or content_type.startswith("application/json"):
                encoding = "none"
                body_out = resp_body.decode("utf-8", errors="replace")
            else:
                encoding = "base64"
                import base64
                body_out = base64.b64encode(resp_body).decode("ascii")
            return {
                "type": "PLAT_RESPONSE",
                "id": req.get("id"),
                "status": resp.status_code,
                "statusText": resp.reason_phrase,
                "headers": dict(resp.headers),
                "bodyEncoding": encoding,
                "body": body_out,
            }
        except Exception as exc:
            return self._error_response(req, 502, str(exc), "upstream-failed")

    def _error_response(self, req: dict, status: int, message: str, code: str) -> dict:
        return {
            "type": "PLAT_RESPONSE",
            "id": req.get("id"),
            "status": status,
            "statusText": message,
            "headers": {},
            "bodyEncoding": "none",
            "body": "",
            "error": message,
            "errorCode": code,
        }

