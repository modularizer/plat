import { Controller, GET } from 'plat'
import type { RouteContext } from 'plat'
import type { Product, ListProductsInput, ListProductsOutput } from '../shared/types'

const products: Map<number, Product> = new Map([
  [1, { id: 1, name: 'Laptop', description: 'High-performance laptop', price: 1299.99, category: 'Electronics', inStock: true, quantity: 5 }],
  [2, { id: 2, name: 'Mouse', description: 'Wireless mouse', price: 29.99, category: 'Accessories', inStock: true, quantity: 50 }],
  [3, { id: 3, name: 'Keyboard', description: 'Mechanical keyboard', price: 149.99, category: 'Accessories', inStock: true, quantity: 20 }],
  [4, { id: 4, name: 'Monitor', description: '4K monitor', price: 399.99, category: 'Electronics', inStock: false, quantity: 0 }],
])

@Controller()
export class ProductsApi {
  @GET()
  async listProducts(input: ListProductsInput = {}, ctx: RouteContext): Promise<ListProductsOutput> {
    const { category, inStock, limit = 10, offset = 0 } = input
    let filtered = Array.from(products.values())

    if (category) filtered = filtered.filter(p => p.category === category)
    if (inStock !== undefined) filtered = filtered.filter(p => p.inStock === inStock)

    return {
      products: filtered.slice(offset, offset + limit),
      total: filtered.length,
    }
  }

  @GET()
  async getProduct(input: { id: number }, ctx: RouteContext): Promise<Product> {
    const product = products.get(input.id)
    if (!product) throw new Error(`Product ${input.id} not found`)
    return product
  }

  @GET()
  async searchProducts(input: { q: string; limit?: number }, ctx: RouteContext) {
    const { q, limit = 10 } = input
    const query = q.toLowerCase()
    const results = Array.from(products.values())
      .filter(p => p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query))
      .slice(0, limit)
    return { products: results, total: results.length }
  }
}
