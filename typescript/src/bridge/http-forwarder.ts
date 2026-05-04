/**
 * HTTP forwarding handler for the plat bridge.
 *
 * This behaves like a normal client-side-server on the wire. The only special
 * behavior is in how requests are handled: every incoming request is forwarded
 * to an upstream HTTP origin and the upstream response is returned unchanged as
 * an HTTP response envelope.
 */
import type { ClientSideServerChannel } from '../client-side-server/channel'
import {
  type ClientSideServerRequestOriginMetadata,
  isClientSideServerRequestMessage,
  type ClientSideServerInstanceInfo,
  type ClientSideServerRequest,
  type ClientSideServerSuccessResponse,
  type ServiceWorkerBridgeRequestMessage,
  type ServiceWorkerBridgeResponseMessage,
} from '../client-side-server/protocol'
import type { ClientSideServerRequestHandler } from '../client-side-server/mqtt-webrtc'

/** Headers that must not be forwarded per RFC 7230 §6.1. */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export interface HTTPForwarderOptions {
  /** Base URL of the upstream HTTP server (e.g. "http://localhost:8080"). */
  upstream?: string
  /**
   * How to determine the upstream origin for each request.
   * - `fixed`: always use `upstream`
   * - `request-origin`: use the incoming requestOrigin
   * - `intercept-origin`: use the incoming interceptOrigin, falling back to requestOrigin
   */
  upstreamMode?: 'fixed' | 'request-origin' | 'intercept-origin'
  /**
   * How request paths are applied to the resolved upstream base.
   * - `origin-root`: keep browser URL semantics (`/foo` targets origin root)
   * - `route-base`: prefix leading-slash paths with intercepted route base (e.g. `/maps`)
   */
  pathBaseMode?: 'origin-root' | 'route-base'
  /** css:// name the bridge is reachable at (e.g. "my-api"). */
  cssName: string
  /** Identifier used in X-Forwarded-By / Forwarded by=. Defaults to cssName. */
  bridgeName?: string
  /** If true, append to a client-supplied X-Forwarded-For / Forwarded rather than overwrite. */
  trustClientForwarded?: boolean
  /**
   * If true, skip all X-Forwarded-* / Forwarded header injection.
   * Default: true, because the browser-side bridge should preserve the
   * incoming HTTP request as closely as the platform allows.
   */
  disableForwardedHeaders?: boolean
  /** Optional method allowlist (e.g. ['GET', 'POST']); others return 405. */
  allowMethods?: string[]
  /** Optional path allowlist (regex); non-matching requests return 403. */
  allowPaths?: (RegExp | string)[]
  /** Returned from getServerInfo() — surfaced on MQTT announcements. */
  instanceInfo?: ClientSideServerInstanceInfo
  /**
   * fetch implementation. Defaults to the global `fetch`. Override for
   * tests or to use `undici` directly.
   */
  fetchImpl?: typeof fetch
  /**
   * Time a single upstream request is allowed to take, in milliseconds.
   * Default: 30s.
   */
  requestTimeoutMs?: number
  /** Optional logger for bridge activity. Accepts `console.log` directly. */
  logger?: (...args: unknown[]) => void
}

interface ResolvedOptions {
  fetchImpl: typeof fetch
  upstreamBase?: string
  upstreamMode: 'fixed' | 'request-origin' | 'intercept-origin'
  pathBaseMode: 'origin-root' | 'route-base'
  runtimeOrigin?: string
  cssName: string
  bridgeName: string
  trustClientForwarded: boolean
  disableForwardedHeaders: boolean
  allowMethods?: string[]
  allowPaths?: RegExp[]
  timeoutMs: number
  logger?: (...args: unknown[]) => void
}

interface ForwardedHTTPResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  finalUrl?: string
  bodyEncoding: 'none' | 'base64'
  body?: string
  byteLength: number
}

interface ForwardedRequestSemantics {
  destination?: RequestDestination | ''
  mode?: RequestMode
  credentials?: RequestCredentials
  cache?: RequestCache
  redirect?: RequestRedirect
  referrer?: string
  referrerPolicy?: ReferrerPolicy
  integrity?: string
}

