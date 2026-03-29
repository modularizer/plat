import { ClientError, ServerError } from '../types/errors'
import type { HttpMethod } from '../types/http'
import type { ResponseFormat } from '../types/client'
import type {
  OpenAPIClientTransportOutcome,
  OpenAPIClientTransportPlugin,
  OpenAPIClientTransportRequest,
} from './transport-plugin'

interface HttpTransportRuntime {
  baseUrl: string
  timeoutMs: number
  fetchInit?: RequestInit
  fetchHttp(request: {
    method: HttpMethod
    url: string
    headers: Record<string, string | number | boolean | undefined>
    body?: BodyInit
    signal?: AbortSignal
    timeoutMs: number
    fetchInit?: RequestInit
  }): Promise<Response>
  parseJson(text: string): unknown
  parseResponse<T>(response: Response, format: ResponseFormat): Promise<T>
  detectResponseFormat(response: Response, specContentTypes: string[]): ResponseFormat
  createDeferredHandle<TResult>(id: string, options?: unknown): any
}

interface HttpConnection {
  response?: Response
}

export function createHttpTransportPlugin(runtime: HttpTransportRuntime): OpenAPIClientTransportPlugin<HttpConnection> {
  return {
    name: 'http',
    canHandle: ({ transportMode }) => transportMode === 'http',
    connect() {
      return {}
    },
    async sendRequest(connection: HttpConnection, request: OpenAPIClientTransportRequest): Promise<void> {
      const { method, headers } = request
      const url = request.url ?? `${runtime.baseUrl}${request.path}`
      connection.response = await runtime.fetchHttp({
        method: method as HttpMethod,
        url,
        headers,
        body: request.body,
        signal: request.signal,
        timeoutMs: request.timeoutMs ?? runtime.timeoutMs,
        fetchInit: runtime.fetchInit,
      })

    },
    async getResult(connection: HttpConnection, request: OpenAPIClientTransportRequest): Promise<OpenAPIClientTransportOutcome> {
      const response = connection.response!
      const url = request.url ?? `${runtime.baseUrl}${request.path}`
      if (response.ok) {
        if (request.execution === 'deferred' && response.status === 202) {
          const payload = await response.json() as { id: string }
          return { id: request.id, ok: true, result: runtime.createDeferredHandle(payload.id, request.options) }
        }
        return {
          id: request.id,
          ok: true,
          result: await runtime.parseResponse(
            response,
            request.responseFormat ?? runtime.detectResponseFormat(response, request.responseContentTypes ?? []),
          ),
        }
      }

      const bodyText = await response.text()
      const bodyJson = runtime.parseJson(bodyText)
      return {
        id: request.id,
        ok: false,
        error: response.status >= 400 && response.status < 500
          ? new ClientError({ url, method: request.method, status: response.status, statusText: response.statusText, headers: response.headers, bodyText, bodyJson })
          : new ServerError({ url, method: request.method, status: response.status, statusText: response.statusText, headers: response.headers, bodyText, bodyJson }),
      }
    },
  }
}
