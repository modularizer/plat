from __future__ import annotations

from plat import Controller, GET, RouteContext

from samples.basic.models import ListOrdersInput, ListOrdersOutput, Order


_ORDERS = [
    Order(id="o1", product_id="p1", quantity=2),
    Order(id="o2", product_id="p2", quantity=1),
]


@Controller("orders", {"tag": "Orders"})
class OrdersApi:
    @GET()
    def listOrders(
        self,
        input: ListOrdersInput,
        ctx: RouteContext,
    ) -> ListOrdersOutput:
        return ListOrdersOutput(
            items=_ORDERS[: input.limit],
            total=len(_ORDERS),
        )
