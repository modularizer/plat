import { executeClientTransportPlugin, type OpenAPIClientTransportRequest } from '../client/transport-plugin'
import type { OpenAPIClientTransportPlugin } from '../client/transport-plugin'

export async function fetchClientSideServerOpenAPI(
  baseUrl: string,
  transportPlugin: OpenAPIClientTransportPlugin,
): Promise<Record<string, any>> {
  return await executeClientTransportPlugin(transportPlugin, {
    id: `openapi-${Math.random().toString(36).slice(2)}`,
    baseUrl,
    transportMode: 'css',
    method: 'GET',
    path: '/openapi.json',
    url: `${baseUrl}/openapi.json`,
    headers: {},
    params: {},
    requestContext: {
      method: 'GET',
      path: '/openapi.json',
      url: `${baseUrl}/openapi.json`,
      headers: {},
    },
  } satisfies OpenAPIClientTransportRequest) as Record<string, any>
}
