from __future__ import annotations

from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any


@dataclass
class HttpResponse(Exception):
    status_code: int
    body: Any = None
    headers: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        super().__init__(f"HTTP {self.status_code}")


class HttpError(HttpResponse):
    def __init__(
        self,
        status_code: int,
        message: str,
        data: Any = None,
        headers: dict[str, str] | None = None,
    ):
        body: dict[str, Any] = {"error": message}
        if data is not None:
            body["data"] = data
        super().__init__(status_code=status_code, body=body, headers=headers or {})
        self.message = message
        self.data = data


def _status_to_class_name(status: HTTPStatus) -> str:
    special_cases = {
        "IM_A_TEAPOT": "ImATeapot",
        "URI_TOO_LONG": "UriTooLong",
        "REQUEST_URI_TOO_LONG": "UriTooLong",
        "HTTP_VERSION_NOT_SUPPORTED": "HttpVersionNotSupported",
        "MISDIRECTED_REQUEST": "MisdirectedRequest",
        "NON_AUTHORITATIVE_INFORMATION": "NonAuthoritativeInformation",
        "MULTI_STATUS": "MultiStatus",
        "ALREADY_REPORTED": "AlreadyReported",
        "LOOP_DETECTED": "LoopDetected",
        "INSUFFICIENT_STORAGE": "InsufficientStorage",
        "NETWORK_AUTHENTICATION_REQUIRED": "NetworkAuthenticationRequired",
        "UNAVAILABLE_FOR_LEGAL_REASONS": "UnavailableForLegalReasons",
        "REQUEST_HEADER_FIELDS_TOO_LARGE": "RequestHeaderFieldsTooLarge",
        "PERMANENT_REDIRECT": "PermanentRedirect",
        "PROXY_AUTHENTICATION_REQUIRED": "ProxyAuthenticationRequired",
        "PRECONDITION_REQUIRED": "PreconditionRequired",
        "PRECONDITION_FAILED": "PreconditionFailed",
        "LENGTH_REQUIRED": "LengthRequired",
    }
    if status.name in special_cases:
        return special_cases[status.name]
    return "".join(part.capitalize() for part in status.name.split("_"))


def _make_named_http_error(status: HTTPStatus):
    class NamedHttpError(HttpError):
        def __init__(self, message: str | None = None, data: Any = None, headers: dict[str, str] | None = None):
            super().__init__(
                status_code=int(status),
                message=message or status.phrase,
                data=data,
                headers=headers,
            )

    NamedHttpError.__name__ = _status_to_class_name(status)
    NamedHttpError.__qualname__ = NamedHttpError.__name__
    NamedHttpError.__doc__ = f"HTTP {int(status)} {status.phrase}"
    return NamedHttpError


HTTP_ERROR_TYPES: dict[str, type[HttpError]] = {
    _status_to_class_name(status): _make_named_http_error(status)
    for status in HTTPStatus
    if int(status) >= 400
}

globals().update(HTTP_ERROR_TYPES)


def ok(body: Any = None, headers: dict[str, str] | None = None) -> HttpResponse:
    return HttpResponse(status_code=200, body=body, headers=headers or {})


def created(body: Any = None, headers: dict[str, str] | None = None) -> HttpResponse:
    return HttpResponse(status_code=201, body=body, headers=headers or {})


def no_content(headers: dict[str, str] | None = None) -> HttpResponse:
    return HttpResponse(status_code=204, body=None, headers=headers or {})
