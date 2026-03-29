// ── Products ──────────────────────────────────────────────

export interface Product {
  id: number         // min: 1
  name: string       // min: 1, max: 200
  description: string // max: 2000
  price: number      // min: 0
  category: string
  inStock: boolean
  quantity: number   // integer, min: 0
}

export interface ListProductsInput {
  category?: string
  inStock?: boolean
  limit?: number     // integer, min: 1, max: 100, default: 10
  offset?: number    // integer, min: 0, default: 0
}

export interface ListProductsOutput {
  products: Product[]
  total: number      // integer
}

// ── Cart ──────────────────────────────────────────────────

export interface CartItem {
  productId: number  // min: 1
  quantity: number   // integer, min: 1
  priceAtAdded: number // min: 0
}

export interface Cart {
  userId: string
  items: CartItem[]
  subtotal: number   // min: 0
}

export interface AddToCartInput {
  userId: string     // min: 1
  productId: number  // min: 1
  quantity: number   // integer, min: 1
}

// ── Orders ────────────────────────────────────────────────

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered'

export interface Order {
  id: string
  userId: string
  items: CartItem[]
  total: number      // min: 0
  status: OrderStatus
  createdAt: string  // format: date-time
}

export interface ListOrdersInput {
  userId?: string
  status?: OrderStatus
  limit?: number     // integer, min: 1, max: 100, default: 10
  offset?: number    // integer, min: 0, default: 0
}

export interface ListOrdersOutput {
  orders: Order[]
  total: number      // integer
}