export function createHTTPForwarder(options: HTTPForwarderOptions): ClientSideServerRequestHandler {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const bridgeName = options.bridgeName ?? options.cssName
  const upstreamMode = options.upstreamMode ?? 'fixed'
  const pathBaseMode = options.pathBaseMode ?? 'origin-root'
  const upstreamBase = options.upstream?.replace(/\/$/, '')
  const allowMethods = options.allowMethods?.map((m) => m.toUpperCase())
  const allowPaths = options.allowPaths?.map((p) => (typeof p === 'string' ? new RegExp(p) : p))
  const timeoutMs = options.requestTimeoutMs ?? 30_000
  const logger = options.logger

  const resolvedOptions: ResolvedOptions = {
    fetchImpl,
    upstreamBase,
    upstreamMode,
    pathBaseMode,
    runtimeOrigin: getRuntimeOrigin(),
    cssName: options.cssName,
    bridgeName,
    trustClientForwarded: options.trustClientForwarded ?? false,
    disableForwardedHeaders: options.disableForwardedHeaders ?? true,
    allowMethods,
    allowPaths,
    timeoutMs,
    logger,
  }

  return {
    async getServerInfo() {
      return options.instanceInfo ?? {}
    },
    serveChannel(channel: ClientSideServerChannel): () => void {
      logger?.('[plat-bridge] channel attached', {
        cssName: options.cssName,
        upstream: upstreamBase,
        upstreamMode,
        pathBaseMode,
      })
      return channel.subscribe(async (message) => {
        const swMessage = message as unknown as { type?: string } & ServiceWorkerBridgeRequestMessage
        if (swMessage?.type === 'PLAT_REQUEST') {
          await handleServiceWorkerBridgeRequest(swMessage, channel, resolvedOptions)
          return
        }
        if (isClientSideServerRequestMessage(message)) {
          await handleClientSideServerRequest(message, channel, resolvedOptions)
        }
      })
    },
  }
}

async function handleServiceWorkerBridgeRequest(
  request: ServiceWorkerBridgeRequestMessage,
  channel: ClientSideServerChannel,
  options: ResolvedOptions,
): Promise<void> {
  const method = request.method.toUpperCase()
  options.logger?.('[plat-bridge] request', {
    id: request.id,
    method,
    path: request.path,
    clientOrigin: request.clientOrigin,
    requestOrigin: request.requestOrigin,
    interceptOrigin: request.interceptOrigin,
    bodyEncoding: request.bodyEncoding,
  })

  if (options.allowMethods && !options.allowMethods.includes(method)) {
    options.logger?.('[plat-bridge] rejected method', { id: request.id, method, allowMethods: options.allowMethods })
    await sendServiceWorkerError(channel, request.id, 405, 'Method Not Allowed', 'method-not-allowed')
    return
  }
  if (options.allowPaths && !options.allowPaths.some((r) => r.test(request.path))) {
    options.logger?.('[plat-bridge] rejected path', { id: request.id, path: request.path })
    await sendServiceWorkerError(channel, request.id, 403, 'Forbidden', 'path-not-allowed')
    return
  }

  try {
    const response = await forwardHttpRequest(
      method,
      request.path,
      request.headers,
      await decodeServiceWorkerRequestBody(request),
      {
        clientOrigin: request.clientOrigin,
        requestOrigin: request.requestOrigin,
        interceptOrigin: request.interceptOrigin,
      },
      {
        destination: request.destination,
        mode: request.mode,
        credentials: request.credentials,
        cache: request.cache,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        integrity: request.integrity,
      },
      options,
    )
    options.logger?.('[plat-bridge] response', {
      id: request.id,
      method,
      path: request.path,
      clientOrigin: request.clientOrigin,
      requestOrigin: request.requestOrigin,
      interceptOrigin: request.interceptOrigin,
      status: response.status,
      statusText: response.statusText || '',
      bodyEncoding: response.bodyEncoding,
      bytes: response.byteLength,
    })
    const result: ServiceWorkerBridgeResponseMessage = {
      type: 'PLAT_RESPONSE',
      id: request.id,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      finalUrl: response.finalUrl,
      bodyEncoding: response.bodyEncoding,
      body: response.body,
    }
    await channel.send(result as unknown as any)
  } catch (error: any) {
    const code = error?.code === 'timeout' ? 'timeout' : 'upstream-failed'
    const status = code === 'timeout' ? 504 : 502
    options.logger?.('[plat-bridge] error', {
      id: request.id,
      method,
      path: request.path,
      clientOrigin: request.clientOrigin,
      requestOrigin: request.requestOrigin,
      interceptOrigin: request.interceptOrigin,
      status,
      code,
      message: error?.message ?? 'Upstream request failed',
    })
    await sendServiceWorkerError(channel, request.id, status, error?.message ?? 'Upstream request failed', code)
  }
}

