import type { Logger } from './config/logger'
import type { PLATServerCallEnvelope, PLATServerResolvedOperation } from './transports'
import type { RouteContext } from '../types'

export interface PLATServerConnectionRequest {
  protocol: string
  meta?: Record<string, unknown>
}

export interface PLATServerRequestEnvelope extends PLATServerCallEnvelope {}

export interface PLATServerUpdateEnvelope {
  id: string
  event: string
  data?: unknown
}

export interface PLATServerResponseEnvelope {
  id: string
  ok: boolean
  result?: unknown
  error?: unknown
  statusCode?: number
}

export interface PLATServerHostContext {
  kind: string
  app?: unknown
  server?: unknown
  meta?: Record<string, unknown>
}

export interface PLATServerTransportRuntime {
  logger: Logger
  resolveOperation(envelope: Pick<PLATServerCallEnvelope, 'operationId' | 'method' | 'path'>): PLATServerResolvedOperation | undefined
  dispatch(operation: PLATServerResolvedOperation, envelope: PLATServerCallEnvelope): Promise<{ kind: 'success' | 'help'; result: any; statusCode: number }>
  normalizeInput(input: Record<string, any>): Record<string, any>
  serializeValue(value: unknown): unknown
  createCallContext(args: {
    ctx: RouteContext
    sessionId: string
    mode: 'rpc' | 'deferred'
    signal?: AbortSignal
    emit: (event: 'progress' | 'log' | 'chunk' | 'message', data?: unknown) => Promise<void> | void
  }): RouteContext['call']
  createEnvelope(args: {
    protocol: string
    operation: PLATServerResolvedOperation
    input: Record<string, any>
    headers?: Record<string, string>
    ctx: RouteContext
    requestId?: string
    req?: unknown
    res?: unknown
    allowHelp?: boolean
    helpRequested?: boolean
  }): PLATServerCallEnvelope
}

export interface PLATServerProtocolPlugin {
  name: string
  setup?(runtime: PLATServerTransportRuntime): void | Promise<void>
  attach?(runtime: PLATServerTransportRuntime, host: PLATServerHostContext): void | Promise<void>
  getConnectionRequest?(runtime: PLATServerTransportRuntime): Promise<PLATServerConnectionRequest | null | undefined> | PLATServerConnectionRequest | null | undefined
  onConnectionRequest?(request: PLATServerConnectionRequest, runtime: PLATServerTransportRuntime): void | Promise<void>
  getRequest?(runtime: PLATServerTransportRuntime): Promise<PLATServerRequestEnvelope | null | undefined> | PLATServerRequestEnvelope | null | undefined
  onRequest?(request: PLATServerRequestEnvelope, runtime: PLATServerTransportRuntime): void | Promise<void>
  handleRequest?(request: PLATServerRequestEnvelope, runtime: PLATServerTransportRuntime): Promise<PLATServerResponseEnvelope | null | undefined> | PLATServerResponseEnvelope | null | undefined
  sendUpdate?(update: PLATServerUpdateEnvelope, runtime: PLATServerTransportRuntime): Promise<void> | void
  sendResponse?(response: PLATServerResponseEnvelope, runtime: PLATServerTransportRuntime): Promise<void> | void
  teardown?(runtime: PLATServerTransportRuntime): Promise<void> | void
  start?(runtime: PLATServerTransportRuntime): void | Promise<void>
}
