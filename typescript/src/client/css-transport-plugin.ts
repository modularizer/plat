import { ClientError, ServerError } from '../types/errors'
import type { PLATRPCMessage, PLATRPCRequest, PLATRPCResponse } from '../rpc'
import {
  parseClientSideServerAddress,
  type ClientSideServerAddress,
} from '../client-side-server/signaling'
import type { ClientSideServerChannel } from '../client-side-server/channel'
import type {
  OpenAPIClientTransportOutcome,
  OpenAPIClientTransportPlugin,
  OpenAPIClientTransportRequest,
} from './transport-plugin'

export interface ClientSideServerConnectContext {
  address: ClientSideServerAddress
  request: OpenAPIClientTransportRequest
}

export interface ClientSideServerTransportPluginOptions {
  connect(context: ClientSideServerConnectContext): Promise<ClientSideServerChannel> | ClientSideServerChannel
}

interface CSSConnection {
  channel: ClientSideServerChannel
  unsubscribe?: () => void
  result?: PLATRPCResponse
}

export function createClientSideServerTransportPlugin(
  options: ClientSideServerTransportPluginOptions,
): OpenAPIClientTransportPlugin<CSSConnection> {
  return {
    name: 'css',
    canHandle: ({ baseUrl, transportMode }) => transportMode === 'css' || baseUrl.startsWith('css://'),
    async connect(request) {
      const address = parseClientSideServerAddress(request.baseUrl)
      const channel = await options.connect({ address, request })
      return { channel }
    },
    async sendRequest(connection, request) {
      const rpcRequest: PLATRPCRequest = {
        jsonrpc: '2.0',
        id: request.id,
        operationId: request.operationId,
        method: request.method,
        path: request.path,
        headers: stringifyHeaders(request.headers),
        input: request.params,
      }

      connection.result = await new Promise<PLATRPCResponse>((resolve, reject) => {
        const abort = () => reject(new DOMException('Client-side server request was aborted', 'AbortError'))
        if (request.signal?.aborted) {
          abort()
          return
        }

        connection.unsubscribe = connection.channel.subscribe(async (payload) => {
          const message = payload as PLATRPCMessage
          if (!message || typeof message !== 'object' || message.id !== rpcRequest.id) return
          if ('event' in message && message.event) {
            await request.onEvent?.({ id: message.id, event: message.event, data: message.data })
            return
          }
          connection.unsubscribe?.()
          request.signal?.removeEventListener('abort', abort)
          resolve(message as PLATRPCResponse)
        })

        request.signal?.addEventListener('abort', abort, { once: true })
        void connection.channel.send(rpcRequest)
      })
    },
    async getResult(connection, request): Promise<OpenAPIClientTransportOutcome> {
      const response = connection.result!
      if (response.ok) return { id: request.id, ok: true, result: response.result }
      const status = response.error.status ?? 500
      const common = {
        url: request.baseUrl,
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
    async disconnect(connection) {
      connection.unsubscribe?.()
      await connection.channel.close?.()
    },
  }
}

function stringifyHeaders(
  headers: Record<string, string | number | boolean | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) result[key] = String(value)
  }
  return result
}