async function handleClientSideServerRequest(
  request: ClientSideServerRequest,
  channel: ClientSideServerChannel,
  options: ResolvedOptions,
): Promise<void> {
  const method = request.method.toUpperCase()
  options.logger?.('[plat-bridge] request', {
    id: request.id,
    method,
    path: request.path,
    clientOrigin: request.clientOrigin,
    requestOrigin: request.requestOrigin,
    interceptOrigin: request.interceptOrigin,
    bodyEncoding: request.bodyEncoding ?? inferInputEncoding(request.input),
  })

  if (options.allowMethods && !options.allowMethods.includes(method)) {
    options.logger?.('[plat-bridge] rejected method', { id: request.id, method, allowMethods: options.allowMethods })
    await sendClientResponse(channel, request.id, buildSyntheticHttpResponse(405, 'Method Not Allowed', 'method-not-allowed'))
    return
  }
  if (options.allowPaths && !options.allowPaths.some((r) => r.test(request.path))) {
    options.logger?.('[plat-bridge] rejected path', { id: request.id, path: request.path })
    await sendClientResponse(channel, request.id, buildSyntheticHttpResponse(403, 'Forbidden', 'path-not-allowed'))
    return
  }

  try {
    const response = await forwardHttpRequest(
      method,
      request.path,
      request.headers ?? {},
      await decodeClientRequestBody(request),
      {
        clientOrigin: request.clientOrigin,
        requestOrigin: request.requestOrigin,
        interceptOrigin: request.interceptOrigin,
      },
      undefined,
      options,
    )
    options.logger?.('[plat-bridge] response', {
      id: request.id,
      method,
      path: request.path,
      clientOrigin: request.clientOrigin,
      requestOrigin: request.requestOrigin,
      interceptOrigin: request.interceptOrigin,
      status: response.status,
      statusText: response.statusText || '',
      bodyEncoding: response.bodyEncoding,
      bytes: response.byteLength,
    })
    await sendClientResponse(channel, request.id, response)
  } catch (error: any) {
    const code = error?.code === 'timeout' ? 'timeout' : 'upstream-failed'
    const status = code === 'timeout' ? 504 : 502
    options.logger?.('[plat-bridge] error', {
      id: request.id,
      method,
      path: request.path,
      clientOrigin: request.clientOrigin,
      requestOrigin: request.requestOrigin,
      interceptOrigin: request.interceptOrigin,
      status,
      code,
      message: error?.message ?? 'Upstream request failed',
    })
    await sendClientResponse(channel, request.id, buildSyntheticHttpResponse(status, error?.message ?? 'Upstream request failed', code))
  }
}

async function sendServiceWorkerError(
  channel: ClientSideServerChannel,
  id: string,
  status: number,
  message: string,
  errorCode: NonNullable<ServiceWorkerBridgeResponseMessage['errorCode']> | 'method-not-allowed' | 'path-not-allowed',
): Promise<void> {
  const response: ServiceWorkerBridgeResponseMessage = {
    type: 'PLAT_RESPONSE',
    id,
    status,
    statusText: message,
    headers: {},
    bodyEncoding: 'none',
    error: message,
    errorCode: errorCode as ServiceWorkerBridgeResponseMessage['errorCode'],
  }
  await channel.send(response as unknown as any)
}

