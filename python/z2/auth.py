from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .errors import HttpError


@dataclass
class JwtAuthConfig:
    secret: str
    algorithms: list[str] | None = None
    issuer: str | None = None
    audience: str | None = None
    expires_in: int | str | None = None
    refresh_expires_in: int | str | None = None
    get_token: Callable[[Any], str | None] | None = None


def _lazy_jwt():
    try:
        import jwt
    except ImportError as exc:
        raise ImportError(
            "JWT auth support requires PyJWT. Install the Python package with JWT support available."
        ) from exc
    return jwt


def extract_token(request: Any, config: JwtAuthConfig) -> str | None:
    if config.get_token is not None:
        return config.get_token(request)

    auth_header = None
    headers = getattr(request, "headers", None)
    if headers is not None:
        auth_header = headers.get("authorization")

    if not auth_header:
        return None

    parts = str(auth_header).split(" ")
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def sign_token(payload: dict[str, Any], config: JwtAuthConfig) -> str:
    jwt = _lazy_jwt()
    algorithm = (config.algorithms or ["HS256"])[0]
    claims = _build_claims(payload, config.expires_in, config)
    return jwt.encode(claims, config.secret, algorithm=algorithm, headers=None)


def sign_refresh_token(payload: dict[str, Any], config: JwtAuthConfig) -> str:
    jwt = _lazy_jwt()
    algorithm = (config.algorithms or ["HS256"])[0]
    claims = _build_claims(payload, config.refresh_expires_in, config)
    return jwt.encode(claims, config.secret, algorithm=algorithm, headers=None)


class JwtAuthHandler:
    def __init__(self, config: JwtAuthConfig):
        self.config = config

    def verify(self, mode: str, request: Any, ctx: Any) -> Any:
        if mode != "jwt":
            return None

        token = extract_token(request, self.config)
        if not token:
            raise HttpError(401, "Missing or invalid authorization token")

        jwt = _lazy_jwt()
        try:
            options: dict[str, Any] = {}
            if self.config.audience is not None:
                options["audience"] = self.config.audience
            if self.config.issuer is not None:
                options["issuer"] = self.config.issuer
            return jwt.decode(
                token,
                self.config.secret,
                algorithms=self.config.algorithms or ["HS256"],
                **options,
            )
        except Exception as exc:
            raise HttpError(401, "Invalid or expired token") from exc


def create_jwt_auth(config: JwtAuthConfig | dict[str, Any]) -> JwtAuthHandler:
    if isinstance(config, JwtAuthConfig):
        return JwtAuthHandler(config)
    return JwtAuthHandler(JwtAuthConfig(**config))


def _build_claims(
    payload: dict[str, Any],
    expires_in: int | str | None,
    config: JwtAuthConfig,
) -> dict[str, Any]:
    claims = dict(payload)
    now = datetime.now(timezone.utc)
    claims.setdefault("iat", int(now.timestamp()))
    expiry = _parse_expiry(now, expires_in)
    if expiry is not None:
        claims.setdefault("exp", int(expiry.timestamp()))
    if config.issuer is not None:
        claims.setdefault("iss", config.issuer)
    if config.audience is not None:
        claims.setdefault("aud", config.audience)
    return claims


def _parse_expiry(now: datetime, expires_in: int | str | None) -> datetime | None:
    if expires_in is None:
        return None
    if isinstance(expires_in, int):
        return now + timedelta(seconds=expires_in)

    value = expires_in.strip().lower()
    if value.isdigit():
        return now + timedelta(seconds=int(value))

    unit = value[-1]
    amount = value[:-1]
    if not amount.isdigit():
        return None
    count = int(amount)
    if unit == "s":
        return now + timedelta(seconds=count)
    if unit == "m":
        return now + timedelta(minutes=count)
    if unit == "h":
        return now + timedelta(hours=count)
    if unit == "d":
        return now + timedelta(days=count)
    return None
