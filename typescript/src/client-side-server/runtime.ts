import { OpenAPIClient } from '../client/openapi-client'
import type { OpenAPISpec } from '../types/openapi'
import { ensureRouteMeta } from '../spec/metadata'
import {
  createClientSideServerMQTTWebRTCServer,
  createClientSideServerMQTTWebRTCTransportPlugin,
  type ClientSideServerMQTTWebRTCOptions,
  type ClientSideServerMQTTWebRTCServer,
} from './mqtt-webrtc'
import { createClientSideServer, type PLATClientSideServer } from './server'
import { fetchClientSideServerOpenAPI } from './bootstrap'
import type { ClientSideServerSourceAnalysis } from './source-analysis'

type ControllerClass = new () => any

export interface ClientSideServerDefinition {
  serverName: string
  controllers: ControllerClass[]
}

export interface ClientSideServerSourceModule {
  controllers?: ControllerClass[]
  clientSideServer?: ClientSideServerDefinition
  default?: ControllerClass[] | ClientSideServerDefinition | { controllers?: ControllerClass[] }
}

export interface StartClientSideServerFromSourceOptions extends ClientSideServerMQTTWebRTCOptions {
  serverName?: string
  undecoratedMode?: 'GET' | 'POST' | 'private'
  source: string
  transpile?: (source: string) => string | Promise<string>
  analyzeSource?: (source: string) => ClientSideServerSourceAnalysis | Promise<ClientSideServerSourceAnalysis>
  onRequest?: (direction: 'request' | 'response', payload: unknown) => void
}

export interface StartedClientSideServer {
  server: PLATClientSideServer
  signaler: ClientSideServerMQTTWebRTCServer
  connectionUrl: string
  openapi: Record<string, any>
  stop(): Promise<void>
}

export async function startClientSideServerFromSource(
  options: StartClientSideServerFromSourceOptions,
): Promise<StartedClientSideServer> {
  const compiled = options.transpile
    ? await options.transpile(options.source)
    : options.source

  const moduleUrl = URL.createObjectURL(new Blob([compiled], { type: 'text/javascript' }))
  let loaded: ClientSideServerSourceModule

  try {
    loaded = await import(/* @vite-ignore */ moduleUrl) as ClientSideServerSourceModule
  } finally {
    URL.revokeObjectURL(moduleUrl)
  }

  const definition = resolveClientSideServerDefinition(loaded, options.serverName)
  const analysis = options.analyzeSource ? await options.analyzeSource(options.source) : undefined
  if (analysis) {
    applySourceAnalysisToControllers(definition.controllers, analysis)
  }
  const server = createClientSideServer({
    undecoratedMode: options.undecoratedMode,
  }, ...definition.controllers)

  if (options.onRequest) {
    const originalHandle = server.handleMessage.bind(server)
    server.handleMessage = async (message, channel) => {
      options.onRequest?.('request', message)
      await originalHandle(message, {
        ...channel,
        send: async (payload) => {
          options.onRequest?.('response', payload)
          await channel.send(payload)
        },
      })
    }
  }

  const signaler = createClientSideServerMQTTWebRTCServer({
    server,
    serverName: definition.serverName,
    mqttBroker: options.mqttBroker,
    mqttTopic: options.mqttTopic,
    mqttOptions: options.mqttOptions,
    iceServers: options.iceServers,
    connectionTimeoutMs: options.connectionTimeoutMs,
    announceIntervalMs: options.announceIntervalMs,
    clientIdPrefix: options.clientIdPrefix,
  })

  await signaler.start()

  return {
    server,
    signaler,
    connectionUrl: signaler.connectionUrl,
    openapi: server.openapi,
    stop: async () => {
      await signaler.stop()
    },
  }
}

export function serveClientSideServer(
  serverName: string,
  controllers: ControllerClass[],
): ClientSideServerDefinition {
  return { serverName, controllers }
}

export interface ConnectClientSideServerOptions extends ClientSideServerMQTTWebRTCOptions {
  baseUrl: string
}