async function sendClientResponse(
  channel: ClientSideServerChannel,
  id: string,
  response: ForwardedHTTPResponse,
): Promise<void> {
  const payload: ClientSideServerSuccessResponse = {
    jsonrpc: '2.0',
    id,
    ok: true,
      result: {
        _type: 'http-response',
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        finalUrl: response.finalUrl,
        bodyEncoding: response.bodyEncoding,
        body: response.body,
      },
  }
  await channel.send(payload as unknown as any)
}

async function forwardHttpRequest(
  method: string,
  path: string,
  inboundHeaders: Record<string, string>,
  body: Uint8Array | undefined,
  requestMetadata: ClientSideServerRequestOriginMetadata,
  requestSemantics: ForwardedRequestSemantics | undefined,
  options: ResolvedOptions,
): Promise<ForwardedHTTPResponse> {
  const headers = buildForwardedHeaders(inboundHeaders, options)
  const upstreamBase = resolveUpstreamBase(requestMetadata, options)
  const upstreamPath = resolveUpstreamPath(path, requestMetadata, requestSemantics, options.pathBaseMode)
  const url = new URL(upstreamPath || '/', `${upstreamBase}/`).toString()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    const fetchOptions: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
      signal: controller.signal,
    }
    applyReplaySemantics(fetchOptions, requestSemantics, requestMetadata)
    if (body !== undefined) {
      fetchOptions.body = body as unknown as BodyInit
      fetchOptions.duplex = 'half'
    }

    const response = await options.fetchImpl.call(globalThis, url, fetchOptions)
    const responseHeaders = collectResponseHeaders(response.headers)
    const buffer = await response.arrayBuffer()
    const { body: responseBody, encoding } = encodeResponseBody(buffer, responseHeaders)
    return {
      status: response.status,
      statusText: response.statusText || '',
      headers: responseHeaders,
      finalUrl: response.url,
      bodyEncoding: encoding,
      body: responseBody,
      byteLength: buffer.byteLength,
    }
  } catch (error: any) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(error?.message ?? 'Upstream request timed out')
      ;(timeoutError as any).code = 'timeout'
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function resolveUpstreamPath(
  path: string,
  requestMetadata: ClientSideServerRequestOriginMetadata,
  requestSemantics: ForwardedRequestSemantics | undefined,
  pathBaseMode: 'origin-root' | 'route-base',
): string {
  if (pathBaseMode !== 'route-base') return path
  if (!path.startsWith('/')) return path

  const routeBase = resolveRouteBasePath(requestMetadata.interceptOrigin, requestSemantics?.referrer)
  if (!routeBase) return path
  if (path === routeBase || path.startsWith(`${routeBase}/`)) return path
  if (path === '/') return `${routeBase}/`
  return `${routeBase}${path}`
}

function resolveRouteBasePath(
  interceptOrigin: string | undefined,
  referrer: string | undefined,
): string | undefined {
  const fromInterceptOrigin = normalizeRouteBasePathFromUrl(interceptOrigin)
  if (fromInterceptOrigin) return fromInterceptOrigin

  if (!referrer) return undefined
  try {
    const parsed = new URL(referrer)
    const firstSegment = parsed.pathname.split('/').filter(Boolean)[0]
    if (!firstSegment) return undefined
    return `/${firstSegment}`
  } catch {
    return undefined
  }
}

function normalizeRouteBasePathFromUrl(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined
  try {
    const parsed = new URL(candidate)
    const pathname = parsed.pathname.replace(/\/+$/, '')
    if (!pathname || pathname === '/') return undefined
    return pathname
  } catch {
    return undefined
  }
}

function applyReplaySemantics(
  fetchOptions: RequestInit,
  semantics: ForwardedRequestSemantics | undefined,
  requestMetadata: ClientSideServerRequestOriginMetadata,
): void {
  if (!semantics) return

  if (semantics.credentials) fetchOptions.credentials = semantics.credentials
  if (semantics.cache && semantics.cache !== 'only-if-cached') fetchOptions.cache = semantics.cache
  if (semantics.redirect) fetchOptions.redirect = semantics.redirect
  if (semantics.referrerPolicy) fetchOptions.referrerPolicy = semantics.referrerPolicy
  if (semantics.integrity) fetchOptions.integrity = semantics.integrity

  if (semantics.referrer) {
    const bridgedReferrer = normalizeBridgeReferrer(semantics.referrer, requestMetadata)
    if (bridgedReferrer) fetchOptions.referrer = bridgedReferrer
  }

  // Preserve explicit fetch/XHR modes when they yield readable responses.
  // Avoid replaying browser subresource `no-cors` as opaque responses because
  // the bridge needs to read the body to mirror it back.
  if (semantics.mode && semantics.mode !== 'navigate' && semantics.mode !== 'no-cors') {
    fetchOptions.mode = semantics.mode
  }
}

