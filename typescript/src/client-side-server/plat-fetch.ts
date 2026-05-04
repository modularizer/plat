import type { ClientSideServerChannel } from './channel'
import type {
  ClientSideServerRequestOriginMetadata,
  ServiceWorkerBridgeBodyEncoding,
} from './protocol'
import type { PLATRPCMessage, PLATRPCResponse } from '../rpc'

/**
 * Options for creating a plat-aware fetch wrapper.
 */
export interface PlatFetchOptions {
  /** The channel to route requests through */
  channel: ClientSideServerChannel
  /** Optional base URL pattern to intercept (e.g. 'css://my-server'). Relative URLs are always intercepted. */
  interceptBase?: string
}

export interface PlatFetchRequestInit extends RequestInit, ClientSideServerRequestOriginMetadata {}

/**
 * Create a fetch-compatible function that routes requests through a client-side server channel.
 *
 * - Relative URLs (e.g. `/api/health`, `style.css`) are always routed through the channel
 * - URLs matching `interceptBase` (e.g. `css://my-server/path`) are routed through the channel
 * - All other URLs fall through to native `fetch()`
 *
 * Returns standard `Response` objects. File responses (`_type: 'file'`) are decoded from base64.
 *
 * Usage:
 * ```ts
 * const platFetch = createPlatFetch({ channel })
 * const res = await platFetch('/index.html')
 * const html = await res.text()
 * ```
 */
export function createPlatFetch(options: PlatFetchOptions): typeof globalThis.fetch {
  const { channel, interceptBase } = options
  let requestCounter = 0

  const platFetch: typeof globalThis.fetch = async (input, init?) => {
    const routing = resolveRequestRouting(input, interceptBase, init as PlatFetchRequestInit | undefined)

    if (!routing.shouldIntercept) {
      return globalThis.fetch(input, init)
    }

    const method = init?.method?.toUpperCase() ?? 'GET'
    const id = `plat-fetch-${++requestCounter}`

    const requestBody = await serializeRequestBody(init?.body)

    const rpcRequest = {
      jsonrpc: '2.0' as const,
      id,
      method,
      path: routing.path,
      headers: extractHeaders(init?.headers),
      clientOrigin: routing.clientOrigin,
      requestOrigin: routing.requestOrigin,
      interceptOrigin: routing.interceptOrigin,
      input: requestBody.input,
      bodyEncoding: requestBody.bodyEncoding,
      body: requestBody.body,
    }

    const response = await sendAndWait(channel, rpcRequest, init?.signal ?? null)

    if (!response.ok) {
      const status = response.error.status ?? 500
      const body = JSON.stringify(response.error.data ?? { error: response.error.message })
      return new Response(body, {
        status,
        statusText: response.error.message,
        headers: { 'content-type': 'application/json' },
      })
    }

    // Handle file responses
    const result = response.result as any
    if (result && typeof result === 'object' && result._type === 'http-response') {
      const headers = new Headers(result.headers ?? {})
      if (typeof result.finalUrl === 'string' && result.finalUrl) {
        headers.set('x-plat-upstream-url', result.finalUrl)
      }
      const body = decodeHttpResponseBody(result.body, result.bodyEncoding)
      return new Response(body, {
        status: result.status ?? 200,
        statusText: result.statusText ?? 'OK',
        headers,
      })
    }
    if (result && typeof result === 'object' && result._type === 'file') {
      const binary = decodeFileContentToUint8Array(result.content)
      const headers: Record<string, string> = {
        'content-type': result.contentType ?? 'application/octet-stream',
        ...(result.headers ?? {}),
      }
      return new Response(binary as any, { status: 200, statusText: 'OK', headers })
    }

    // 304 Not Modified — server confirmed the cached ETag is still current.
    // Return a body-less 304 so callers (e.g. service-worker caches) can
    // serve their cached payload.
    if (result && typeof result === 'object' && result._type === 'file-not-modified') {
      const headers: Record<string, string> = {
        'content-type': result.contentType ?? 'application/octet-stream',
        ...(result.headers ?? {}),
      }
      return new Response(null, { status: 304, statusText: 'Not Modified', headers })
    }

    // Regular JSON response
    const body = JSON.stringify(result)
    return new Response(body, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    })
  }

  return platFetch
}

