import type { RouteContext } from '../types'
import { HttpError } from '../types'
import {
  createClientSideServerMQTTWebRTCServer,
  type ClientSideServerMQTTWebRTCOptions,
  type ClientSideServerMQTTWebRTCServer,
  type ClientSideServerRequestHandler,
  type ClientSideServerWorkerInfo,
} from '../client-side-server/mqtt-webrtc'
import type { ClientSideServerChannel } from '../client-side-server/channel'
import {
  isClientSideServerRequestMessage,
  type ClientSideServerInstanceInfo,
  type ClientSideServerRequest,
} from '../client-side-server/protocol'
import type {
  PLATServerHostContext,
  PLATServerProtocolPlugin,
  PLATServerTransportRuntime,
} from './protocol-plugin'

export interface PLATServerWebRTCOptions extends ClientSideServerMQTTWebRTCOptions {
  /** css:// name this server is reachable at (e.g. "dmz/my-api" or "authority.com/my-api"). */
  name: string
  /** Optional load-balancing/worker metadata surfaced on MQTT announcements. */
  workerInfo?: ClientSideServerWorkerInfo
  /**
   * Optional overrides/additions to the ClientSideServerInstanceInfo
   * (version / openapiHash / etc.) published over MQTT.
   */
  instanceInfo?: ClientSideServerInstanceInfo
}

export interface ServerInfoProvider {
  getOpenAPISpec(): Record<string, any> | undefined
  getToolsList(): unknown[]
  getServerStartedAt(): number
}

export function createWebRTCProtocolPlugin(
  options: PLATServerWebRTCOptions,
  info: ServerInfoProvider,
): PLATServerProtocolPlugin {
  let runtime: PLATServerTransportRuntime | undefined
  let signaler: ClientSideServerMQTTWebRTCServer | undefined
  let openapiHashCache: string | undefined
  let openapiHashKey: string | undefined

  const computeOpenapiHash = async (): Promise<string | undefined> => {
    const spec = info.getOpenAPISpec()
    if (!spec) return undefined
    const text = stableStringify(spec)
    if (openapiHashKey === text && openapiHashCache) return openapiHashCache
    try {
      const subtle = (globalThis as any).crypto?.subtle
      if (!subtle) return undefined
      const digest: ArrayBuffer = await subtle.digest('SHA-256', new TextEncoder().encode(text))
      openapiHashCache = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      openapiHashKey = text
      return openapiHashCache
    } catch {
      return undefined
    }
  }

  const handler: ClientSideServerRequestHandler = {
    async getServerInfo() {
      return {
        ...options.instanceInfo,
        openapiHash: options.instanceInfo?.openapiHash ?? await computeOpenapiHash(),
        serverStartedAt: options.instanceInfo?.serverStartedAt ?? info.getServerStartedAt(),
      }
    },
    serveChannel(channel: ClientSideServerChannel): () => void {
      return channel.subscribe(async (message) => {
        if (!isClientSideServerRequestMessage(message) || message.cancel) return
        if (!runtime) return
        await handleRequest(message, channel, runtime, info, computeOpenapiHash)
      })
    },
  }

  const plugin: PLATServerProtocolPlugin = {
    name: 'webrtc',
    setup(rt) {
      runtime = rt
    },
    async start(_rt: PLATServerTransportRuntime) {
      const { name, workerInfo, instanceInfo, ...transport } = options
      signaler = createClientSideServerMQTTWebRTCServer({
        ...transport,
        serverName: name,
        server: handler,
        workerInfo,
        instanceInfo,
      })
      await signaler.start()
    },
    async teardown(_rt) {
      if (!signaler) return
      const s = signaler
      signaler = undefined
      await s.stop()
    },
  }
  return plugin
}

async function handleRequest(
  message: ClientSideServerRequest,
  channel: ClientSideServerChannel,
  runtime: PLATServerTransportRuntime,
  info: ServerInfoProvider,
  computeOpenapiHash: () => Promise<string | undefined>,
): Promise<void> {
  const method = (message.method || 'GET').toUpperCase()

  if (method === 'GET' && message.path === '/openapi.json') {
    const spec = info.getOpenAPISpec()
    await channel.send({
      jsonrpc: '2.0',
      id: message.id,
      ok: true,
      result: spec ?? {},
    })
    return
  }

  if (method === 'GET' && message.path === '/tools') {
    await channel.send({
      jsonrpc: '2.0',
      id: message.id,
      ok: true,
      result: info.getToolsList(),
    })
    return
  }

  if (method === 'GET' && message.path === '/server-info') {
    await channel.send({
      jsonrpc: '2.0',
      id: message.id,
      ok: true,
      result: {
        openapiHash: await computeOpenapiHash(),
        serverStartedAt: info.getServerStartedAt(),
      },
    })
    return
  }

  const operation = runtime.resolveOperation({
    operationId: message.operationId,
    method: message.method,
    path: message.path,
  })
  if (!operation) {
    await channel.send({
      jsonrpc: '2.0',
      id: message.id,
      ok: false,
      error: {
        status: 404,
        message: `WebRTC operation not found for ${message.method} ${message.path}`,
      },
    })
    return
  }

  const abortController = new AbortController()
  try {
    const normalizedInput = runtime.normalizeInput(
      typeof message.input === 'object' && message.input !== null
        ? (message.input as Record<string, any>)
        : {},
    )
    const ctx: RouteContext = {
      method: operation.method,
      url: operation.path,
      headers: message.headers ?? {},
      opts: operation.routeMeta?.opts,
    }
    runtime.createCallContext({
      ctx,
      sessionId: message.id,
      mode: 'rpc',
      signal: abortController.signal,
      emit: async (event, data) => {
        await channel.send({
          jsonrpc: '2.0',
          id: message.id,
          ok: true,
          event,
          data: runtime.serializeValue(data),
        })
      },
    })
    const envelope = runtime.createEnvelope({
      protocol: 'webrtc',
      operation,
      input: normalizedInput,
      headers: message.headers ?? {},
      ctx,
      requestId: message.id,
      req: { headers: message.headers ?? {} },
      allowHelp: false,
      helpRequested: false,
    })
    const execution = await runtime.dispatch(operation, envelope)
    await channel.send({
      jsonrpc: '2.0',
      id: message.id,
      ok: true,
      result: runtime.serializeValue(execution.result),
    })
  } catch (error: any) {
    const status = error instanceof HttpError ? error.statusCode : 500
    await channel.send({
      jsonrpc: '2.0',
      id: message.id,
      ok: false,
      error: {
        status,
        message: error?.message ?? 'Internal server error',
        data: error instanceof HttpError ? error.data : undefined,
      },
    })
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort().map((key) => [
        key,
        sortValue((value as Record<string, unknown>)[key]),
      ]),
    )
  }
  return value
}
