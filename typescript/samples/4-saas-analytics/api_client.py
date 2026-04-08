"""
Auto-generated Python API client.
Source: /home/mod/Code/plat/typescript/samples/4-saas-analytics/openapi.json
DO NOT EDIT MANUALLY.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel
from plat import OpenAPIAsyncClient, OpenAPIPromiseClient, OpenAPISyncClient, PLATPromise

OPENAPI_SPEC = json.loads(r'''{"openapi": "3.1.0", "info": {"title": "SaaS Analytics API", "version": "1.0.0"}, "servers": [{"url": "http://localhost:3000"}], "paths": {"/analytics/trackEvent": {"post": {"operationId": "trackEvent", "security": [{"bearer": []}], "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object", "properties": {"eventType": {"type": "string"}, "userId": {"type": "string"}, "properties": {"type": "object", "additionalProperties": true}}, "required": ["eventType", "userId"]}}}}, "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Event"}}}}}}}, "/analytics/trackPageView": {"post": {"operationId": "trackPageView", "security": [{"bearer": []}], "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object", "properties": {"userId": {"type": "string"}, "page": {"type": "string"}, "referrer": {"type": "string"}}, "required": ["userId", "page"]}}}}, "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/PageView"}}}}}}}, "/analytics/getAnalytics": {"get": {"operationId": "getAnalytics", "security": [{"bearer": []}], "parameters": [{"name": "from", "in": "query", "schema": {"type": "string"}}, {"name": "to", "in": "query", "schema": {"type": "string"}}], "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Analytics"}}}}}}}, "/analytics/getProfile": {"get": {"operationId": "getProfile", "parameters": [{"name": "id", "in": "query", "required": true, "schema": {"type": "string"}}], "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/User"}}}}}}}, "/analytics/listEvents": {"get": {"operationId": "listEvents", "security": [{"bearer": []}], "parameters": [{"name": "userId", "in": "query", "schema": {"type": "string"}}, {"name": "eventType", "in": "query", "schema": {"type": "string"}}, {"name": "limit", "in": "query", "schema": {"type": "integer"}}, {"name": "offset", "in": "query", "schema": {"type": "integer"}}], "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"type": "object", "properties": {"events": {"type": "array", "items": {"$ref": "#/components/schemas/Event"}}, "total": {"type": "integer"}}}}}}}}}}, "components": {"securitySchemes": {"bearer": {"type": "http", "scheme": "bearer"}}, "schemas": {"Event": {"type": "object", "properties": {"id": {"type": "string"}, "userId": {"type": "string"}, "eventType": {"type": "string"}, "properties": {"type": "object", "additionalProperties": true}, "timestamp": {"type": "string"}}, "required": ["id", "userId", "eventType", "timestamp"]}, "PageView": {"type": "object", "properties": {"id": {"type": "string"}, "userId": {"type": "string"}, "page": {"type": "string"}, "referrer": {"type": "string"}, "timestamp": {"type": "string"}}, "required": ["id", "userId", "page", "timestamp"]}, "Analytics": {"type": "object", "properties": {"totalEvents": {"type": "integer"}, "uniqueUsers": {"type": "integer"}, "eventTypes": {"type": "object", "additionalProperties": {"type": "integer"}}, "topPages": {"type": "array", "items": {"type": "object", "properties": {"page": {"type": "string"}, "views": {"type": "integer"}}}}}, "required": ["totalEvents", "uniqueUsers", "eventTypes", "topPages"]}, "User": {"type": "object", "properties": {"id": {"type": "string"}, "email": {"type": "string"}, "name": {"type": "string"}, "role": {"type": "string", "enum": ["admin", "analyst", "user"]}}, "required": ["id", "email", "name", "role"]}}}}''')
DEFAULT_BASE_URL = "http://localhost:3000"

# Models

class TrackEventInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    event_type: str = Field(..., alias="eventType")
    user_id: str = Field(..., alias="userId")
    properties: dict[str, Any] | None = Field(None)

class Event(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    id: str = Field(...)
    user_id: str = Field(..., alias="userId")
    event_type: str = Field(..., alias="eventType")
    timestamp: str = Field(...)
    properties: dict[str, Any] | None = Field(None)

class TrackEventOutput(RootModel[Event]):
    pass

class TrackPageViewInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    user_id: str = Field(..., alias="userId")
    page: str = Field(...)
    referrer: str | None = Field(None)

class PageView(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    id: str = Field(...)
    user_id: str = Field(..., alias="userId")
    page: str = Field(...)
    timestamp: str = Field(...)
    referrer: str | None = Field(None)

class TrackPageViewOutput(RootModel[PageView]):
    pass

class GetAnalyticsInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    from: str | None = Field(None)
    to: str | None = Field(None)

class AnalyticsTopPagesItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    page: str | None = Field(None)
    views: int | None = Field(None)

class Analytics(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    total_events: int = Field(..., alias="totalEvents")
    unique_users: int = Field(..., alias="uniqueUsers")
    event_types: dict[str, int] = Field(..., alias="eventTypes")
    top_pages: list[AnalyticsTopPagesItem] = Field(..., alias="topPages")

class GetAnalyticsOutput(RootModel[Analytics]):
    pass

class GetProfileInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    id: str = Field(...)

class User(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    id: str = Field(...)
    email: str = Field(...)
    name: str = Field(...)
    role: Literal["admin", "analyst", "user"] = Field(...)

class GetProfileOutput(RootModel[User]):
    pass

class ListEventsInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    user_id: str | None = Field(None, alias="userId")
    event_type: str | None = Field(None, alias="eventType")
    limit: int | None = Field(None)
    offset: int | None = Field(None)

class ListEventsOutput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    events: list[Event] | None = Field(None)
    total: int | None = Field(None)

class ApiClient(OpenAPISyncClient):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):
        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)

    def track_event(self, input: TrackEventInput | dict[str, Any] | None = None, /, **kwargs: Any) -> TrackEventOutput:
        """POST /analytics/trackEvent"""
        payload = input if input is not None else (TrackEventInput(**kwargs) if kwargs else None)
        return self.call_typed_route("POST", "/analytics/trackEvent", payload, TrackEventOutput)

    def trackEvent(self, input: TrackEventInput | dict[str, Any] | None = None, /, **kwargs: Any) -> TrackEventOutput:
        return self.track_event(input, **kwargs)

    def track_page_view(self, input: TrackPageViewInput | dict[str, Any] | None = None, /, **kwargs: Any) -> TrackPageViewOutput:
        """POST /analytics/trackPageView"""
        payload = input if input is not None else (TrackPageViewInput(**kwargs) if kwargs else None)
        return self.call_typed_route("POST", "/analytics/trackPageView", payload, TrackPageViewOutput)

    def trackPageView(self, input: TrackPageViewInput | dict[str, Any] | None = None, /, **kwargs: Any) -> TrackPageViewOutput:
        return self.track_page_view(input, **kwargs)

    def get_analytics(self, input: GetAnalyticsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetAnalyticsOutput:
        """GET /analytics/getAnalytics"""
        payload = input if input is not None else (GetAnalyticsInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/analytics/getAnalytics", payload, GetAnalyticsOutput)

    def getAnalytics(self, input: GetAnalyticsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetAnalyticsOutput:
        return self.get_analytics(input, **kwargs)

    def get_profile(self, input: GetProfileInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetProfileOutput:
        """GET /analytics/getProfile"""
        payload = input if input is not None else (GetProfileInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/analytics/getProfile", payload, GetProfileOutput)

    def getProfile(self, input: GetProfileInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetProfileOutput:
        return self.get_profile(input, **kwargs)

    def list_events(self, input: ListEventsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListEventsOutput:
        """GET /analytics/listEvents"""
        payload = input if input is not None else (ListEventsInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/analytics/listEvents", payload, ListEventsOutput)

    def listEvents(self, input: ListEventsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListEventsOutput:
        return self.list_events(input, **kwargs)


class AsyncApiClient(OpenAPIAsyncClient):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):
        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)

    async def track_event(self, input: TrackEventInput | dict[str, Any] | None = None, /, **kwargs: Any) -> TrackEventOutput:
        """POST /analytics/trackEvent"""
        payload = input if input is not None else (TrackEventInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("POST", "/analytics/trackEvent", payload, TrackEventOutput)

    async def trackEvent(self, input: TrackEventInput | dict[str, Any] | None = None, /, **kwargs: Any) -> TrackEventOutput:
        return await self.track_event(input, **kwargs)

    async def track_page_view(self, input: TrackPageViewInput | dict[str, Any] | None = None, /, **kwargs: Any) -> TrackPageViewOutput:
        """POST /analytics/trackPageView"""
        payload = input if input is not None else (TrackPageViewInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("POST", "/analytics/trackPageView", payload, TrackPageViewOutput)

    async def trackPageView(self, input: TrackPageViewInput | dict[str, Any] | None = None, /, **kwargs: Any) -> TrackPageViewOutput:
        return await self.track_page_view(input, **kwargs)

    async def get_analytics(self, input: GetAnalyticsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetAnalyticsOutput:
        """GET /analytics/getAnalytics"""
        payload = input if input is not None else (GetAnalyticsInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("GET", "/analytics/getAnalytics", payload, GetAnalyticsOutput)

    async def getAnalytics(self, input: GetAnalyticsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetAnalyticsOutput:
        return await self.get_analytics(input, **kwargs)

    async def get_profile(self, input: GetProfileInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetProfileOutput:
        """GET /analytics/getProfile"""
        payload = input if input is not None else (GetProfileInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("GET", "/analytics/getProfile", payload, GetProfileOutput)

    async def getProfile(self, input: GetProfileInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetProfileOutput:
        return await self.get_profile(input, **kwargs)

    async def list_events(self, input: ListEventsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListEventsOutput:
        """GET /analytics/listEvents"""
        payload = input if input is not None else (ListEventsInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("GET", "/analytics/listEvents", payload, ListEventsOutput)

    async def listEvents(self, input: ListEventsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListEventsOutput:
        return await self.list_events(input, **kwargs)


class PromiseApiClient(OpenAPIPromiseClient):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):
        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)

    def track_event(self, input: TrackEventInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[TrackEventOutput]:
        """POST /analytics/trackEvent"""
        payload = input if input is not None else (TrackEventInput(**kwargs) if kwargs else None)
        return self.call_typed_route("POST", "/analytics/trackEvent", payload, TrackEventOutput)

    def trackEvent(self, input: TrackEventInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[TrackEventOutput]:
        return self.track_event(input, **kwargs)

    def track_page_view(self, input: TrackPageViewInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[TrackPageViewOutput]:
        """POST /analytics/trackPageView"""
        payload = input if input is not None else (TrackPageViewInput(**kwargs) if kwargs else None)
        return self.call_typed_route("POST", "/analytics/trackPageView", payload, TrackPageViewOutput)

    def trackPageView(self, input: TrackPageViewInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[TrackPageViewOutput]:
        return self.track_page_view(input, **kwargs)

    def get_analytics(self, input: GetAnalyticsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[GetAnalyticsOutput]:
        """GET /analytics/getAnalytics"""
        payload = input if input is not None else (GetAnalyticsInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/analytics/getAnalytics", payload, GetAnalyticsOutput)

    def getAnalytics(self, input: GetAnalyticsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[GetAnalyticsOutput]:
        return self.get_analytics(input, **kwargs)

    def get_profile(self, input: GetProfileInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[GetProfileOutput]:
        """GET /analytics/getProfile"""
        payload = input if input is not None else (GetProfileInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/analytics/getProfile", payload, GetProfileOutput)

    def getProfile(self, input: GetProfileInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[GetProfileOutput]:
        return self.get_profile(input, **kwargs)

    def list_events(self, input: ListEventsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[ListEventsOutput]:
        """GET /analytics/listEvents"""
        payload = input if input is not None else (ListEventsInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/analytics/listEvents", payload, ListEventsOutput)

    def listEvents(self, input: ListEventsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[ListEventsOutput]:
        return self.list_events(input, **kwargs)


def create_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> ApiClient:
    return ApiClient(base_url=base_url, **kwargs)

def create_async_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> AsyncApiClient:
    return AsyncApiClient(base_url=base_url, **kwargs)

def create_promise_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> PromiseApiClient:
    return PromiseApiClient(base_url=base_url, **kwargs)
