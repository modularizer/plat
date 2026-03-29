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

import type { EchoInput, Message, SayHelloInput } from "../shared/types";

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

  async sayHello(
    input: SayHelloInput,
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<any> {
    return this.client.get("/sayHello", input, {
      headers,
      timeoutMs,
      retry,
      signal,
    });
  }

  async echo(
    input: EchoInput,
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<Message> {
    return this.client.post("/echo", input, {
      headers,
      timeoutMs,
      retry,
      signal,
    });
  }

  async getStatus(
    input: {},
    { headers, timeoutMs, retry, signal }: ClientCallOptions = {},
  ): Promise<any> {
    return this.client.get("/getStatus", input, {
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
