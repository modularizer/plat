import type { ClientSideServerChannel } from './channel'
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
    const { url, shouldIntercept } = resolveUrl(input, interceptBase)

    if (!shouldIntercept) {
      return globalThis.fetch(input, init)
    }

    const method = init?.method?.toUpperCase() ?? 'GET'
    // Throwaway base only used so the URL parser accepts a relative input;
    // the host portion is discarded — only `.pathname` is read.
    const path = new URL(url, 'http://_/').pathname
    const id = `plat-fetch-${++requestCounter}`

    // Parse body as input params
    let inputParams: unknown = undefined
    if (init?.body) {
      try {
        inputParams = typeof init.body === 'string'
          ? JSON.parse(init.body)
          : init.body instanceof ArrayBuffer || init.body instanceof Uint8Array
            ? JSON.parse(new TextDecoder().decode(init.body))
            : undefined
      } catch {
        inputParams = undefined
      }
    }

    const rpcRequest = {
      jsonrpc: '2.0' as const,
      id,
      method,
      path,
      headers: extractHeaders(init?.headers),
      input: inputParams,
    }
    console.log("req", channel, rpcRequest, {input, init})

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

function resolveUrl(
  input: RequestInfo | URL,
  interceptBase?: string,
): { url: string; shouldIntercept: boolean } {
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url

  // Relative URLs → always intercept
  if (raw.startsWith('/') || (!raw.includes('://') && !raw.startsWith('data:') && !raw.startsWith('blob:'))) {
    return { url: raw, shouldIntercept: true }
  }

  // css:// → always intercept
  if (raw.startsWith('css://')) {
    const parsed = new URL(raw.replace('css://', 'http://'))
    return { url: parsed.pathname + parsed.search, shouldIntercept: true }
  }

  // Match explicit interceptBase
  if (interceptBase && raw.startsWith(interceptBase)) {
    const rest = raw.slice(interceptBase.length)
    return { url: rest.startsWith('/') ? rest : '/' + rest, shouldIntercept: true }
  }

  return { url: raw, shouldIntercept: false }
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
