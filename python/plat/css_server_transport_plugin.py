"""Server-side WebRTC transport for PLATServer.

Mirrors the browser-side ``PLATClientSideServer`` and the Node-side
``createWebRTCProtocolPlugin``: subscribes to an MQTT signaling topic,
answers offers targeted at this server's css:// name, signs identity
challenges, and dispatches JSON-RPC requests over the resulting
WebRTC data channel through the server's transport runtime.

This uses the same plain-JSON signaling envelope as
``css_transport_plugin.py`` (not the sealed / encrypted variant
implemented in TypeScript). That keeps the Python client and Python
server trivially interoperable.
"""
from __future__ import annotations

import asyncio
import json
import threading
from dataclasses import dataclass
from typing import Any

from .css_identity import (
    CSSAuthorityKeyPair,
    CSSAuthorityRecord,
    build_css_identity_challenge,
    sign_message,
)
from .css_shared import (
    AsyncMQTTClient,
    DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
    DEFAULT_CLIENT_SIDE_SERVER_MQTT_BROKER,
    DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC,
    current_millis,
    deserialize_aiortc_candidate,
    load_aiortc,
    load_paho,
    parse_mqtt_broker_url,
    parse_signaling_payload,
    random_id,
    serialize_aiortc_candidate,
)
from .errors import HttpError
from .protocol_plugin import ServerTransportRuntime
from .server_types import RouteContext


@dataclass
class CSSServerTransportConfig:
    server_name: str
    identity_key_pair: CSSAuthorityKeyPair
    authority_record: CSSAuthorityRecord | None = None
    mqtt_broker: str = DEFAULT_CLIENT_SIDE_SERVER_MQTT_BROKER
    mqtt_topic: str = DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC
    connection_timeout: float = 15.0
    server_id_prefix: str = "pyserver"
    ice_servers: list[str] | None = None


def create_css_server_transport_plugin(
    config: CSSServerTransportConfig,
    *,
    info_provider: "ServerInfoProvider | None" = None,
) -> Any:
    resolved_ice = list(config.ice_servers or DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS)

    runtime_ref: list[ServerTransportRuntime | None] = [None]
    thread_ref: list[threading.Thread | None] = [None]
    loop_ref: list[asyncio.AbstractEventLoop | None] = [None]
    stop_event = threading.Event()
    server_instance_id = f"{config.server_id_prefix}:{random_id('server')}"

    async def _run() -> None:
        aiortc = load_aiortc()
        paho = load_paho()
        broker = parse_mqtt_broker_url(config.mqtt_broker)
        loop = asyncio.get_running_loop()
        loop_ref[0] = loop
        mqtt = AsyncMQTTClient(paho, broker, loop=loop)
        await mqtt.connect()
        await mqtt.subscribe(config.mqtt_topic)

        connections: dict[str, "_ServerConnection"] = {}

        try:
            async for _topic, text in mqtt.messages():
                if stop_event.is_set():
                    break
                payload = parse_signaling_payload(text)
                if payload is None:
                    continue
                if payload.get("protocol") != "plat-css-v1":
                    continue
                if payload.get("senderId") == server_instance_id:
                    continue
                if payload.get("targetId") not in (config.server_name, server_instance_id):
                    continue

                connection_id = payload.get("connectionId")
                if not isinstance(connection_id, str):
                    continue

                kind = payload.get("kind")
                if kind == "offer" and payload.get("description"):
                    conn = _ServerConnection(
                        aiortc=aiortc,
                        mqtt=mqtt,
                        config=config,
                        resolved_ice=resolved_ice,
                        server_instance_id=server_instance_id,
                        connection_id=connection_id,
                        client_target_id=payload.get("senderId") or "",
                        runtime=runtime_ref[0],
                        info_provider=info_provider,
                    )
                    connections[connection_id] = conn
                    asyncio.create_task(conn.handle_offer(payload))
                elif kind == "ice" and payload.get("candidate"):
                    conn = connections.get(connection_id)
                    if conn is not None:
                        asyncio.create_task(conn.add_remote_candidate(payload["candidate"]))
        finally:
            for conn in list(connections.values()):
                await conn.close()
            await mqtt.close()

    def _worker() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_run())
        except Exception:
            pass
        finally:
            loop.close()

    class CSSServerTransportPlugin:
        name = "webrtc"

        def setup(self, runtime: ServerTransportRuntime) -> None:
            runtime_ref[0] = runtime

        def start(self, runtime: ServerTransportRuntime) -> None:
            if thread_ref[0] is not None:
                return
            t = threading.Thread(target=_worker, name="plat-css-server", daemon=True)
            thread_ref[0] = t
            t.start()

        def teardown(self, runtime: ServerTransportRuntime) -> None:
            stop_event.set()
            loop = loop_ref[0]
            if loop is not None:
                try:
                    loop.call_soon_threadsafe(lambda: None)
                except RuntimeError:
                    pass
            t = thread_ref[0]
            if t is not None:
                t.join(timeout=5)
                thread_ref[0] = None
            runtime_ref[0] = None

    return CSSServerTransportPlugin()


