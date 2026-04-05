from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class CSSKnownHostRecord:
    server_name: str
    public_key_jwk: dict[str, Any]
    key_id: str | None = None
    fingerprint: str | None = None
    trusted_at: int | None = None
    source: str = "first-use"


@dataclass
class CSSAuthorityRecord:
    protocol: str
    server_name: str
    public_key_jwk: dict[str, Any]
    key_id: str | None = None
    authority_name: str | None = None
    issued_at: int | None = None
    signature: str | None = None


@dataclass
class CSSAuthorityServer:
    base_url: str
    public_key_jwk: dict[str, Any]
    authority_name: str | None = None
    resolve_path: str = "/resolveAuthorityHost"


@dataclass
class CSSAuthorityKeyPair:
    public_key_jwk: dict[str, Any]
    private_key_jwk: dict[str, Any]
    key_id: str | None = None


def load_known_host(known_hosts: dict[str, CSSKnownHostRecord] | None, server_name: str) -> CSSKnownHostRecord | None:
    if known_hosts is None:
        return None
    return known_hosts.get(server_name)


def save_known_host(known_hosts: dict[str, CSSKnownHostRecord], record: CSSKnownHostRecord) -> None:
    known_hosts[record.server_name] = record


def load_known_hosts_json(path: str | Path) -> dict[str, CSSKnownHostRecord]:
    file_path = Path(path)
    if not file_path.exists():
        return {}
    raw = json.loads(file_path.read_text(encoding="utf-8"))
    return {
        server_name: CSSKnownHostRecord(**payload)
        for server_name, payload in raw.items()
    }


def save_known_hosts_json(path: str | Path, known_hosts: dict[str, CSSKnownHostRecord]) -> None:
    payload = {
        server_name: record.__dict__
        for server_name, record in known_hosts.items()
    }
    Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def load_known_host_from_dict(known_hosts: dict[str, CSSKnownHostRecord] | None, server_name: str) -> CSSKnownHostRecord | None:
    return load_known_host(known_hosts, server_name)


def save_known_host_to_dict(known_hosts: dict[str, CSSKnownHostRecord], record: CSSKnownHostRecord) -> None:
    save_known_host(known_hosts, record)


def build_css_identity_challenge(server_name: str, connection_id: str, challenge_nonce: str) -> str:
    return f"plat-css-identity-v1:{server_name}:{connection_id}:{challenge_nonce}"


def public_keys_equal(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return _stable_json(a) == _stable_json(b)


def trust_on_first_use(server_name: str, public_key_jwk: dict[str, Any], *, key_id: str | None = None) -> CSSKnownHostRecord:
    return CSSKnownHostRecord(
        server_name=server_name,
        public_key_jwk=public_key_jwk,
        key_id=key_id,
        fingerprint=create_public_key_fingerprint(public_key_jwk),
        source="first-use",
    )


def create_signed_authority_record(
    authority_key_pair: CSSAuthorityKeyPair,
    *,
    server_name: str,
    public_key_jwk: dict[str, Any],
    key_id: str | None = None,
    authority_name: str | None = None,
    issued_at: int | None = None,
) -> CSSAuthorityRecord:
    payload = {
        "protocol": "plat-css-authority-v1",
        "serverName": server_name,
        "publicKeyJwk": public_key_jwk,
        "keyId": key_id,
        "authorityName": authority_name,
        "issuedAt": issued_at,
    }
    signature = sign_message(authority_key_pair.private_key_jwk, _stable_json(payload))
    return CSSAuthorityRecord(
        protocol="plat-css-authority-v1",
        server_name=server_name,
        public_key_jwk=public_key_jwk,
        key_id=key_id,
        authority_name=authority_name,
        issued_at=issued_at,
        signature=signature,
    )


async def resolve_known_host_from_authorities(
    server_name: str,
    authority_servers: list[CSSAuthorityServer],
) -> CSSKnownHostRecord | None:
    for authority in authority_servers:
        try:
            record = await fetch_authority_record(authority, server_name)
            if record is None:
                continue
            if verify_authority_record(record, authority.public_key_jwk):
                return CSSKnownHostRecord(
                    server_name=record.server_name,
                    public_key_jwk=record.public_key_jwk,
                    key_id=record.key_id,
                    fingerprint=create_public_key_fingerprint(record.public_key_jwk),
                    source="authority",
                )
        except Exception:
            continue
    return None


async def fetch_authority_record(authority: CSSAuthorityServer, server_name: str) -> CSSAuthorityRecord | None:
    import httpx

    base_url = authority.base_url.rstrip("/")
    resolve_path = authority.resolve_path if authority.resolve_path.startswith("/") else f"/{authority.resolve_path}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{base_url}{resolve_path}",
            params={"serverName": server_name},
            headers={"accept": "application/json"},
        )
        response.raise_for_status()
        payload = response.json()
    if payload is None:
        return None
    return CSSAuthorityRecord(
        protocol=payload["protocol"],
        server_name=payload["serverName"],
        public_key_jwk=payload["publicKeyJwk"],
        key_id=payload.get("keyId"),
        authority_name=payload.get("authorityName"),
        issued_at=payload.get("issuedAt"),
        signature=payload.get("signature"),
    )