function normalizeBridgeReferrer(
  referrer: string,
  requestMetadata: ClientSideServerRequestOriginMetadata,
): string | undefined {
  if (!referrer || referrer === 'about:client') return undefined
  if (!requestMetadata.clientOrigin || !requestMetadata.requestOrigin) return referrer

  try {
    const referrerUrl = new URL(referrer)
    if (referrerUrl.origin !== requestMetadata.clientOrigin) return referrer

    const targetOrigin = requestMetadata.interceptOrigin ?? requestMetadata.requestOrigin
    const targetUrl = new URL(targetOrigin)
    targetUrl.pathname = referrerUrl.pathname
    targetUrl.search = referrerUrl.search
    targetUrl.hash = referrerUrl.hash
    return targetUrl.toString()
  } catch {
    return referrer
  }
}

function buildForwardedHeaders(
  inbound: Record<string, string>,
  options: ResolvedOptions,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(inbound)) {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower)) continue
    if (!options.trustClientForwarded && isForwardedHeader(lower)) continue
    out[key] = value
  }

  if (options.disableForwardedHeaders) return out

  const existingForwardedFor = options.trustClientForwarded ? inbound['x-forwarded-for'] : undefined
  const existingForwarded = options.trustClientForwarded ? inbound['forwarded'] : undefined
  const remoteAddress = 'unknown'

  out['x-forwarded-for'] = existingForwardedFor
    ? `${existingForwardedFor}, ${remoteAddress}`
    : remoteAddress
  out['x-forwarded-proto'] = 'webrtc'
  out['x-forwarded-host'] = options.cssName
  out['x-forwarded-by'] = options.bridgeName

  const forwardedToken = `for=${remoteAddress};proto=webrtc;host=${quoteIfNeeded(options.cssName)};by=${quoteIfNeeded(options.bridgeName)}`
  out['forwarded'] = existingForwarded
    ? `${existingForwarded}, ${forwardedToken}`
    : forwardedToken

  return out
}

function isForwardedHeader(lowerName: string): boolean {
  return (
    lowerName === 'x-forwarded-for'
    || lowerName === 'x-forwarded-proto'
    || lowerName === 'x-forwarded-host'
    || lowerName === 'x-forwarded-by'
    || lowerName === 'forwarded'
  )
}

