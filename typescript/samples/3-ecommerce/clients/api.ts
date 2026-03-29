/**
 * plat API Client (TypeScript)
 *
 * Auto-generated from openapi.json — DO NOT EDIT
 * Regenerate with: npx tsx scripts/gen-client-openapi.ts
 */

// ── Data Models ──────────────────────────────────────────

export interface Product {
  id: number
  name: string
  description: string
  price: number
  category: string
  inStock: boolean
  quantity: number
}

export interface CartItem {
  productId: number
  quantity: number
  priceAtAdded: number
}

export interface Cart {
  userId: string
  items: CartItem[]
  subtotal: number
}

export interface Order {
  id: string
  userId: string
  items: CartItem[]
  total: number
  status: 'pending' | 'processing' | 'shipped' | 'delivered'
  createdAt: string
}

// ── Client ──────────────────────────────────────────────

export interface ApiClientOptions {
  baseUrl?: string
  headers?: Record<string, string>
  timeout?: number
}

export class ApiClient {
  private baseUrl: string
  private headers: Record<string, string>
  private timeout: number

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '')
    this.headers = { 'Content-Type': 'application/json', ...options.headers }
    this.timeout = options.timeout ?? 30000
  }

  private async request<T>(method: string, path: string, opts?: {
    params?: Record<string, unknown>
    body?: unknown
    headers?: Record<string, string>
  }): Promise<T> {
    let url = this.baseUrl + path
    if (opts?.params) {
      const qs = Object.entries(opts.params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
      if (qs) url += '?' + qs
    }
    const res = await fetch(url, {
      method,
      headers: { ...this.headers, ...opts?.headers },
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${method} ${path} failed (${res.status}): ${text}`)
    }
    return res.json() as Promise<T>
  }

  async listProducts(input?: { category?: string; inStock?: boolean; limit?: number; offset?: number }): Promise<{ products?: Product[]; total?: number }> {
    return this.request('GET', '/products/listProducts', { params: input as Record<string, unknown> })
  }

  async getProduct(input: { id: number }): Promise<Product> {
    return this.request('GET', '/products/getProduct', { params: input as Record<string, unknown> })
  }

  async searchProducts(input: { q: string; limit?: number }): Promise<{ products?: Product[]; total?: number }> {
    return this.request('GET', '/products/searchProducts', { params: input as Record<string, unknown> })
  }

  async getCart(input: { userId: string }): Promise<Cart> {
    return this.request('GET', '/orders/getCart', { params: input as Record<string, unknown> })
  }

  async addToCart(input: { userId: string; productId: number; quantity: number }): Promise<{ success?: boolean }> {
    return this.request('POST', '/orders/addToCart', { body: input })
  }

  async checkout(input: { userId: string }): Promise<Order> {
    return this.request('POST', '/orders/checkout', { body: input })
  }

  async listOrders(input: { userId: string; limit?: number; offset?: number }): Promise<{ orders?: Order[]; total?: number }> {
    return this.request('GET', '/orders/listOrders', { params: input as Record<string, unknown> })
  }

  async getOrder(input: { id: string }): Promise<Order> {
    return this.request('GET', '/orders/getOrder', { params: input as Record<string, unknown> })
  }

}

export function createApiClient(options?: ApiClientOptions): ApiClient {
  return new ApiClient(options)
}
