/**
 * plat-service-worker: Universal HTTP interception via Service Worker
 *
 * Registers a Service Worker that intercepts ALL fetch events (fetch, XHR,
 * resource elements, forms, everything) and routes them through the plat channel.
 *
 * This is the lowest-level interception point in the browser and eliminates the
 * need for monkey-patching fetch, XHR, EventSource, Worker, forms, etc.
 */

import type { ClientSideServerChannel } from './channel'

// ── Public API ───────────────────────────────────────────────────────────────

export interface ServiceWorkerBridgeHandle {
  /** Unregister the Service Worker and restore normal behavior. */
  unregister(): Promise<void>
}

/**
 * Install the plat bridge via Service Worker.
 * This is the recommended approach—it intercepts all HTTP requests at the
 * browser's network layer.
 *
 * Requires the Service Worker to be available as a static file or via a server endpoint.
 * Returns a handle to unregister the Service Worker.
 * Throws if Service Workers are not supported or registration fails.
 */
export async function installServiceWorkerBridge(
  _channel: ClientSideServerChannel,
  options?: { scope?: string; workerUrl?: string }
): Promise<ServiceWorkerBridgeHandle> {
  if (!navigator.serviceWorker) {
    throw new Error(
      'Service Workers not supported in this browser. ' +
      'Ensure HTTPS or localhost is enabled.'
    )
  }

  const scope = options?.scope ?? '/'
  const workerUrl = options?.workerUrl ?? '/plat-service-worker.js'

  try {
    const registration = await navigator.serviceWorker.register(workerUrl, { scope })
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'PLAT_SKIP_WAITING' })
    }

    await navigator.serviceWorker.ready

    if (!navigator.serviceWorker.controller) {
      await waitForController(1200)
    }

    return {
      async unregister() {
        await registration.unregister()
      },
    }
  } catch (err) {
    throw new Error(
      `Failed to register Service Worker at ${workerUrl}: ` +
      (err instanceof Error ? err.message : String(err))
    )
  }
}

/**
 * Generate the complete Service Worker code as a string.
 * This is what you'd serve as /plat-service-worker.js or similar.
 *
 * The worker communicates with the main thread via postMessage to fetch requests.
 */
export function generateServiceWorkerCode(): string {
  return `(${serviceWorkerRuntime.toString()})()`
}

function waitForController(timeoutMs: number): Promise<void> {
  if (navigator.serviceWorker.controller) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const complete = () => {
      if (done) return
      done = true
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      clearTimeout(timer)
      resolve()
    }
    const onChange = () => complete()
    const timer = setTimeout(() => complete(), timeoutMs)
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
  })
}

/**
 * The Service Worker runtime—runs in the worker context.
 * Must be self-contained (no external dependencies).
 * Communicates with main thread via postMessage to route requests through platFetch.
 */