/**
 * Convenience: patch `window.fetch` so all relative/css:// requests route through plat.
 * Returns a restore function.
 */
export function patchGlobalFetch(options: PlatFetchOptions): () => void {
  const originalFetch = globalThis.fetch
  globalThis.fetch = createPlatFetch(options)
  return () => { globalThis.fetch = originalFetch }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveRequestRouting(
  input: RequestInfo | URL,
  interceptBase?: string,
  init?: PlatFetchRequestInit,
): {
  path: string
  shouldIntercept: boolean
  clientOrigin?: string
  requestOrigin?: string
  interceptOrigin?: string
} {
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url
  const clientOrigin = init?.clientOrigin ?? getRuntimeOrigin()

  if (raw.startsWith('css://')) {
    const parsed = new URL(raw.replace('css://', 'http://'))
    return {
      path: parsed.pathname + parsed.search,
      shouldIntercept: true,
      clientOrigin,
      requestOrigin: init?.requestOrigin,
      interceptOrigin: init?.interceptOrigin,
    }
  }

  // Relative URLs → always intercept
  if (raw.startsWith('/') || (!raw.includes('://') && !raw.startsWith('data:') && !raw.startsWith('blob:'))) {
    const parsed = new URL(raw, getRuntimeHref())
    const requestOrigin = init?.requestOrigin ?? parsed.origin
    const routeBase = getRuntimeRouteBase()
    const path = raw.startsWith('/')
      ? parsed.pathname + parsed.search
      : normalizeRelativePath(raw)
    return {
      path,
      shouldIntercept: true,
      clientOrigin,
      requestOrigin,
      interceptOrigin: init?.interceptOrigin ?? `${requestOrigin}${routeBase}`,
    }
  }

  // Match explicit interceptBase
  if (interceptBase && raw.startsWith(interceptBase)) {
    const parsed = new URL(raw, getRuntimeHref())
    const base = new URL(interceptBase, getRuntimeHref())
    const rest = raw.slice(interceptBase.length)
    return {
      path: rest.startsWith('/') ? rest : '/' + rest,
      shouldIntercept: true,
      clientOrigin,
      requestOrigin: init?.requestOrigin ?? parsed.origin,
      interceptOrigin: init?.interceptOrigin ?? base.origin,
    }
  }

  return {
    path: raw,
    shouldIntercept: false,
    clientOrigin,
    requestOrigin: init?.requestOrigin,
    interceptOrigin: init?.interceptOrigin,
  }
}

function extractHeaders(init?: HeadersInit): Record<string, string> {
  if (!init) return {}
  if (init instanceof Headers) {
    const result: Record<string, string> = {}
    init.forEach((value, key) => { result[key] = value })
    return result
  }
  if (Array.isArray(init)) {
    return Object.fromEntries(init)
  }
  return init as Record<string, string>
}

async function serializeRequestBody(
  body: BodyInit | null | undefined,
): Promise<{ input: unknown; bodyEncoding?: ServiceWorkerBridgeBodyEncoding; body?: string }> {
  if (body == null) {
    return { input: undefined }
  }

  if (typeof body === 'string') {
    return {
      input: tryParseJson(body),
      bodyEncoding: 'none',
      body,
    }
  }

  if (body instanceof URLSearchParams) {
    const text = body.toString()
    return {
      input: undefined,
      bodyEncoding: 'none',
      body: text,
    }
  }

  if (body instanceof Blob) {
    const bytes = new Uint8Array(await body.arrayBuffer())
    return {
      input: undefined,
      bodyEncoding: 'base64',
      body: encodeBase64(bytes),
    }
  }

  if (body instanceof ArrayBuffer) {
    const bytes = new Uint8Array(body)
    return {
      input: tryParseJsonBytes(bytes),
      bodyEncoding: 'base64',
      body: encodeBase64(bytes),
    }
  }

  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    return {
      input: tryParseJsonBytes(bytes),
      bodyEncoding: 'base64',
      body: encodeBase64(bytes),
    }
  }

  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const text = await new Response(body).text()
    return {
      input: undefined,
      bodyEncoding: 'none',
      body: text,
    }
  }

  return { input: undefined }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function tryParseJsonBytes(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}