function quoteIfNeeded(value: string): string {
  if (/^[A-Za-z0-9._-]+$/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

function resolveUpstreamBase(
  requestMetadata: ClientSideServerRequestOriginMetadata,
  options: ResolvedOptions,
): string {
  const requestedOrigin = options.upstreamMode === 'request-origin'
    ? requestMetadata.requestOrigin
    : options.upstreamMode === 'intercept-origin'
      ? requestMetadata.interceptOrigin ?? requestMetadata.requestOrigin
      : options.upstreamBase

  const candidate = resolveRequestedOriginAgainstBridgeRuntime(
    requestedOrigin,
    requestMetadata.clientOrigin,
    options.runtimeOrigin,
  )

  if (!candidate) {
    throw new Error(`No upstream origin available for mode "${options.upstreamMode}"`)
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(`Invalid upstream origin: ${candidate}`)
  }

  if (options.runtimeOrigin) {
    try {
      const runtimeUrl = new URL(options.runtimeOrigin)
      const isExplicitOffOriginTarget = !requestMetadata.clientOrigin || candidate !== requestMetadata.clientOrigin
      if (runtimeUrl.protocol === 'https:' && parsed.protocol === 'http:' && isExplicitOffOriginTarget) {
        parsed.protocol = 'https:'
      }
    } catch {
      // Ignore runtime-origin parse failures and keep the requested origin as-is.
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported upstream protocol: ${parsed.protocol}`)
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/$/, '')
}

function resolveRequestedOriginAgainstBridgeRuntime(
  requestedOrigin: string | undefined,
  clientOrigin: string | undefined,
  runtimeOrigin: string | undefined,
): string | undefined {
  if (!requestedOrigin) return undefined
  if (!runtimeOrigin) return requestedOrigin
  if (clientOrigin && runtimeOrigin !== clientOrigin) {
    try {
      const requestedUrl = new URL(requestedOrigin)
      if (requestedUrl.origin === clientOrigin) {
        const runtimeUrl = new URL(runtimeOrigin)
        runtimeUrl.pathname = requestedUrl.pathname
        runtimeUrl.search = requestedUrl.search
        runtimeUrl.hash = requestedUrl.hash
        return runtimeUrl.toString()
      }
    } catch {
      if (requestedOrigin === clientOrigin) {
        return runtimeOrigin
      }
    }
  }
  return requestedOrigin
}

function getRuntimeOrigin(): string | undefined {
  if (typeof location !== 'undefined' && location.origin) return location.origin
  return undefined
}

async function decodeServiceWorkerRequestBody(request: ServiceWorkerBridgeRequestMessage): Promise<Uint8Array | undefined> {
  if (!request.body) return undefined
  if (request.bodyEncoding === 'base64') {
    return base64ToUint8Array(request.body)
  }
  return new TextEncoder().encode(request.body)
}

async function decodeClientRequestBody(request: ClientSideServerRequest): Promise<Uint8Array | undefined> {
  if (request.body) {
    if (request.bodyEncoding === 'base64') {
      return base64ToUint8Array(request.body)
    }
    return new TextEncoder().encode(request.body)
  }
  if (request.input === undefined) return undefined
  if (typeof request.input === 'string') return new TextEncoder().encode(request.input)
  return new TextEncoder().encode(JSON.stringify(request.input))
}

function inferInputEncoding(input: unknown): 'none' | 'json' {
  if (input === undefined) return 'none'
  return typeof input === 'string' ? 'none' : 'json'
}

function buildSyntheticHttpResponse(
  status: number,
  message: string,
  code: string,
): ForwardedHTTPResponse {
  const body = JSON.stringify({ error: message, code })
  return {
    status,
    statusText: message,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    bodyEncoding: 'none',
    body,
    byteLength: new TextEncoder().encode(body).byteLength,
  }
}

function collectResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower)) return
    result[lower] = value
  })
  return result
}

function encodeResponseBody(
  buffer: ArrayBuffer,
  headers: Record<string, string>,
): { body?: string; encoding: 'none' | 'base64' } {
  if (buffer.byteLength === 0) return { encoding: 'none' }
  const contentType = headers['content-type'] ?? ''
  if (isTextContentType(contentType)) {
    return { body: new TextDecoder('utf-8', { fatal: false }).decode(buffer), encoding: 'none' }
  }
  return { body: uint8ArrayToBase64(new Uint8Array(buffer)), encoding: 'base64' }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (normalized.length % 4)) % 4
  const padded = normalized + '='.repeat(padLength)

  if (typeof atob === 'function') {
    const binaryString = atob(padded)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i += 1) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
  }

  const BufferCtor = (globalThis as any).Buffer
  if (typeof BufferCtor === 'function') {
    const binary = BufferCtor.from(padded, 'base64')
    return new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength)
  }

  throw new Error('No base64 decoder available in this runtime')
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const BufferCtor = (globalThis as any).Buffer
  if (typeof BufferCtor === 'function') {
    return BufferCtor.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  }

  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!)
  }
  if (typeof btoa === 'function') {
    return btoa(binary)
  }

  throw new Error('No base64 encoder available in this runtime')
}

function isTextContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase()
  return (
    lower.startsWith('text/')
    || lower.startsWith('application/json')
    || lower.startsWith('application/xml')
    || lower.includes('+json')
    || lower.includes('+xml')
    || lower.startsWith('application/javascript')
  )
}
