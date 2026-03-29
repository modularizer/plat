"""
E-commerce API — Python Client

Auto-generated from openapi.json — DO NOT EDIT
Regenerate with: npx tsx scripts/gen-python.ts

Install the plat base package: pip install plat
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from plat import SyncClient, AsyncClient

# ── Data Models ──────────────────────────────────────────

@dataclass
class Product:
    id: int
    name: str
    description: str
    price: float
    category: str
    in_stock: bool
    quantity: int


@dataclass
class CartItem:
    product_id: int
    quantity: int
    price_at_added: float


@dataclass
class Cart:
    user_id: str
    items: list[CartItem]
    subtotal: float


@dataclass
class Order:
    id: str
    user_id: str
    items: list[CartItem]
    total: float
    status: Literal["pending", "processing", "shipped", "delivered"]
    created_at: str


# ── API Client ───────────────────────────────────────────

class ApiClient(SyncClient):
    """
    E-commerce API v1.0.0

    Flat API client — every method maps directly to an endpoint.
    Inherits retry logic from plat.SyncClient.
    """

    def list_products(self, category: str | None = None, in_stock: bool | None = None, limit: int | None = None, offset: int | None = None) -> dict:
        return self._request("GET", "/products/listProducts", params={
            "category": category,
            "inStock": in_stock,
            "limit": limit,
            "offset": offset,
        })

    def get_product(self, id: int) -> Product:
        return self._request("GET", "/products/getProduct", params={
            "id": id,
        })

    def search_products(self, q: str, limit: int | None = None) -> dict:
        return self._request("GET", "/products/searchProducts", params={
            "q": q,
            "limit": limit,
        })

    def get_cart(self, user_id: str) -> Cart:
        return self._request("GET", "/orders/getCart", params={
            "userId": user_id,
        })

    def add_to_cart(self, user_id: str, product_id: int, quantity: int) -> dict:
        return self._request("POST", "/orders/addToCart", json={
            "userId": user_id,
            "productId": product_id,
            "quantity": quantity,
        })

    def checkout(self, user_id: str) -> Order:
        return self._request("POST", "/orders/checkout", json={
            "userId": user_id,
        })

    def list_orders(self, user_id: str, limit: int | None = None, offset: int | None = None) -> dict:
        return self._request("GET", "/orders/listOrders", params={
            "userId": user_id,
            "limit": limit,
            "offset": offset,
        })

    def get_order(self, id: str) -> Order:
        return self._request("GET", "/orders/getOrder", params={
            "id": id,
        })


# ── Async API Client ─────────────────────────────────────

class AsyncApiClient(AsyncClient):
    """Async variant — inherits retry logic from plat.AsyncClient."""

    async def list_products(self, category: str | None = None, in_stock: bool | None = None, limit: int | None = None, offset: int | None = None) -> dict:
        return await self._request("GET", "/products/listProducts", params={
            "category": category,
            "inStock": in_stock,
            "limit": limit,
            "offset": offset,
        })

    async def get_product(self, id: int) -> Product:
        return await self._request("GET", "/products/getProduct", params={
            "id": id,
        })

    async def search_products(self, q: str, limit: int | None = None) -> dict:
        return await self._request("GET", "/products/searchProducts", params={
            "q": q,
            "limit": limit,
        })

    async def get_cart(self, user_id: str) -> Cart:
        return await self._request("GET", "/orders/getCart", params={
            "userId": user_id,
        })

    async def add_to_cart(self, user_id: str, product_id: int, quantity: int) -> dict:
        return await self._request("POST", "/orders/addToCart", json={
            "userId": user_id,
            "productId": product_id,
            "quantity": quantity,
        })

    async def checkout(self, user_id: str) -> Order:
        return await self._request("POST", "/orders/checkout", json={
            "userId": user_id,
        })

    async def list_orders(self, user_id: str, limit: int | None = None, offset: int | None = None) -> dict:
        return await self._request("GET", "/orders/listOrders", params={
            "userId": user_id,
            "limit": limit,
            "offset": offset,
        })

    async def get_order(self, id: str) -> Order:
        return await self._request("GET", "/orders/getOrder", params={
            "id": id,
        })

