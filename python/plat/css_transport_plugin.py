from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from .css_identity import (
    CSSAuthorityRecord,
    CSSAuthorityServer,
    CSSKnownHostRecord,
    load_known_host,
    resolve_known_host_from_authorities,
    save_known_host,
    trust_on_first_use,
    verify_server_identity,
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
    parse_client_side_server_address,
    parse_mqtt_broker_url,
    parse_signaling_payload,
    random_id,
    serialize_aiortc_candidate,
)
from .transport_plugin import TransportRequest, TransportResult


@dataclass
class CSSTransportConfig:
    mqtt_broker: str = DEFAULT_CLIENT_SIDE_SERVER_MQTT_BROKER
    mqtt_topic: str = DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC
    connection_timeout: float = 15.0
    client_id_prefix: str = "pyclient"
    ice_servers: list[str] = field(default_factory=lambda: list(DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS))
    known_hosts: dict[str, CSSKnownHostRecord] | None = None
    authority_servers: list[CSSAuthorityServer] = field(default_factory=list)
    trust_on_first_use: bool = True

    def __post_init__(self) -> None:
        if self.known_hosts is not None:
            self.known_hosts = {
                server_name: record if isinstance(record, CSSKnownHostRecord) else CSSKnownHostRecord(**record)
                for server_name, record in self.known_hosts.items()
            }
        self.authority_servers = [
            authority if isinstance(authority, CSSAuthorityServer) else CSSAuthorityServer(**authority)
            for authority in self.authority_servers
        ]


@dataclass
class _CSSConnection:
    response: Any = None


def create_css_transport_plugin(
    config: CSSTransportConfig | None = None,
    *,
    is_async: bool = False,
) -> Any:
    resolved = config or CSSTransportConfig()

    class CSSTransportPlugin:
        name = "css"

        def can_handle(self, request: dict[str, str]) -> bool:
            base_url = request.get("base_url", "")
            return request.get("transport_mode") == "css" or base_url.startswith("css://")

        def connect(self, request: TransportRequest) -> _CSSConnection:
            return _CSSConnection()

        def send_request(self, connection: _CSSConnection, request: TransportRequest) -> None:
            connection.response = asyncio.run(_send_css_request(request, resolved, is_async=is_async))

        def get_result(self, connection: _CSSConnection, request: TransportRequest) -> Any:
            response = connection.response
            if not response.get("ok"):
                error = response.get("error") or {}
                return TransportResult(
                    id=request.id,
                    ok=False,
                    error=RuntimeError(error.get("message", "Client-side server request failed")),
                )
            return TransportResult(id=request.id, ok=True, result=response.get("result"))

        def disconnect(self, connection: _CSSConnection, request: TransportRequest) -> None:
            connection.response = None

    return CSSTransportPlugin()