def verify_server_identity(
    *,
    server_name: str,
    connection_id: str,
    challenge_nonce: str,
    identity: dict[str, Any],
    challenge_signature: str,
    expected: CSSKnownHostRecord | None,
    authority_record: CSSAuthorityRecord | None = None,
    authority_public_key_jwk: dict[str, Any] | None = None,
) -> None:
    public_key_jwk = identity["publicKeyJwk"]
    challenge = build_css_identity_challenge(server_name, connection_id, challenge_nonce)
    if not verify_signature(public_key_jwk, challenge, challenge_signature):
        raise RuntimeError(f"Server {server_name} failed identity challenge verification")
    if expected is not None and not public_keys_equal(expected.public_key_jwk, public_key_jwk):
        raise RuntimeError(f"Server {server_name} presented an unexpected public key")
    if authority_record is not None and authority_public_key_jwk is not None:
        if not verify_authority_record(authority_record, authority_public_key_jwk):
            raise RuntimeError(f"Server {server_name} provided an invalid authority record")
        if not public_keys_equal(authority_record.public_key_jwk, public_key_jwk):
            raise RuntimeError(f"Server {server_name} authority record does not match presented identity")


def verify_authority_record(record: CSSAuthorityRecord, authority_public_key_jwk: dict[str, Any]) -> bool:
    if record.protocol != "plat-css-authority-v1" or record.signature is None:
        return False
    payload = {
        "protocol": record.protocol,
        "serverName": record.server_name,
        "publicKeyJwk": record.public_key_jwk,
        "keyId": record.key_id,
        "authorityName": record.authority_name,
        "issuedAt": record.issued_at,
    }
    return verify_signature(authority_public_key_jwk, _stable_json(payload), record.signature)


def verify_signature(public_key_jwk: dict[str, Any], message: str, signature: str) -> bool:
    public_key = _jwk_to_public_key(public_key_jwk)
    signature_bytes = _b64url_decode(signature)
    hashes, ec = _crypto()
    try:
        public_key.verify(signature_bytes, message.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False


def create_public_key_fingerprint(public_key_jwk: dict[str, Any]) -> str:
    hashes, _ = _crypto()
    digest = hashes.Hash(hashes.SHA256())
    digest.update(_stable_json(public_key_jwk).encode("utf-8"))
    return _b64url_encode(digest.finalize())


def sign_message(private_key_jwk: dict[str, Any], message: str) -> str:
    hashes, ec = _crypto()
    private_key = _jwk_to_private_key(private_key_jwk)
    signature = private_key.sign(message.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    return _b64url_encode(signature)


def _jwk_to_public_key(jwk: dict[str, Any]):
    _, ec = _crypto()
    if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
        raise ValueError("Only P-256 EC JWK public keys are supported for css:// identity")
    x = int.from_bytes(_b64url_decode(jwk["x"]), "big")
    y = int.from_bytes(_b64url_decode(jwk["y"]), "big")
    return ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()


def _jwk_to_private_key(jwk: dict[str, Any]):
    _, ec = _crypto()
    if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
        raise ValueError("Only P-256 EC JWK private keys are supported for css:// identity")
    x = int.from_bytes(_b64url_decode(jwk["x"]), "big")
    y = int.from_bytes(_b64url_decode(jwk["y"]), "big")
    d = int.from_bytes(_b64url_decode(jwk["d"]), "big")
    return ec.EllipticCurvePrivateNumbers(
        d,
        ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()),
    ).private_key()


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _crypto():
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec

    return hashes, ec
