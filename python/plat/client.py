"""
plat base client classes with shared retry logic.

Both SyncClient and AsyncClient provide:
  - Exponential backoff with jitter on 429/5xx
  - Configurable retries, backoff, timeout
  - Automatic None-stripping from params and json bodies
  - Context manager support

Generated API clients subclass these and add thin endpoint methods.
"""

from __future__ import annotations

import asyncio
import random
import time
from typing import Any

RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


def _httpx():
    import httpx

    return httpx


class SyncClient:
    """Base sync HTTP client with retry logic."""

    def __init__(
        self,
        base_url: str = "http://localhost:3000",
        *,
        headers: dict[str, str] | None = None,
        timeout: float = 30.0,
        retries: int = 3,
        backoff: float = 0.5,
    ):
        self._base_url = base_url
        self._headers = headers or {}
        self._timeout = timeout
        self._client = None
        self._retries = retries
        self._backoff = backoff

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json: dict | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        client = self._get_client()
        if params is not None:
            params = {k: v for k, v in params.items() if v is not None}
        if json is not None:
            json = {k: v for k, v in json.items() if v is not None}
        last_exc: Exception | None = None
        for attempt in range(self._retries + 1):
            try:
                merged_headers = {**self._headers, **(headers or {})} if headers else None
                r = client.request(method, path, params=params, json=json, headers=merged_headers)
                if r.status_code not in RETRYABLE_STATUS or attempt == self._retries:
                    r.raise_for_status()
                    return r.json()
                httpx = _httpx()
                last_exc = httpx.HTTPStatusError(
                    f"{method} {path} returned {r.status_code}",
                    request=r.request,
                    response=r,
                )
            except _httpx().TransportError as exc:
                if attempt == self._retries:
                    raise
                last_exc = exc
            delay = self._backoff * (2 ** attempt) + random.uniform(0, self._backoff)
            time.sleep(delay)
        raise last_exc  # type: ignore[misc]

    def _get_client(self):
        if self._client is None:
            httpx = _httpx()
            self._client = httpx.Client(
                base_url=self._base_url,
                headers=self._headers,
                timeout=self._timeout,
            )
        return self._client


class AsyncClient:
    """Base async HTTP client with retry logic."""

    def __init__(
        self,
        base_url: str = "http://localhost:3000",
        *,
        headers: dict[str, str] | None = None,
        timeout: float = 30.0,
        retries: int = 3,
        backoff: float = 0.5,
    ):
        self._base_url = base_url
        self._headers = headers or {}
        self._timeout = timeout
        self._client = None
        self._retries = retries
        self._backoff = backoff

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json: dict | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        client = self._get_client()
        if params is not None:
            params = {k: v for k, v in params.items() if v is not None}
        if json is not None:
            json = {k: v for k, v in json.items() if v is not None}
        last_exc: Exception | None = None
        for attempt in range(self._retries + 1):
            try:
                merged_headers = {**self._headers, **(headers or {})} if headers else None
                r = await client.request(method, path, params=params, json=json, headers=merged_headers)
                if r.status_code not in RETRYABLE_STATUS or attempt == self._retries:
                    r.raise_for_status()
                    return r.json()
                httpx = _httpx()
                last_exc = httpx.HTTPStatusError(
                    f"{method} {path} returned {r.status_code}",
                    request=r.request,
                    response=r,
                )
            except _httpx().TransportError as exc:
                if attempt == self._retries:
                    raise
                last_exc = exc
            delay = self._backoff * (2 ** attempt) + random.uniform(0, self._backoff)
            await asyncio.sleep(delay)
        raise last_exc  # type: ignore[misc]

    def _get_client(self):
        if self._client is None:
            httpx = _httpx()
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                headers=self._headers,
                timeout=self._timeout,
            )
        return self._client
