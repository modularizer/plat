from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .css_identity import CSSAuthorityKeyPair, CSSKnownHostRecord, create_signed_authority_record
from .decorators import Controller, GET


@dataclass
class AuthorityServerOptions:
    authority_key_pair: CSSAuthorityKeyPair
    known_hosts: dict[str, CSSKnownHostRecord]
    authority_name: str | None = None
    allow_server_names: list[str] | None = None
    allow: Callable[[str, CSSKnownHostRecord], bool] | None = None


def create_authority_server_controller(options: AuthorityServerOptions):
    @Controller("authority")
    class AuthorityServerApi:
        @GET()
        def resolveAuthorityHost(self, serverName: str):
            record = _get_host_record(options, serverName)
            if record is None:
                return None
            return _serialize_record(
                create_signed_authority_record(
                    options.authority_key_pair,
                    server_name=serverName,
                    public_key_jwk=record.public_key_jwk,
                    key_id=record.key_id,
                    authority_name=options.authority_name,
                )
            )

        @GET()
        def listAuthorityHosts(
            self,
            q: str | None = None,
            limit: int | None = None,
            offset: int | None = None,
            serverNames: list[str] | None = None,
        ):
            records = _select_host_records(options, q=q, limit=limit, offset=offset, server_names=serverNames)
            return {
                "authorityName": options.authority_name,
                "total": len(records),
                "hosts": [
                    {
                        "serverName": server_name,
                        "keyId": record.key_id,
                        "fingerprint": record.fingerprint,
                        "source": record.source,
                        "trustedAt": record.trusted_at,
                    }
                    for server_name, record in records
                ],
            }

        @GET()
        def exportAuthorityHosts(
            self,
            q: str | None = None,
            limit: int | None = None,
            offset: int | None = None,
            serverNames: list[str] | None = None,
        ):
            records = _select_host_records(options, q=q, limit=limit, offset=offset, server_names=serverNames)
            return {
                "authorityName": options.authority_name,
                "total": len(records),
                "records": [
                    _serialize_record(
                        create_signed_authority_record(
                            options.authority_key_pair,
                            server_name=server_name,
                            public_key_jwk=record.public_key_jwk,
                            key_id=record.key_id,
                            authority_name=options.authority_name,
                        )
                    )
                    for server_name, record in records
                ],
            }

    return AuthorityServerApi


def _get_host_record(options: AuthorityServerOptions, server_name: str) -> CSSKnownHostRecord | None:
    record = options.known_hosts.get(server_name)
    if record is None:
        return None
    if options.allow_server_names and server_name not in options.allow_server_names:
        return None
    if options.allow and not options.allow(server_name, record):
        return None
    return record


def _select_host_records(
    options: AuthorityServerOptions,
    *,
    q: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
    server_names: list[str] | None = None,
) -> list[tuple[str, CSSKnownHostRecord]]:
    filtered = [
        (server_name, record)
        for server_name, record in sorted(options.known_hosts.items())
        if _get_host_record(options, server_name) is record
        and (not server_names or server_name in server_names)
        and (not q or q.lower() in server_name.lower())
    ]
    start = max(0, offset or 0)
    size = max(1, limit or len(filtered) or 1)
    return filtered[start : start + size]


def _serialize_record(record) -> dict:
    return {
        "protocol": record.protocol,
        "serverName": record.server_name,
        "publicKeyJwk": record.public_key_jwk,
        "keyId": record.key_id,
        "authorityName": record.authority_name,
        "issuedAt": record.issued_at,
        "signature": record.signature,
    }