async def fetch_client_side_server_openapi(
    base_url: str,
    *,
    css_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = CSSTransportConfig(**(css_options or {}))
    request = TransportRequest(
        id="css-openapi",
        base_url=base_url,
        transport_mode="css",
        method="GET",
        path="/openapi.json",
        operation_id=None,
        params={},
        headers={},
    )
    response = await _send_css_request(request, config, is_async=False)
    if not response.get("ok"):
        error = response.get("error") or {}
        raise RuntimeError(error.get("message", "Could not fetch client-side server OpenAPI"))
    result = response.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("Client-side server OpenAPI response was not an object.")
    return result


async def _send_css_request(
    request: TransportRequest,
    config: CSSTransportConfig,
    *,
    is_async: bool,
) -> dict[str, Any]:
    aiortc = load_aiortc()
    paho = load_paho()

    address = parse_client_side_server_address(request.base_url)
    broker = parse_mqtt_broker_url(config.mqtt_broker)
    loop = asyncio.get_running_loop()
    mqtt = AsyncMQTTClient(paho, broker, loop=loop)
    await mqtt.connect()
    await mqtt.subscribe(config.mqtt_topic)

    peer = aiortc.RTCPeerConnection(
        configuration=aiortc.RTCConfiguration(
            iceServers=[aiortc.RTCIceServer(urls=urls) for urls in config.ice_servers]
        )
    )
    connection_id = random_id("conn")
    client_instance_id = f"{config.client_id_prefix}:{random_id('peer')}"
    pending_candidates: list[Any] = []
    response_future: asyncio.Future[dict[str, Any]] = loop.create_future()
    channel_ready: asyncio.Future[None] = loop.create_future()
    data_channel = peer.createDataChannel(f"plat-css:{connection_id}")
    challenge_nonce = random_id("challenge")
    expected_host = load_known_host(config.known_hosts, address.server_name)
    if expected_host is None and config.authority_servers:
        expected_host = await resolve_known_host_from_authorities(address.server_name, config.authority_servers)
        if expected_host is not None and config.known_hosts is not None:
            save_known_host(config.known_hosts, expected_host)

    @data_channel.on("open")
    def _on_open() -> None:
        if not channel_ready.done():
            channel_ready.set_result(None)

    @data_channel.on("error")
    def _on_error(error: Any = None) -> None:
        if not channel_ready.done():
            channel_ready.set_exception(RuntimeError(f"Data channel to {address.server_name} failed: {error}"))

    @data_channel.on("message")
    def _on_message(message: Any) -> None:
        text = message.decode("utf-8") if isinstance(message, bytes) else str(message)
        payload = parse_signaling_payload(text)
        if payload is None:
            return
        if payload.get("id") != request.id:
            return
        if payload.get("event"):
            if request.on_event is not None:
                maybe = request.on_event(payload)
                if is_async and hasattr(maybe, "__await__"):
                    asyncio.create_task(maybe)
            return
        if not response_future.done():
            response_future.set_result(payload)

    @peer.on("icecandidate")
    async def _on_icecandidate(candidate: Any) -> None:
        if candidate is None:
            return
        await mqtt.publish(
            config.mqtt_topic,
            {
                "protocol": "plat-css-v1",
                "kind": "ice",
                "senderId": client_instance_id,
                "targetId": address.server_name,
                "connectionId": connection_id,
                "candidate": serialize_aiortc_candidate(candidate, aiortc),
                "at": current_millis(),
            },
        )

    async def _mqtt_messages() -> None:
        async for _topic, text in mqtt.messages():
            payload = parse_signaling_payload(text)
            if payload is None:
                continue
            if payload.get("protocol") != "plat-css-v1":
                continue
            if payload.get("senderId") == client_instance_id:
                continue
            if payload.get("targetId") != client_instance_id:
                continue
            if payload.get("connectionId") != connection_id:
                continue

            if payload.get("kind") == "answer" and payload.get("description"):
                identity = payload.get("identity")
                challenge_signature = payload.get("challengeSignature")
                authority_record_payload = payload.get("authorityRecord")
                authority_record = None
                authority_public_key_jwk = None
                if authority_record_payload:
                    authority_record = CSSAuthorityRecord(
                        protocol=authority_record_payload["protocol"],
                        server_name=authority_record_payload["serverName"],
                        public_key_jwk=authority_record_payload["publicKeyJwk"],
                        key_id=authority_record_payload.get("keyId"),
                        authority_name=authority_record_payload.get("authorityName"),
                        issued_at=authority_record_payload.get("issuedAt"),
                        signature=authority_record_payload.get("signature"),
                    )
                    for authority in config.authority_servers:
                        if authority.authority_name == authority_record.authority_name or authority_public_key_jwk is None:
                            authority_public_key_jwk = authority.public_key_jwk
                            if authority.authority_name == authority_record.authority_name:
                                break
                if identity and challenge_signature:
                    verify_server_identity(
                        server_name=address.server_name,
                        connection_id=connection_id,
                        challenge_nonce=challenge_nonce,
                        identity=identity,
                        challenge_signature=challenge_signature,
                        expected=expected_host,
                        authority_record=authority_record,
                        authority_public_key_jwk=authority_public_key_jwk,
                    )
                    if expected_host is None and config.trust_on_first_use and config.known_hosts is not None:
                        save_known_host(
                            config.known_hosts,
                            trust_on_first_use(
                                address.server_name,
                                identity["publicKeyJwk"],
                                key_id=identity.get("keyId"),
                            ),
                        )
                elif expected_host is not None:
                    raise RuntimeError(f"Server {address.server_name} did not provide identity proof")
                description = payload["description"]
                await peer.setRemoteDescription(
                    aiortc.RTCSessionDescription(sdp=description["sdp"], type=description["type"])
                )
                for candidate in pending_candidates:
                    await peer.addIceCandidate(candidate)
                pending_candidates.clear()
                continue

            if payload.get("kind") == "ice" and payload.get("candidate"):
                candidate = deserialize_aiortc_candidate(payload["candidate"], aiortc)
                if getattr(peer, "remoteDescription", None):
                    await peer.addIceCandidate(candidate)
                else:
                    pending_candidates.append(candidate)

    mqtt_task = asyncio.create_task(_mqtt_messages())
    try:
        offer = await peer.createOffer()
        await peer.setLocalDescription(offer)
        await mqtt.publish(
            config.mqtt_topic,
            {
                "protocol": "plat-css-v1",
                "kind": "offer",
                "senderId": client_instance_id,
                "targetId": address.server_name,
                "serverName": address.server_name,
                "connectionId": connection_id,
                "description": {
                    "type": offer.type,
                    "sdp": offer.sdp,
                },
                "challengeNonce": challenge_nonce,
                "at": current_millis(),
            },
        )

        await asyncio.wait_for(channel_ready, timeout=config.connection_timeout)
        data_channel.send(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": request.id,
                    "operationId": request.operation_id,
                    "method": request.method,
                    "path": request.path,
                    "headers": dict(request.headers),
                    "input": request.params,
                }
            )
        )
        return await asyncio.wait_for(response_future, timeout=config.connection_timeout)
    finally:
        mqtt_task.cancel()
        try:
            await mqtt_task
        except BaseException:
            pass
        await mqtt.close()
        await peer.close()


