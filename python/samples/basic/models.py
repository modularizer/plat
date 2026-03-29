from __future__ import annotations

from pydantic import BaseModel, Field


class Product(BaseModel):
    id: str
    name: str
    price: float


class ListProductsInput(BaseModel):
    q: str | None = None
    limit: int = Field(default=10, ge=1, le=100)


class ListProductsOutput(BaseModel):
    items: list[Product]
    total: int
    q: str | None = None


class CreateProductInput(BaseModel):
    name: str
    price: float = Field(ge=0)


class CreateProductOutput(Product):
    pass


class ListOrdersInput(BaseModel):
    limit: int = Field(default=10, ge=1, le=100)


class Order(BaseModel):
    id: str
    product_id: str
    quantity: int = Field(ge=1)


class ListOrdersOutput(BaseModel):
    items: list[Order]
    total: int
