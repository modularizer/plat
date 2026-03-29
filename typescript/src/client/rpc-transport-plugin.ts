import { ClientError, ServerError } from '../types/errors'
import type { PLATRPCMessage, PLATRPCRequest, PLATRPCResponse } from '../rpc'
import type {
  OpenAPIClientTransportOutcome,
  OpenAPIClientTransportPlugin,
  OpenAPIClientTransportRequest,
} from './transport-plugin'

interface RpcTransportRuntime {
  nextRequestId(prefix: string): string
  stringifyHeaders(headers: Record<string, string | number | boolean | undefined>): Record<string, string>
  parseJson(text: string): unknown
  resolveRpcUrl(): string
  ensureRpcSocket(): Promise<WebSocket>
  sendRpcCancel(id: string): Promise<void>
}

interface RpcConnection {
  socket: WebSocket
  result?: PLATRPCResponse
}

export function createRpcTransportPlugin(runtime: RpcTransportRuntime): OpenAPIClientTransportPlugin<RpcConnection> {
  return {
    name: 'rpc',
    canHandle: ({ transportMode }) => transportMode === 'rpc',
    async connect() {
      return { socket: await runtime.ensureRpcSocket() }
    },
    async sendRequest(connection: RpcConnection, request: OpenAPIClientTransportRequest): Promise<void> {
      const rpcRequest: PLATRPCRequest = {
        jsonrpc: '2.0',
        id: runtime.nextRequestId('rpc'),
        operationId: request.operationId,
        method: request.method,
        path: request.path,
        headers: runtime.stringifyHeaders(request.headers),
        input: request.params,
      }
      connection.result = await new Promise<PLATRPCResponse>((resolve, reject) => {
        const abort = () => {
          void runtime.sendRpcCancel(rpcRequest.id)
          reject(new DOMException('RPC request was aborted', 'AbortError'))
        }
        if (request.signal?.aborted) {
          abort()
          return
        }
        const onMessage = async (event: Event) => {
          if (!(event instanceof MessageEvent)) return
          const payload = runtime.parseJson(String(event.data)) as PLATRPCMessage
          if (!payload || typeof payload !== 'object' || payload.id !== rpcRequest.id) return
          if ('event' in payload && payload.event) {
            await request.onEvent?.({ id: payload.id, event: payload.event, data: payload.data })
            return
          }
          connection.socket.removeEventListener('message', onMessage)
          request.signal?.removeEventListener('abort', abort)
          resolve(payload as PLATRPCResponse)
        }
        connection.socket.addEventListener('message', onMessage)
        request.signal?.addEventListener('abort', abort, { once: true })
        connection.socket.send(JSON.stringify(rpcRequest))
      })
    },
    async getResult(connection: RpcConnection, request: OpenAPIClientTransportRequest): Promise<OpenAPIClientTransportOutcome> {
      const response = connection.result!
      if (response.ok) return { id: request.id, ok: true, result: response.result }
      const status = response.error.status ?? 500
      const common = {
        url: runtime.resolveRpcUrl(),
        method: request.method,
        status,
        statusText: response.error.message,
        headers: new Headers(),
        bodyText: JSON.stringify(response.error.data ?? response.error.message),
        bodyJson: response.error.data ?? response.error.message,
      }
      return {
        id: request.id,
        ok: false,
        error: status >= 400 && status < 500 ? new ClientError(common) : new ServerError(common),
      }
    },
  }
}
