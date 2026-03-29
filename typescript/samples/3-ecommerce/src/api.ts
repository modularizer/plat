/**
 * GENERATED: plat API Client
 *
 * Single flat client with all methods at the top level.
 * Method names are routes: api.getOrder() → GET /getOrder
 *
 * Usage:
 * const api = new ApiClient('http://localhost:3000')
 * await api.getOrder({ id: '123' })
 * await api.listOrders()
 * await api.createOrder({ items: [...] })
 *
 * @generated npm run gen
 * ⚠️  DO NOT EDIT - Regenerate with: npm run gen
 */

import {
  OpenAPIClient,
  type OpenAPIClientConfig,
  type ClientCallOptions,
  type Out,
} from "plat";
import openAPISpec from "../generated/openapi.json";

import type {
  AddToCartInput,
  Cart,
  ListOrdersInput,
  ListOrdersOutput,
  ListProductsInput,
  ListProductsOutput,
  Order,
  Product,
} from "../shared/types";

/**
 * plat API Client - Completely Flat
 *
 * All methods from all controllers are available at the top level.
 * No namespacing, no nesting. Just call the method directly:
 *
 * @example
 * const api = new ApiClient('http://localhost:3000')
 * await api.getOrder({ id: '123' })
 * await api.createOrder({ items: [...] })
 * await api.listProducts()
 */
export class ApiClient {
  private client: OpenAPIClient;

  constructor(baseUrl: string, config?: OpenAPIClientConfig) {
    this.client = new OpenAPIClient(openAPISpec, { ...config, baseUrl });
  }

  async getCart(
    input: { userId: string },
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<Cart> {
    return this.client.get("/getCart", input, {
      headers,
      timeoutMs,
      retry,
      signal,
    });
  }

  async addToCart(
    input: AddToCartInput,
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<any> {
    return this.client.post("/addToCart", input, {
      headers,
      timeoutMs,
      retry,
      signal,
    });
  }

  async checkout(
    input: { userId: string },
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<Order> {
    return this.client.post("/checkout", input, {
      headers,
      timeoutMs,
      retry,
      signal,
    });
  }

  async listOrders(
    input: ListOrdersInput,
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<ListOrdersOutput> {
    return this.client.get("/listOrders", input, {
      headers,
      timeoutMs,
      retry,
      signal,
    });
  }

  async getOrder(
    input: { id: string },
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<Order> {
    return this.client.get("/getOrder", input, {
      headers,
      timeoutMs,
      retry,
      signal,
    });
  }

  async listProducts(
    input: ListProductsInput,
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<ListProductsOutput> {
    return this.client.get("/listProducts", input, {
      headers,
      timeoutMs,
      retry,
      signal,
    });
  }

  async getProduct(
    input: { id: number },
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<Product> {
    return this.client.get("/getProduct", input, {
      headers,
      timeoutMs,
      retry,
      signal,
    });
  }

  async searchProducts(
    input: { q: string; limit?: number },
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<any> {
    return this.client.get("/searchProducts", input, {
      headers,
      timeoutMs,
      retry,
      signal,
    });
  }
}

export function createApiClient(
  baseUrl: string,
  config?: OpenAPIClientConfig,
): ApiClient {
  return new ApiClient(baseUrl, config);
}
