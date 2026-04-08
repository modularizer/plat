"""
Auto-generated Python API client.
Source: /home/mod/Code/plat/typescript/samples/3-ecommerce/openapi.json
DO NOT EDIT MANUALLY.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel
from plat import OpenAPIAsyncClient, OpenAPIPromiseClient, OpenAPISyncClient, PLATPromise

OPENAPI_SPEC = json.loads(r'''{"openapi": "3.0.0", "info": {"title": "API", "version": "1.0.0"}, "servers": [{"url": "http://localhost:3000"}], "paths": {}}''')
DEFAULT_BASE_URL = "http://localhost:3000"

class ApiClient(OpenAPISyncClient):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):
        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)

    pass

class AsyncApiClient(OpenAPIAsyncClient):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):
        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)

    pass

class PromiseApiClient(OpenAPIPromiseClient):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):
        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)

    pass

def create_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> ApiClient:
    return ApiClient(base_url=base_url, **kwargs)

def create_async_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> AsyncApiClient:
    return AsyncApiClient(base_url=base_url, **kwargs)

def create_promise_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> PromiseApiClient:
    return PromiseApiClient(base_url=base_url, **kwargs)