function serviceWorkerRuntime() {
  // @ts-ignore - Service Worker types not available in main thread context
  interface PlatRequestMessage {
    type: 'PLAT_REQUEST'
    id: string
    clientId?: string
    method: string
    path: string
    headers: Record<string, string>
    bodyEncoding: 'none' | 'base64'
    body?: string
  }

  // @ts-ignore - Service Worker types not available in main thread context
  interface PlatResponseMessage {
    type: 'PLAT_RESPONSE'
    id: string
    status: number
    statusText: string
    headers: Record<string, string>
    bodyEncoding: 'none' | 'base64'
    body?: string
    error?: string
    errorCode?: 'timeout' | 'no-client' | 'upstream-failed' | 'bad-response'
  }

  // Interception logic (matches main thread)
  function shouldIntercept(url: string): boolean {
      console.log("shouldIntercept", url)
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return false
    if (url.startsWith('css://')) return true
    try {
      const parsed = new URL(url, self.location.href)
      return parsed.origin === self.location.origin
    } catch {
      return false
    }
  }

  function normalizePath(url: string): string {
    if (url.startsWith('css://')) {
      try {
        const parsed = new URL(url.replace('css://', 'http://'))
        return `${parsed.pathname}${parsed.search}`
      } catch { return url }
    }
    if (url.startsWith('/')) return url
    try {
      const parsed = new URL(url, self.location.href)
      return `${parsed.pathname}${parsed.search}`
    } catch {
      return '/' + url
    }
  }

  // Map request IDs to pending responses
  const pending = new Map<string, { resolve: (r: any) => void; reject: (e: Error) => void }>()

  function randomId(): string {
    return `sw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  function bytesToBase64(bytes: Uint8Array): string {
    const chunk = 0x8000
    let binary = ''
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
  }

  async function readRequestBodyAsBase64(req: Request): Promise<string | undefined> {
    if (req.method === 'GET' || req.method === 'HEAD') return undefined
    const buf = await req.arrayBuffer()
    if (buf.byteLength === 0) return undefined
    return bytesToBase64(new Uint8Array(buf))
  }

  function fromBridgeBody(msg: PlatResponseMessage): BodyInit | null {
    if (msg.bodyEncoding === 'none') return msg.body ?? null
    if (!msg.body) return null
    const binaryStr = atob(msg.body)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
    return bytes
  }

  async function resolveClientForRequest(clientId?: string): Promise<any | undefined> {
    // @ts-ignore - Service Worker clients API
    if (clientId) {
      // @ts-ignore - Service Worker clients API
      const target = await self.clients.get(clientId)
      if (target) return target
    }
    // @ts-ignore - Service Worker clients API
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    return all[0]
  }

  // Listen for responses from main thread
  // @ts-ignore - Service Worker event
  self.addEventListener('message', (event: any) => {
    if (event.data?.type === 'PLAT_SKIP_WAITING') {
      // @ts-ignore - Service Worker global API
      self.skipWaiting()
      return
    }
    const msg = event.data as PlatResponseMessage
    if (msg.type === 'PLAT_RESPONSE') {
      const p = pending.get(msg.id)
      if (p) {
        pending.delete(msg.id)
        if (msg.error) {
          p.reject(new Error(msg.error))
        } else {
          p.resolve(msg)
        }
      }
    }
  })

  // Intercept all fetch events
  // @ts-ignore - Service Worker event
  self.addEventListener('fetch', (event: any) => {
    const url = event.request.url
    if (!shouldIntercept(url)) return

    const path = normalizePath(url)
    const method = event.request.method
    const headers: Record<string, string> = {}
    event.request.headers.forEach((value: string, key: string) => {
      headers[key.toLowerCase()] = value
    })

    event.respondWith(
      (async () => {
        try {
          const body = await readRequestBodyAsBase64(event.request.clone())

          // Send request to main thread and wait for response
          const id = randomId()
          const target = await resolveClientForRequest(event.clientId)
          if (!target) {
            throw new Error('No client available to handle request')
          }

          const responsePromise = new Promise<any>((resolve, reject) => {
            pending.set(id, { resolve, reject })
          })

          const msg: PlatRequestMessage = {
            type: 'PLAT_REQUEST',
            id,
            clientId: event.clientId,
            method,
            path,
            headers,
            bodyEncoding: body ? 'base64' : 'none',
            body,
          }
          target.postMessage(msg)

          // Wait for response with timeout
          const responseData = (await Promise.race([
            responsePromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Service Worker request timeout')), 30000)
            ),
          ]).finally(() => {
            pending.delete(id)
          })) as PlatResponseMessage

          if (responseData.error) {
            throw new Error(responseData.error)
          }

          const responseBody = fromBridgeBody(responseData)

          return new Response(responseBody, {
            status: responseData.status,
            statusText: responseData.statusText,
            headers: new Headers(responseData.headers),
          })
        } catch (err) {
          // Clear any orphaned pending entries if this request failed before response.
          // No-op if already removed.
          // (request ids are unique per request)
          const message = err instanceof Error ? err.message : String(err)
          return new Response(`[Service Worker] ${message}`, {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'content-type': 'text/plain' },
          })
        }
      })()
    )
  })

  // Claim all clients
  // @ts-ignore - Service Worker event
  self.addEventListener('activate', (event: any) => {
    // @ts-ignore - Service Worker clients API
    event.waitUntil(self.clients.claim())
  })

  // @ts-ignore - Service Worker event
  self.addEventListener('install', () => {
    // @ts-ignore - Service Worker global API
    self.skipWaiting()
  })
}

