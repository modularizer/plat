import { Controller, GET, POST } from 'plat'
import type { RouteContext } from 'plat'
import type { CartItem, Cart, Order, AddToCartInput, ListOrdersInput, ListOrdersOutput } from '../shared/types'

const carts: Map<string, CartItem[]> = new Map()
const orders: Map<string, Order> = new Map()
let orderIdCounter = 1000

const productPrices: Map<number, number> = new Map([
  [1, 1299.99], [2, 29.99], [3, 149.99], [4, 399.99],
])

@Controller()
export class OrdersApi {
  @GET()
  async getCart(input: { userId: string }, ctx: RouteContext): Promise<Cart> {
    const items = carts.get(input.userId) || []
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.priceAtAdded, 0)
    return { userId: input.userId, items, subtotal }
  }

  @POST()
  async addToCart(input: AddToCartInput, ctx: RouteContext) {
    const price = productPrices.get(input.productId)
    if (!price) throw new Error(`Product ${input.productId} not found`)

    const cart = carts.get(input.userId) || []
    const existing = cart.find(item => item.productId === input.productId)

    if (existing) {
      existing.quantity += input.quantity
    } else {
      cart.push({ productId: input.productId, quantity: input.quantity, priceAtAdded: price })
    }

    carts.set(input.userId, cart)
    return { success: true }
  }

  @POST()
  async checkout(input: { userId: string }, ctx: RouteContext): Promise<Order> {
    const items = carts.get(input.userId)
    if (!items || items.length === 0) throw new Error('Cart is empty')

    const total = items.reduce((sum, item) => sum + item.quantity * item.priceAtAdded, 0)
    const orderId = `ORD-${orderIdCounter++}`

    const order: Order = {
      id: orderId,
      userId: input.userId,
      items,
      total,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }

    orders.set(orderId, order)
    carts.delete(input.userId)
    return order
  }

  @GET()
  async listOrders(input: ListOrdersInput = {}, ctx: RouteContext): Promise<ListOrdersOutput> {
    const { userId, status, limit = 10, offset = 0 } = input
    let filtered = Array.from(orders.values())

    if (userId) filtered = filtered.filter(o => o.userId === userId)
    if (status) filtered = filtered.filter(o => o.status === status)

    return {
      orders: filtered.slice(offset, offset + limit),
      total: filtered.length,
    }
  }

  @GET()
  async getOrder(input: { id: string }, ctx: RouteContext): Promise<Order> {
    const order = orders.get(input.id)
    if (!order) throw new Error(`Order ${input.id} not found`)
    return order
  }
}