class ServerInfoProvider:
    """Duck-typed info provider. Any object with these methods works."""

    def get_openapi_spec(self) -> dict[str, Any] | None: ...
    def get_tools_list(self) -> list[Any]: ...
    def get_server_started_at(self) -> int: ...


class _ServerConnection:
    def __init__(
        self,
        *,
        aiortc: Any,
        mqtt: AsyncMQTTClient,
        config: CSSServerTransportConfig,
        resolved_ice: list[str],
        server_instance_id: str,
        connection_id: str,
        client_target_id: str,
        runtime: ServerTransportRuntime | None,
        info_provider: Any,
    ) -> None:
        self._aiortc = aiortc
        self._mqtt = mqtt
        self._config = config
        self._server_instance_id = server_instance_id
        self._connection_id = connection_id
        self._client_target_id = client_target_id
        self._runtime = runtime
        self._info_provider = info_provider
        self._peer = aiortc.RTCPeerConnection(
            configuration=aiortc.RTCConfiguration(
                iceServers=[aiortc.RTCIceServer(urls=urls) for urls in resolved_ice]
            )
        )
        self._channel: Any = None
        self._pending_remote_candidates: list[Any] = []

        @self._peer.on("icecandidate")
        async def _on_icecandidate(candidate: Any) -> None:
            if candidate is None:
                return
            await self._publish(
                "ice",
                {"candidate": serialize_aiortc_candidate(candidate, aiortc)},
            )

        @self._peer.on("datachannel")
        def _on_datachannel(channel: Any) -> None:
            self._channel = channel

            @channel.on("message")
            def _on_message(message: Any) -> None:
                text = message.decode("utf-8") if isinstance(message, bytes) else str(message)
                asyncio.create_task(self._handle_request(text))

    async def handle_offer(self, payload: dict[str, Any]) -> None:
        description = payload["description"]
        challenge_nonce = payload.get("challengeNonce")
        await self._peer.setRemoteDescription(
            self._aiortc.RTCSessionDescription(sdp=description["sdp"], type=description["type"])
        )
        answer = await self._peer.createAnswer()
        await self._peer.setLocalDescription(answer)

        identity = {
            "publicKeyJwk": self._config.identity_key_pair.public_key_jwk,
        }
        if self._config.identity_key_pair.key_id:
            identity["keyId"] = self._config.identity_key_pair.key_id

        challenge_signature = None
        if isinstance(challenge_nonce, str):
            challenge = build_css_identity_challenge(
                self._config.server_name,
                self._connection_id,
                challenge_nonce,
            )
            challenge_signature = sign_message(
                self._config.identity_key_pair.private_key_jwk, challenge
            )

        authority_payload = None
        if self._config.authority_record is not None:
            rec = self._config.authority_record
            authority_payload = {
                "protocol": rec.protocol,
                "serverName": rec.server_name,
                "publicKeyJwk": rec.public_key_jwk,
                "keyId": rec.key_id,
                "authorityName": rec.authority_name,
                "issuedAt": rec.issued_at,
                "signature": rec.signature,
            }

        answer_body: dict[str, Any] = {
            "description": {
                "type": self._peer.localDescription.type,
                "sdp": self._peer.localDescription.sdp,
            },
            "identity": identity,
        }
        if challenge_signature is not None:
            answer_body["challengeSignature"] = challenge_signature
        if authority_payload is not None:
            answer_body["authorityRecord"] = authority_payload

        await self._publish("answer", answer_body)

        for candidate in self._pending_remote_candidates:
            await self._peer.addIceCandidate(candidate)
        self._pending_remote_candidates.clear()

    async def add_remote_candidate(self, candidate_payload: dict[str, Any]) -> None:
        candidate = deserialize_aiortc_candidate(candidate_payload, self._aiortc)
        if getattr(self._peer, "remoteDescription", None):
            await self._peer.addIceCandidate(candidate)
        else:
            self._pending_remote_candidates.append(candidate)

    async def _publish(self, kind: str, body: dict[str, Any]) -> None:
        message = {
            "protocol": "plat-css-v1",
            "kind": kind,
            "senderId": self._server_instance_id,
            "targetId": self._client_target_id,
            "connectionId": self._connection_id,
            "at": current_millis(),
            **body,
        }
        await self._mqtt.publish(self._config.mqtt_topic, message)

    async def _handle_request(self, text: str) -> None:
        try:
            request = json.loads(text)
        except Exception:
            return
        if not isinstance(request, dict):
            return
        request_id = request.get("id")
        method = str(request.get("method") or "GET").upper()
        path = request.get("path") or "/"
        operation_id = request.get("operationId")
        input_data = request.get("input")
        headers = request.get("headers") or {}

        info = self._info_provider
        if method == "GET" and path == "/openapi.json" and info is not None:
            spec = info.get_openapi_spec() if hasattr(info, "get_openapi_spec") else None
            await self._send_response({"id": request_id, "ok": True, "result": spec or {}})
            return
        if method == "GET" and path == "/tools" and info is not None:
            tools = info.get_tools_list() if hasattr(info, "get_tools_list") else []
            await self._send_response({"id": request_id, "ok": True, "result": tools})
            return
        if method == "GET" and path == "/server-info" and info is not None:
            started = info.get_server_started_at() if hasattr(info, "get_server_started_at") else current_millis()
            await self._send_response({
                "id": request_id,
                "ok": True,
                "result": {"serverStartedAt": started},
            })
            return

        runtime = self._runtime
        if runtime is None:
            await self._send_response({
                "id": request_id,
                "ok": False,
                "error": {"status": 503, "message": "Server transport runtime not initialized"},
            })
            return

        operation = runtime.resolve_operation(
            operation_id=operation_id,
            method=method,
            path=path,
        )
        if operation is None:
            await self._send_response({
                "id": request_id,
                "ok": False,
                "error": {"status": 404, "message": f"WebRTC operation not found for {method} {path}"},
            })
            return

        ctx = RouteContext(
            method=method,
            url=path,
            headers=dict(headers),
            opts=operation.route_meta.opts if operation.route_meta else None,
        )
        input_dict = input_data if isinstance(input_data, dict) else {}
        normalized = runtime.normalize_input(dict(input_dict))

        async def emit_fn(event: str, data: Any = None) -> None:
            await self._send_response({
                "id": request_id,
                "ok": True,
                "event": event,
                "data": runtime.serialize_value(data),
            })

        runtime.create_call_context(
            ctx=ctx,
            session_id=request_id or random_id("session"),
            mode="rpc",
            emit=emit_fn,
            signal=None,
        )

        try:
            execution = await runtime.dispatch(
                operation,
                runtime.create_envelope(
                    protocol="webrtc",
                    operation=operation,
                    input=normalized,
                    ctx=ctx,
                    headers=dict(headers),
                    request_id=request_id,
                    allow_help=False,
                    help_requested=False,
                ),
            )
            await self._send_response({
                "id": request_id,
                "ok": True,
                "result": runtime.serialize_value(execution["result"]),
            })
        except Exception as exc:
            status = 500
            if isinstance(exc, HttpError):
                status = exc.status_code
            else:
                status = getattr(exc, "status_code", None) or getattr(exc, "status", None) or 500
            err: dict[str, Any] = {
                "status": status,
                "message": str(exc) or "Internal server error",
            }
            if getattr(exc, "data", None) is not None:
                err["data"] = exc.data
            await self._send_response({"id": request_id, "ok": False, "error": err})

    async def _send_response(self, response: dict[str, Any]) -> None:
        if self._channel is None:
            return
        self._channel.send(json.dumps({"jsonrpc": "2.0", **response}))

    async def close(self) -> None:
        try:
            await self._peer.close()
        except Exception:
            pass
