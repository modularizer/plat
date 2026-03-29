import type { Server as HttpServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { DEFAULT_RPC_PATH, type PLATRPCRequest } from '../rpc'
import { HttpError, type RouteContext } from '../types'
import type { PLATServerHostContext, PLATServerProtocolPlugin, PLATServerTransportRuntime } from './protocol-plugin'

export interface RpcProtocolPluginOptions {
  /** true, false, or a custom path like '/ws' */
  enabled: boolean | string
}

interface RpcProtocolPluginInternal extends PLATServerProtocolPlugin {
  /** Set by setup(), used by attachRpcProtocolPlugin */
  _runtime?: PLATServerTransportRuntime
}

export function createRpcProtocolPlugin(options: RpcProtocolPluginOptions): PLATServerProtocolPlugin {
  const plugin: RpcProtocolPluginInternal = {
    name: 'rpc',
    setup(rt: PLATServerTransportRuntime) {
      plugin._runtime = rt
    },
    attach(rt: PLATServerTransportRuntime, host: PLATServerHostContext) {
      attachRpcProtocolPlugin(plugin, options, host)
    },
    teardown() {
      plugin._runtime = undefined
    },
  }
  return plugin
}

/**
 * Attach the RPC WebSocket server to an existing HTTP server.
 * Must be called after plugin.setup(runtime) and before server.listen().
 */
export function attachRpcProtocolPlugin(
  plugin: PLATServerProtocolPlugin,
  options: RpcProtocolPluginOptions,
  host: PLATServerHostContext,
): void {
  if (options.enabled === false || plugin.name !== 'rpc') return

  const rt = (plugin as RpcProtocolPluginInternal)._runtime
  if (!rt) return
  if (host.kind !== 'node-http' || !host.server) return

  const rpcPath = typeof options.enabled === 'string' ? options.enabled : DEFAULT_RPC_PATH
  const serialize = (v: unknown) => rt.serializeValue(v)
  const activeRpcCalls = new Map<string, AbortController>()

  const server = host.server as HttpServer
  const wss = new WebSocketServer({ server, path: rpcPath })

  // Store for teardown
  const originalTeardown = plugin.teardown
  plugin.teardown = async (runtime) => {
    for (const ac of activeRpcCalls.values()) ac.abort()
    activeRpcCalls.clear()
    wss.close()
    await originalTeardown?.(runtime)
  }

  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', async (message: Parameters<WebSocket['send']>[0]) => {
      const raw = typeof message === 'string' ? message : message.toString()

      let request: PLATRPCRequest
      try {
        request = JSON.parse(raw) as PLATRPCRequest
      } catch {
        socket.send(JSON.stringify({
          jsonrpc: '2.0', id: 'invalid', ok: false,
          error: { status: 400, message: 'Invalid RPC payload' },
        }))
        return
      }

      if (request.cancel) {
        activeRpcCalls.get(request.id)?.abort()
        socket.send(JSON.stringify({
          jsonrpc: '2.0', id: request.id, ok: true, result: { cancelled: true },
        }))
        return
      }

      const operation = rt.resolveOperation({
        operationId: request.operationId,
        method: request.method,
        path: request.path,
      })

      if (!operation) {
        socket.send(JSON.stringify({
          jsonrpc: '2.0', id: request.id, ok: false,
          error: { status: 404, message: `RPC operation not found for ${request.method} ${request.path}` },
        }))
        return
      }

      const abortController = new AbortController()
      activeRpcCalls.set(request.id, abortController)

      try {
        const normalizedInput = rt.normalizeInput(
          typeof request.input === 'object' && request.input !== null ? request.input as Record<string, any> : {},
        )

        const ctx: RouteContext = {
          method: operation.method,
          url: operation.path,
          headers: request.headers ?? {},
          opts: operation.routeMeta?.opts,
        }

        rt.createCallContext({
          ctx,
          sessionId: request.id,
          mode: 'rpc',
          signal: abortController.signal,
          emit: async (event: 'progress' | 'log' | 'chunk' | 'message', data?: unknown) => {
            socket.send(JSON.stringify({
              jsonrpc: '2.0', id: request.id, ok: true, event,
              data: serialize(data),
            }))
          },
        })

        const envelope = rt.createEnvelope({
          protocol: 'rpc',
          operation,
          input: normalizedInput,
          headers: request.headers ?? {},
          ctx,
          requestId: request.id,
          req: { headers: request.headers ?? {} },
          allowHelp: false,
          helpRequested: false,
        })

        const execution = await rt.dispatch(operation, envelope)
        socket.send(JSON.stringify({
          jsonrpc: '2.0', id: request.id, ok: true,
          result: serialize(execution.result),
        }))
      } catch (error: any) {
        const status = error instanceof HttpError ? error.statusCode : 500
        socket.send(JSON.stringify({
          jsonrpc: '2.0', id: request.id, ok: false,
          error: {
            status,
            message: error?.message ?? 'Internal server error',
            data: error instanceof HttpError ? error.data : undefined,
          },
        }))
      } finally {
        activeRpcCalls.delete(request.id)
      }
    })
  })
}
