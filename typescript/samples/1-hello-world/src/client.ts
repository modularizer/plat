/**
 * Auto-generated OpenAPI client bootstrap.
 * Source: /home/mod/Code/plat/typescript/samples/1-hello-world/openapi.json
 * DO NOT EDIT MANUALLY.
 */

import { OpenAPIClient, type OpenAPIClientConfig } from 'plat'
import type { OpenAPISpec } from 'plat'

export const openAPISpec = {
  "openapi": "3.0.0",
  "info": {
    "title": "API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "http://localhost:3000"
    }
  ],
  "paths": {}
} as const satisfies OpenAPISpec

export type ApiSpec = typeof openAPISpec
export type ApiClient = OpenAPIClient<ApiSpec>

export const defaultBaseUrl = "http://localhost:3000"

export function createClient(
  baseUrl: string = defaultBaseUrl,
  config?: OpenAPIClientConfig,
): ApiClient {
  return new OpenAPIClient<ApiSpec>(openAPISpec, { ...config, baseUrl })
}

export default createClient
