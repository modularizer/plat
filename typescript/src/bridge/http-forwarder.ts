/**
 * HTTP forwarding handler for the plat bridge.
 *
 * Given an upstream HTTP base URL, this produces a
 * `ClientSideServerRequestHandler` that speaks the `PLAT_REQUEST` /
 * `PLAT_RESPONSE` raw-HTTP framing on the data channel. Each request is
 * forwarded via `fetch` to the upstream and the response is streamed back
 * as a single `PLAT_RESPONSE` message.
 *
 * This is deliberately a pure HTTP tunnel — no operation runtime, no
 * OpenAPI, no routing. The WebRTC signaling / identity / MQTT machinery
 * comes from `mqtt-webrtc.ts`; we only implement the handler it calls.
 */
import type { ClientSideServerChannel } from '../client-side-server/channel'
import type {
  ClientSideServerInstanceInfo,
  ServiceWorkerBridgeRequestMessage,
  ServiceWorkerBridgeResponseMessage,
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
  upstream: string
  /** css:// name the bridge is reachable at (e.g. "my-api"). */
  cssName: string
  /** Identifier used in X-Forwarded-By / Forwarded by=. Defaults to cssName. */
  bridgeName?: string
  /** If true, append to a client-supplied X-Forwarded-For / Forwarded rather than overwrite. */
  trustClientForwarded?: boolean
  /** If true, skip all X-Forwarded-* / Forwarded header injection. */
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
}

export function createHTTPForwarder(options: HTTPForwarderOptions): ClientSideServerRequestHandler {
  const fetchImpl = options.fetchImpl ?? fetch
  const bridgeName = options.bridgeName ?? options.cssName
  const upstreamBase = options.upstream.replace(/\/$/, '')
  const allowMethods = options.allowMethods?.map((m) => m.toUpperCase())
  const allowPaths = options.allowPaths?.map((p) => (typeof p === 'string' ? new RegExp(p) : p))
  const timeoutMs = options.requestTimeoutMs ?? 30_000

  return {
    async getServerInfo() {
      return options.instanceInfo ?? {}
    },
    serveChannel(channel: ClientSideServerChannel): () => void {
      return channel.subscribe(async (message) => {
        const msg = message as unknown as { type?: string } & ServiceWorkerBridgeRequestMessage
        if (msg?.type !== 'PLAT_REQUEST') return
        await handleRequest(msg, channel, {
          fetchImpl,
          upstreamBase,
          cssName: options.cssName,
          bridgeName,
          trustClientForwarded: options.trustClientForwarded ?? false,
          disableForwardedHeaders: options.disableForwardedHeaders ?? false,
          allowMethods,
          allowPaths,
          timeoutMs,
        })
      })
    },
  }
}

interface ResolvedOptions {
  fetchImpl: typeof fetch
  upstreamBase: string
  cssName: string
  bridgeName: string
  trustClientForwarded: boolean
  disableForwardedHeaders: boolean
  allowMethods?: string[]
  allowPaths?: RegExp[]
  timeoutMs: number
}

async function handleRequest(
  request: ServiceWorkerBridgeRequestMessage,
  channel: ClientSideServerChannel,
  options: ResolvedOptions,
): Promise<void> {
  const method = request.method.toUpperCase()

  if (options.allowMethods && !options.allowMethods.includes(method)) {
    await sendError(channel, request.id, 405, 'Method Not Allowed', 'method-not-allowed')
    return
  }
  if (options.allowPaths && !options.allowPaths.some((r) => r.test(request.path))) {
    await sendError(channel, request.id, 403, 'Forbidden', 'path-not-allowed')
    return
  }

  const headers = buildForwardedHeaders(request.headers, options)
  const url = options.upstreamBase + ensureLeadingSlash(request.path)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    const body = await decodeRequestBody(request);
    // Only include duplex if body is present (for undici compatibility)
    let fetchBody: BodyInit | null | undefined = undefined;
    if (body !== undefined) {
      if (body instanceof Uint8Array) {
        fetchBody = Buffer.from(body);
      } else {
        fetchBody = body as any;
      }
    }
    const fetchOptions: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
      body: fetchBody,
      signal: controller.signal,
    };
    if (body !== undefined) {
      // @ts-ignore: duplex is required by undici for streaming bodies
      fetchOptions.duplex = 'half';
    }
    const response = await options.fetchImpl(url, fetchOptions);
    const responseHeaders = collectResponseHeaders(response.headers);
    const buffer = await response.arrayBuffer();
    const { body: responseBody, encoding } = encodeResponseBody(buffer, responseHeaders);
    const result: ServiceWorkerBridgeResponseMessage = {
      type: 'PLAT_RESPONSE',
      id: request.id,
      status: response.status,
      statusText: response.statusText || '',
      headers: responseHeaders,
      bodyEncoding: encoding,
      body: responseBody,
    };
    await channel.send(result as unknown as any);
  } catch (error: any) {
    const code = controller.signal.aborted ? 'timeout' : 'upstream-failed';
    const status = controller.signal.aborted ? 504 : 502;
    await sendError(channel, request.id, status, error?.message ?? 'Upstream request failed', code);
  } finally {
    clearTimeout(timer);
  }
}

async function sendError(
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

  // remoteAddress is not yet wired through — leave the "for" token as `unknown`
  // until the signaler surfaces the ICE-selected candidate pair.
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

function ensureLeadingSlash(path: string): string {
  if (!path) return '/'
  return path.startsWith('/') ? path : `/${path}`
}

async function decodeRequestBody(request: ServiceWorkerBridgeRequestMessage): Promise<Uint8Array | undefined> {
  if (!request.body) return undefined;
  if (request.bodyEncoding === 'base64') {
    const binary = Buffer.from(request.body, 'base64');
    return new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength);
  }
  // In the future, this could support async decoding (e.g., streaming, blobs)
  return new TextEncoder().encode(request.body);
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
  return { body: Buffer.from(buffer).toString('base64'), encoding: 'base64' }
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