export async function connectClientSideServer(
  options: ConnectClientSideServerOptions,
): Promise<{
  client: OpenAPIClient
  openapi: OpenAPISpec
}> {
  const transportPlugin = createClientSideServerMQTTWebRTCTransportPlugin(options)
  const openapi = await fetchClientSideServerOpenAPI(options.baseUrl, transportPlugin) as OpenAPISpec
  const client = new OpenAPIClient(openapi, {
    baseUrl: options.baseUrl,
    transportPlugins: [transportPlugin],
  })
  return { client, openapi }
}

export interface RetryLoopOptions {
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  runImmediately?: boolean
  resetDelayOnSuccess?: boolean
  onError?: (error: unknown, nextDelayMs: number) => void
  onSuccess?: () => void
}

export interface RetryLoopHandle {
  stop(): void
  triggerNow(): void
}

export function startRetryLoop(
  task: () => Promise<void> | void,
  options: RetryLoopOptions = {},
): RetryLoopHandle {
  const initialDelayMs = options.initialDelayMs ?? 2_000
  const maxDelayMs = options.maxDelayMs ?? 30_000
  const backoffMultiplier = options.backoffMultiplier ?? 1.8
  const resetDelayOnSuccess = options.resetDelayOnSuccess ?? true
  let nextDelayMs = initialDelayMs
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let running = false

  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (delayMs: number) => {
    if (stopped) return
    clear()
    timer = setTimeout(() => {
      void run()
    }, delayMs)
  }

  const run = async () => {
    if (stopped || running) return
    running = true
    try {
      await task()
      options.onSuccess?.()
      if (resetDelayOnSuccess) {
        nextDelayMs = initialDelayMs
      }
      schedule(initialDelayMs)
    } catch (error) {
      options.onError?.(error, nextDelayMs)
      schedule(nextDelayMs)
      nextDelayMs = Math.min(maxDelayMs, Math.ceil(nextDelayMs * backoffMultiplier))
    } finally {
      running = false
    }
  }

  if (options.runImmediately ?? true) {
    void run()
  } else {
    schedule(initialDelayMs)
  }

  return {
    stop() {
      stopped = true
      clear()
    },
    triggerNow() {
      if (stopped) return
      clear()
      void run()
    },
  }
}

function resolveClientSideServerDefinition(
  module: ClientSideServerSourceModule,
  fallbackServerName?: string,
): ClientSideServerDefinition {
  if (module.clientSideServer) return module.clientSideServer

  if (module.default && isClientSideServerDefinition(module.default)) {
    return module.default
  }

  const controllers = resolveControllers(module)
  if (fallbackServerName) {
    return { serverName: fallbackServerName, controllers }
  }

  throw new Error('Expected the source module to define a server name with serveClientSideServer(name, controllers)')
}

function resolveControllers(module: ClientSideServerSourceModule): ControllerClass[] {
  if (Array.isArray(module.controllers)) return module.controllers
  if (Array.isArray(module.default)) return module.default
  if (module.default && 'controllers' in module.default && Array.isArray(module.default.controllers)) {
    return module.default.controllers
  }
  throw new Error('Expected the source module to export controllers or a serveClientSideServer(...) definition')
}

function isClientSideServerDefinition(value: unknown): value is ClientSideServerDefinition {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as ClientSideServerDefinition).serverName === 'string'
    && Array.isArray((value as ClientSideServerDefinition).controllers),
  )
}

function applySourceAnalysisToControllers(
  controllers: ControllerClass[],
  analysis: ClientSideServerSourceAnalysis,
): void {
  const analysisByController = new Map(
    analysis.controllers.map((controller) => [controller.name, controller] as const),
  )

  for (const controller of controllers) {
    const controllerAnalysis = analysisByController.get(controller.name)
    if (!controllerAnalysis) continue

    const methods = new Map(
      controllerAnalysis.methods.map((method) => [method.name, method] as const),
    )

    for (const [methodName, methodAnalysis] of methods.entries()) {
      const routeMeta = ensureRouteMeta(controller as Function, methodName)
      if (methodAnalysis.summary) {
        routeMeta.summary = methodAnalysis.summary
      }
      if (methodAnalysis.description) {
        routeMeta.description = methodAnalysis.description
      }
      if (methodAnalysis.inputSchema) {
        routeMeta.inputSchema = methodAnalysis.inputSchema as any
      }
      if (methodAnalysis.outputSchema) {
        routeMeta.outputSchema = methodAnalysis.outputSchema as any
      }
    }
  }
}
