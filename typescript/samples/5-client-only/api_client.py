"""
Auto-generated Python API client.
Source: /home/mod/Code/plat/typescript/samples/5-client-only/openapi.json
DO NOT EDIT MANUALLY.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel
from plat import OpenAPIAsyncClient, OpenAPIPromiseClient, OpenAPISyncClient, PLATPromise

OPENAPI_SPEC = json.loads(r'''{"openapi": "3.1.0", "info": {"title": "E-commerce API", "version": "1.0.0"}, "servers": [{"url": "http://localhost:3000"}], "paths": {"/products/listProducts": {"get": {"tags": ["products"], "operationId": "listProducts", "parameters": [{"name": "category", "in": "query", "schema": {"type": "string"}}, {"name": "inStock", "in": "query", "schema": {"type": "boolean"}}, {"name": "limit", "in": "query", "schema": {"type": "integer"}}, {"name": "offset", "in": "query", "schema": {"type": "integer"}}], "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"type": "object", "properties": {"products": {"type": "array", "items": {"$ref": "#/components/schemas/Product"}}, "total": {"type": "integer"}}}}}}}}}, "/products/getProduct": {"get": {"tags": ["products"], "operationId": "getProduct", "parameters": [{"name": "id", "in": "query", "required": true, "schema": {"type": "integer"}}], "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Product"}}}}}}}, "/products/searchProducts": {"get": {"tags": ["products"], "operationId": "searchProducts", "parameters": [{"name": "q", "in": "query", "required": true, "schema": {"type": "string"}}, {"name": "limit", "in": "query", "schema": {"type": "integer"}}], "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"type": "object", "properties": {"products": {"type": "array", "items": {"$ref": "#/components/schemas/Product"}}, "total": {"type": "integer"}}}}}}}}}, "/orders/getCart": {"get": {"tags": ["orders"], "operationId": "getCart", "parameters": [{"name": "userId", "in": "query", "required": true, "schema": {"type": "string"}}], "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Cart"}}}}}}}, "/orders/addToCart": {"post": {"tags": ["orders"], "operationId": "addToCart", "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object", "properties": {"userId": {"type": "string"}, "productId": {"type": "integer"}, "quantity": {"type": "integer"}}, "required": ["userId", "productId", "quantity"]}}}}, "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"type": "object", "properties": {"success": {"type": "boolean"}}}}}}}}}, "/orders/checkout": {"post": {"tags": ["orders"], "operationId": "checkout", "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object", "properties": {"userId": {"type": "string"}}, "required": ["userId"]}}}}, "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Order"}}}}}}}, "/orders/listOrders": {"get": {"tags": ["orders"], "operationId": "listOrders", "parameters": [{"name": "userId", "in": "query", "required": true, "schema": {"type": "string"}}, {"name": "limit", "in": "query", "schema": {"type": "integer"}}, {"name": "offset", "in": "query", "schema": {"type": "integer"}}], "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"type": "object", "properties": {"orders": {"type": "array", "items": {"$ref": "#/components/schemas/Order"}}, "total": {"type": "integer"}}}}}}}}}, "/orders/getOrder": {"get": {"tags": ["orders"], "operationId": "getOrder", "parameters": [{"name": "id", "in": "query", "required": true, "schema": {"type": "string"}}], "responses": {"200": {"description": "Success", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Order"}}}}}}}}, "components": {"schemas": {"Product": {"type": "object", "properties": {"id": {"type": "integer"}, "name": {"type": "string"}, "description": {"type": "string"}, "price": {"type": "number"}, "category": {"type": "string"}, "inStock": {"type": "boolean"}, "quantity": {"type": "integer"}}, "required": ["id", "name", "description", "price", "category", "inStock", "quantity"]}, "CartItem": {"type": "object", "properties": {"productId": {"type": "integer"}, "quantity": {"type": "integer"}, "priceAtAdded": {"type": "number"}}, "required": ["productId", "quantity", "priceAtAdded"]}, "Cart": {"type": "object", "properties": {"userId": {"type": "string"}, "items": {"type": "array", "items": {"$ref": "#/components/schemas/CartItem"}}, "subtotal": {"type": "number"}}, "required": ["userId", "items", "subtotal"]}, "Order": {"type": "object", "properties": {"id": {"type": "string"}, "userId": {"type": "string"}, "items": {"type": "array", "items": {"$ref": "#/components/schemas/CartItem"}}, "total": {"type": "number"}, "status": {"type": "string", "enum": ["pending", "processing", "shipped", "delivered"]}, "createdAt": {"type": "string"}}, "required": ["id", "userId", "items", "total", "status", "createdAt"]}}}}''')
DEFAULT_BASE_URL = "http://localhost:3000"

# Models

class ListProductsInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    category: str | None = Field(None)
    in_stock: bool | None = Field(None, alias="inStock")
    limit: int | None = Field(None)
    offset: int | None = Field(None)

class Product(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    id: int = Field(...)
    name: str = Field(...)
    description: str = Field(...)
    price: float = Field(...)
    category: str = Field(...)
    in_stock: bool = Field(..., alias="inStock")
    quantity: int = Field(...)

class ListProductsOutput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    products: list[Product] | None = Field(None)
    total: int | None = Field(None)

class GetProductInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    id: int = Field(...)

class GetProductOutput(RootModel[Product]):
    pass

class SearchProductsInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    q: str = Field(...)
    limit: int | None = Field(None)

class SearchProductsOutput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    products: list[Product] | None = Field(None)
    total: int | None = Field(None)

class GetCartInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    user_id: str = Field(..., alias="userId")

class CartItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    product_id: int = Field(..., alias="productId")
    quantity: int = Field(...)
    price_at_added: float = Field(..., alias="priceAtAdded")

class Cart(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    user_id: str = Field(..., alias="userId")
    items: list[CartItem] = Field(...)
    subtotal: float = Field(...)

class GetCartOutput(RootModel[Cart]):
    pass

class AddToCartInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    user_id: str = Field(..., alias="userId")
    product_id: int = Field(..., alias="productId")
    quantity: int = Field(...)

class AddToCartOutput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    success: bool | None = Field(None)

class CheckoutInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    user_id: str = Field(..., alias="userId")

class Order(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    id: str = Field(...)
    user_id: str = Field(..., alias="userId")
    items: list[CartItem] = Field(...)
    total: float = Field(...)
    status: Literal["pending", "processing", "shipped", "delivered"] = Field(...)
    created_at: str = Field(..., alias="createdAt")

class CheckoutOutput(RootModel[Order]):
    pass

class ListOrdersInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    user_id: str = Field(..., alias="userId")
    limit: int | None = Field(None)
    offset: int | None = Field(None)

class ListOrdersOutput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    orders: list[Order] | None = Field(None)
    total: int | None = Field(None)

class GetOrderInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='allow')
    id: str = Field(...)

class GetOrderOutput(RootModel[Order]):
    pass

class ApiClient(OpenAPISyncClient):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):
        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)

    def list_products(self, input: ListProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListProductsOutput:
        """GET /products/listProducts"""
        payload = input if input is not None else (ListProductsInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/products/listProducts", payload, ListProductsOutput)

    def listProducts(self, input: ListProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListProductsOutput:
        return self.list_products(input, **kwargs)

    def get_product(self, input: GetProductInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetProductOutput:
        """GET /products/getProduct"""
        payload = input if input is not None else (GetProductInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/products/getProduct", payload, GetProductOutput)

    def getProduct(self, input: GetProductInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetProductOutput:
        return self.get_product(input, **kwargs)

    def search_products(self, input: SearchProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> SearchProductsOutput:
        """GET /products/searchProducts"""
        payload = input if input is not None else (SearchProductsInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/products/searchProducts", payload, SearchProductsOutput)

    def searchProducts(self, input: SearchProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> SearchProductsOutput:
        return self.search_products(input, **kwargs)

    def get_cart(self, input: GetCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetCartOutput:
        """GET /orders/getCart"""
        payload = input if input is not None else (GetCartInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/orders/getCart", payload, GetCartOutput)

    def getCart(self, input: GetCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetCartOutput:
        return self.get_cart(input, **kwargs)

    def add_to_cart(self, input: AddToCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> AddToCartOutput:
        """POST /orders/addToCart"""
        payload = input if input is not None else (AddToCartInput(**kwargs) if kwargs else None)
        return self.call_typed_route("POST", "/orders/addToCart", payload, AddToCartOutput)

    def addToCart(self, input: AddToCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> AddToCartOutput:
        return self.add_to_cart(input, **kwargs)

    def checkout(self, input: CheckoutInput | dict[str, Any] | None = None, /, **kwargs: Any) -> CheckoutOutput:
        """POST /orders/checkout"""
        payload = input if input is not None else (CheckoutInput(**kwargs) if kwargs else None)
        return self.call_typed_route("POST", "/orders/checkout", payload, CheckoutOutput)


    def list_orders(self, input: ListOrdersInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListOrdersOutput:
        """GET /orders/listOrders"""
        payload = input if input is not None else (ListOrdersInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/orders/listOrders", payload, ListOrdersOutput)

    def listOrders(self, input: ListOrdersInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListOrdersOutput:
        return self.list_orders(input, **kwargs)

    def get_order(self, input: GetOrderInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetOrderOutput:
        """GET /orders/getOrder"""
        payload = input if input is not None else (GetOrderInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/orders/getOrder", payload, GetOrderOutput)

    def getOrder(self, input: GetOrderInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetOrderOutput:
        return self.get_order(input, **kwargs)


class AsyncApiClient(OpenAPIAsyncClient):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):
        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)

    async def list_products(self, input: ListProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListProductsOutput:
        """GET /products/listProducts"""
        payload = input if input is not None else (ListProductsInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("GET", "/products/listProducts", payload, ListProductsOutput)

    async def listProducts(self, input: ListProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListProductsOutput:
        return await self.list_products(input, **kwargs)

    async def get_product(self, input: GetProductInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetProductOutput:
        """GET /products/getProduct"""
        payload = input if input is not None else (GetProductInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("GET", "/products/getProduct", payload, GetProductOutput)

    async def getProduct(self, input: GetProductInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetProductOutput:
        return await self.get_product(input, **kwargs)

    async def search_products(self, input: SearchProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> SearchProductsOutput:
        """GET /products/searchProducts"""
        payload = input if input is not None else (SearchProductsInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("GET", "/products/searchProducts", payload, SearchProductsOutput)

    async def searchProducts(self, input: SearchProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> SearchProductsOutput:
        return await self.search_products(input, **kwargs)

    async def get_cart(self, input: GetCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetCartOutput:
        """GET /orders/getCart"""
        payload = input if input is not None else (GetCartInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("GET", "/orders/getCart", payload, GetCartOutput)

    async def getCart(self, input: GetCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetCartOutput:
        return await self.get_cart(input, **kwargs)

    async def add_to_cart(self, input: AddToCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> AddToCartOutput:
        """POST /orders/addToCart"""
        payload = input if input is not None else (AddToCartInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("POST", "/orders/addToCart", payload, AddToCartOutput)

    async def addToCart(self, input: AddToCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> AddToCartOutput:
        return await self.add_to_cart(input, **kwargs)

    async def checkout(self, input: CheckoutInput | dict[str, Any] | None = None, /, **kwargs: Any) -> CheckoutOutput:
        """POST /orders/checkout"""
        payload = input if input is not None else (CheckoutInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("POST", "/orders/checkout", payload, CheckoutOutput)


    async def list_orders(self, input: ListOrdersInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListOrdersOutput:
        """GET /orders/listOrders"""
        payload = input if input is not None else (ListOrdersInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("GET", "/orders/listOrders", payload, ListOrdersOutput)

    async def listOrders(self, input: ListOrdersInput | dict[str, Any] | None = None, /, **kwargs: Any) -> ListOrdersOutput:
        return await self.list_orders(input, **kwargs)

    async def get_order(self, input: GetOrderInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetOrderOutput:
        """GET /orders/getOrder"""
        payload = input if input is not None else (GetOrderInput(**kwargs) if kwargs else None)
        return await self.call_typed_route("GET", "/orders/getOrder", payload, GetOrderOutput)

    async def getOrder(self, input: GetOrderInput | dict[str, Any] | None = None, /, **kwargs: Any) -> GetOrderOutput:
        return await self.get_order(input, **kwargs)


class PromiseApiClient(OpenAPIPromiseClient):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, **kwargs: Any):
        super().__init__(OPENAPI_SPEC, base_url=base_url, **kwargs)

    def list_products(self, input: ListProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[ListProductsOutput]:
        """GET /products/listProducts"""
        payload = input if input is not None else (ListProductsInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/products/listProducts", payload, ListProductsOutput)

    def listProducts(self, input: ListProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[ListProductsOutput]:
        return self.list_products(input, **kwargs)

    def get_product(self, input: GetProductInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[GetProductOutput]:
        """GET /products/getProduct"""
        payload = input if input is not None else (GetProductInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/products/getProduct", payload, GetProductOutput)

    def getProduct(self, input: GetProductInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[GetProductOutput]:
        return self.get_product(input, **kwargs)

    def search_products(self, input: SearchProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[SearchProductsOutput]:
        """GET /products/searchProducts"""
        payload = input if input is not None else (SearchProductsInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/products/searchProducts", payload, SearchProductsOutput)

    def searchProducts(self, input: SearchProductsInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[SearchProductsOutput]:
        return self.search_products(input, **kwargs)

    def get_cart(self, input: GetCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[GetCartOutput]:
        """GET /orders/getCart"""
        payload = input if input is not None else (GetCartInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/orders/getCart", payload, GetCartOutput)

    def getCart(self, input: GetCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[GetCartOutput]:
        return self.get_cart(input, **kwargs)

    def add_to_cart(self, input: AddToCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[AddToCartOutput]:
        """POST /orders/addToCart"""
        payload = input if input is not None else (AddToCartInput(**kwargs) if kwargs else None)
        return self.call_typed_route("POST", "/orders/addToCart", payload, AddToCartOutput)

    def addToCart(self, input: AddToCartInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[AddToCartOutput]:
        return self.add_to_cart(input, **kwargs)

    def checkout(self, input: CheckoutInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[CheckoutOutput]:
        """POST /orders/checkout"""
        payload = input if input is not None else (CheckoutInput(**kwargs) if kwargs else None)
        return self.call_typed_route("POST", "/orders/checkout", payload, CheckoutOutput)


    def list_orders(self, input: ListOrdersInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[ListOrdersOutput]:
        """GET /orders/listOrders"""
        payload = input if input is not None else (ListOrdersInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/orders/listOrders", payload, ListOrdersOutput)

    def listOrders(self, input: ListOrdersInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[ListOrdersOutput]:
        return self.list_orders(input, **kwargs)

    def get_order(self, input: GetOrderInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[GetOrderOutput]:
        """GET /orders/getOrder"""
        payload = input if input is not None else (GetOrderInput(**kwargs) if kwargs else None)
        return self.call_typed_route("GET", "/orders/getOrder", payload, GetOrderOutput)

    def getOrder(self, input: GetOrderInput | dict[str, Any] | None = None, /, **kwargs: Any) -> PLATPromise[GetOrderOutput]:
        return self.get_order(input, **kwargs)


def create_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> ApiClient:
    return ApiClient(base_url=base_url, **kwargs)

def create_async_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> AsyncApiClient:
    return AsyncApiClient(base_url=base_url, **kwargs)

def create_promise_client(base_url: str = DEFAULT_BASE_URL, **kwargs: Any) -> PromiseApiClient:
    return PromiseApiClient(base_url=base_url, **kwargs)
