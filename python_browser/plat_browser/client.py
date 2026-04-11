from __future__ import annotations

import ast
from collections.abc import Awaitable, Callable
from typing import Any


BrowserClientConnectBridge = Callable[[str, Any], Awaitable[Any]]
BrowserClientCallBridge = Callable[[int, str, Any], Awaitable[Any]]

_CONNECT_BRIDGE: BrowserClientConnectBridge | None = None
_CALL_BRIDGE: BrowserClientCallBridge | None = None


class BrowserPLATClient:
    def __init__(self, client_id: int, base_url: str, openapi: Any = None) -> None:
        self.client_id = client_id
        self.base_url = base_url
        self.openapi = openapi

    async def call(self, method_name: str, input: Any = None, /, **kwargs: Any) -> Any:
        call_bridge = _require_call_bridge()
        payload = _merge_input(input, kwargs)
        result = await call_bridge(self.client_id, method_name, payload)
        return _to_python_value(result)

    def __getattr__(self, method_name: str):
        async def invoke(input: Any = None, /, **kwargs: Any) -> Any:
            return await self.call(method_name, input, **kwargs)

        return invoke


def _set_browser_client_bridge(
    connect_bridge: BrowserClientConnectBridge,
    call_bridge: BrowserClientCallBridge,
) -> None:
    global _CONNECT_BRIDGE, _CALL_BRIDGE
    _CONNECT_BRIDGE = connect_bridge
    _CALL_BRIDGE = call_bridge


async def connect_client_side_server(base_url: str, options: Any = None) -> BrowserPLATClient:
    connect_bridge = _require_connect_bridge()
    connection = _to_python_value(await connect_bridge(base_url, options))
    if not isinstance(connection, dict):
        raise RuntimeError("Browser client bridge returned an invalid connection payload.")
    return BrowserPLATClient(
        client_id=int(connection["client_id"]),
        base_url=str(connection.get("base_url") or base_url),
        openapi=connection.get("openapi"),
    )


# Server-style parity alias.
connect_server = connect_client_side_server


async def run_python_client_source(source: str) -> Any:
    namespace = {
        "__name__": "__plat_browser_client__",
        "connect_client_side_server": connect_client_side_server,
    }
    compiled = _compile_python_client_snippet(source)
    exec(compiled, namespace)
    result = await namespace["__plat_browser_client_main__"]()
    return _to_python_value(result)


def _compile_python_client_snippet(source: str):
    module = ast.parse(source, mode="exec")
    body = list(module.body)
    if body and isinstance(body[-1], ast.Expr):
        body[-1] = ast.Return(body[-1].value)
    else:
        body.append(ast.Return(value=ast.Constant(value=None)))
    function = ast.AsyncFunctionDef(
        name="__plat_browser_client_main__",
        args=ast.arguments(
            posonlyargs=[],
            args=[],
            kwonlyargs=[],
            kw_defaults=[],
            defaults=[],
            vararg=None,
            kwarg=None,
        ),
        body=body,
        decorator_list=[],
        returns=None,
        type_comment=None,
    )
    wrapper = ast.Module(body=[function], type_ignores=[])
    ast.fix_missing_locations(wrapper)
    return compile(wrapper, "<plat_browser_client>", "exec")


def _merge_input(input_data: Any, kwargs: dict[str, Any]) -> Any:
    if input_data is None:
        return kwargs or {}
    if kwargs:
        if isinstance(input_data, dict):
            merged = dict(input_data)
            merged.update(kwargs)
            return merged
        raise TypeError("Cannot pass both a non-dict positional input and keyword arguments.")
    return input_data


def _to_python_value(value: Any) -> Any:
    to_py = getattr(value, "to_py", None)
    if callable(to_py):
        try:
            return to_py()
        except TypeError:
            return to_py(depth=-1)
    return value


def _require_connect_bridge() -> BrowserClientConnectBridge:
    if _CONNECT_BRIDGE is None:
        raise RuntimeError("Browser Python client bridge is not installed in this runtime.")
    return _CONNECT_BRIDGE


def _require_call_bridge() -> BrowserClientCallBridge:
    if _CALL_BRIDGE is None:
        raise RuntimeError("Browser Python client bridge is not installed in this runtime.")
    return _CALL_BRIDGE
