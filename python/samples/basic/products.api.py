from __future__ import annotations

from plat import Controller, GET, POST, RouteContext

from samples.basic.models import (
    CreateProductInput,
    CreateProductOutput,
    ListProductsInput,
    ListProductsOutput,
    Product,
)


_PRODUCTS = [
    Product(id="p1", name="Apple", price=1.25),
    Product(id="p2", name="Pear", price=1.5),
    Product(id="p3", name="Orange", price=1.75),
]


@Controller("products", {"tag": "Products"})
class ProductsApi:
    @GET()
    def listProducts(
        self,
        input: ListProductsInput,
        ctx: RouteContext,
    ) -> ListProductsOutput:
        items = _PRODUCTS
        if input.q:
            needle = input.q.lower()
            items = [item for item in items if needle in item.name.lower()]

        return ListProductsOutput(
            items=items[: input.limit],
            total=len(items),
            q=input.q,
        )

    @POST({"auth": "public"})
    def createProduct(
        self,
        input: CreateProductInput,
        ctx: RouteContext,
    ) -> CreateProductOutput:
        product = CreateProductOutput(
            id=f"p{len(_PRODUCTS) + 1}",
            name=input.name,
            price=input.price,
        )
        _PRODUCTS.append(Product.model_validate(product))
        return product
