"""Shared MQTT / aiortc / signaling helpers for the css:// client and server.

The client-side server transport plugin (``css_transport_plugin``) and the
server-side WebRTC transport (``css_server_transport_plugin``) both need the
same low-level glue: MQTT broker URL parsing, async paho wrapper, aiortc /
paho import guards, ICE candidate serialization, and shared constants.
Lifting the helpers here lets both callers stay focused on their own
request/response flow.
"""
from __future__ import annotations

import asyncio
import json
import ssl
import uuid
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlparse


DEFAULT_CLIENT_SIDE_SERVER_MQTT_BROKER = "wss://broker.emqx.io:8084/mqtt"
DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC = "mrtchat/plat-css"
DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS = [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
    "stun:stun2.l.google.com:19302",
    "stun:stun3.l.google.com:19302",
    "stun:stun4.l.google.com:19302",
]


def load_aiortc() -> SimpleNamespace:
    try:
        import aiortc
        import aiortc.sdp
    except ImportError as exc:
        raise ImportError(
            "css:// transport requires optional dependencies aiortc and paho-mqtt. "
            'Install them with pip install "modularizer-plat[css]".'
        ) from exc
    return SimpleNamespace(
        RTCPeerConnection=aiortc.RTCPeerConnection,
        RTCSessionDescription=aiortc.RTCSessionDescription,
        RTCConfiguration=aiortc.RTCConfiguration,
        RTCIceServer=aiortc.RTCIceServer,
        sdp=aiortc.sdp,
    )


def load_paho() -> Any:
    try:
        import paho.mqtt.client as mqtt
    except ImportError as exc:
        raise ImportError(
            "css:// transport requires optional dependencies aiortc and paho-mqtt. "
            'Install them with pip install "modularizer-plat[css]".'
        ) from exc
    return mqtt


def parse_client_side_server_address(value: str) -> SimpleNamespace:
    parsed = urlparse(value)
    if parsed.scheme != "css":
        raise ValueError(f"Client-side server URLs must use css://, got {value}")
    server_name = parsed.netloc or parsed.path.lstrip("/")
    return SimpleNamespace(href=value, server_name=server_name)


def parse_mqtt_broker_url(value: str) -> SimpleNamespace:
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.hostname:
        raise ValueError(f"Invalid MQTT broker URL: {value}")
    if parsed.scheme in {"wss", "ws"}:
        transport = "websockets"
        secure = parsed.scheme == "wss"
        port = parsed.port or (8084 if secure else 8083)
    else:
        transport = "tcp"
        secure = parsed.scheme in {"mqtts", "ssl", "tls"}
        port = parsed.port or (8883 if secure else 1883)
    return SimpleNamespace(
        host=parsed.hostname,
        port=port,
        transport=transport,
        secure=secure,
        websocket_path=parsed.path or "/mqtt",
    )


def parse_signaling_payload(value: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(value)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def serialize_aiortc_candidate(candidate: Any, aiortc: Any) -> dict[str, Any]:
    candidate_to_sdp = aiortc.sdp.candidate_to_sdp
    return {
        "candidate": f"candidate:{candidate_to_sdp(candidate)}",
        "sdpMid": getattr(candidate, "sdpMid", "0"),
        "sdpMLineIndex": getattr(candidate, "sdpMLineIndex", 0),
    }


def deserialize_aiortc_candidate(payload: dict[str, Any], aiortc: Any) -> Any:
    candidate_from_sdp = aiortc.sdp.candidate_from_sdp
    candidate_line = str(payload.get("candidate") or "")
    if candidate_line.startswith("candidate:"):
        candidate_line = candidate_line[len("candidate:") :]
    candidate = candidate_from_sdp(candidate_line)
    candidate.sdpMid = payload.get("sdpMid")
    candidate.sdpMLineIndex = payload.get("sdpMLineIndex")
    return candidate


def random_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4()}"


def current_millis() -> int:
    import time

    return int(time.time() * 1000)


class AsyncMQTTClient:
    """Minimal asyncio wrapper around a paho mqtt client.

    Shared by both the css:// client transport and the css:// server transport.
    The API is intentionally narrow: ``connect``, ``subscribe``, ``publish``,
    ``messages`` (async iterator), ``close``.
    """

    def __init__(self, paho: Any, broker: SimpleNamespace, *, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
        self._connected = loop.create_future()
        self._subscribed = loop.create_future()
        self._paho = paho
        self._broker = broker
        transport = "websockets" if broker.transport == "websockets" else "tcp"
        self._client = paho.Client(transport=transport)
        if broker.websocket_path:
            self._client.ws_set_options(path=broker.websocket_path)
        if broker.secure:
            self._client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message
        self._client.on_subscribe = self._on_subscribe

    async def connect(self) -> None:
        await asyncio.to_thread(
            self._client.connect,
            self._broker.host,
            self._broker.port,
            60,
        )
        self._client.loop_start()
        await self._connected

    async def subscribe(self, topic: str) -> None:
        self._subscribed = self._loop.create_future()
        self._client.subscribe(topic)
        await self._subscribed

    async def publish(self, topic: str, payload: dict[str, Any]) -> None:
        info = self._client.publish(topic, json.dumps(payload))
        await asyncio.to_thread(info.wait_for_publish)

    async def messages(self):
        while True:
            yield await self._queue.get()

    async def close(self) -> None:
        await asyncio.to_thread(self._client.disconnect)
        self._client.loop_stop()

    def _on_connect(self, client: Any, userdata: Any, flags: Any, reason_code: Any, properties: Any = None) -> None:
        if not self._connected.done():
            self._loop.call_soon_threadsafe(self._connected.set_result, None)

    def _on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        text = msg.payload.decode("utf-8") if isinstance(msg.payload, bytes) else str(msg.payload)
        topic = getattr(msg, "topic", "")
        self._loop.call_soon_threadsafe(self._queue.put_nowait, (topic, text))

    def _on_subscribe(self, client: Any, userdata: Any, mid: Any, granted_qos: Any, properties: Any = None) -> None:
        if not self._subscribed.done():
            self._loop.call_soon_threadsafe(self._subscribed.set_result, None)