function decodeHttpResponseBody(
  body: string | undefined,
  encoding: ServiceWorkerBridgeBodyEncoding | undefined,
): BodyInit | null {
  if (body == null) return null
  if (encoding === 'base64') {
    return decodeBase64(body) as unknown as BodyInit
  }
  return body
}

function getRuntimeHref(): string {
  if (typeof window !== 'undefined' && window.location?.href) return window.location.href
  return 'http://localhost/'
}

function getRuntimeOrigin(): string | undefined {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  return undefined
}

function getRuntimeRouteBase(): string {
  try {
    const href = getRuntimeHref()
    const base = new URL('.', href)
    const pathname = base.pathname.replace(/\/+$/, '')
    return pathname || ''
  } catch {
    return ''
  }
}

function normalizeRelativePath(path: string): string {
  if (path.startsWith('./')) return path.slice(2)
  return path
}

function encodeBase64(bytes: Uint8Array): string {
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

function decodeBase64(base64: string): Uint8Array {
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

function sendAndWait(
  channel: ClientSideServerChannel,
  request: { jsonrpc: '2.0'; id: string; method: string; path: string; headers: Record<string, string>; input: unknown },
  signal: AbortSignal | null,
): Promise<PLATRPCResponse> {
  return new Promise<PLATRPCResponse>((resolve, reject) => {
    const abort = () => reject(new DOMException('Fetch aborted', 'AbortError'))
    if (signal?.aborted) { abort(); return }

    const unsubscribe = channel.subscribe((payload) => {
      const message = payload as PLATRPCMessage
      if (!message || typeof message !== 'object' || message.id !== request.id) return
      // Skip event messages, wait for final response
      if ('event' in message && (message as any).event) return
      unsubscribe()
      signal?.removeEventListener('abort', abort)
      resolve(message as PLATRPCResponse)
    })

    signal?.addEventListener('abort', abort, { once: true })
    void channel.send(request as any)
  })
}

/**
 * Decode file payload content from binary-first transport with legacy fallbacks.
 */
function decodeFileContentToUint8Array(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) return content
  if (content instanceof ArrayBuffer) return new Uint8Array(content)
  if (ArrayBuffer.isView(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength)

  if (Array.isArray(content)) {
    const bytes = new Uint8Array(content.length)
    for (let i = 0; i < content.length; i += 1) {
      const value = Number(content[i])
      if (!Number.isFinite(value) || value < 0 || value > 255) {
        throw new Error('Invalid numeric file byte')
      }
      bytes[i] = value
    }
    return bytes
  }

  if (typeof content !== 'string') {
    throw new Error('Unsupported file content encoding')
  }

  const trimmed = content.trim()
  if (/^[\d\s,]+$/.test(trimmed) && trimmed.includes(',')) {
    const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean)
    const bytes = new Uint8Array(parts.length)
    for (let i = 0; i < parts.length; i += 1) {
      const parsed = Number(parts[i])
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 255) {
        throw new Error('Invalid numeric file byte')
      }
      bytes[i] = parsed
    }
    return bytes
  }

  return base64ToUint8Array(trimmed)
}

function base64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/')
  const padLength = (4 - (normalized.length % 4)) % 4
  const padded = normalized + '='.repeat(padLength)
  const binaryString = atob(padded)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}
