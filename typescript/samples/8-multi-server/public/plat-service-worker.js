/**
 * Plat Service Worker
 * 
 * Generated from @modularizer/plat/client-server.
 * Place this file at /plat-service-worker.js in your static assets.
 * 
 * This intercepts all fetch events and routes them through the plat bridge.
 */

// Interception logic
function shouldIntercept(url) {
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return false
  if (url.startsWith('css://')) return true
  try {
    const parsed = new URL(url, self.location.href)
    return parsed.origin === self.location.origin
  } catch {
    return false
  }
}

function normalizePath(url) {
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
const pending = new Map()

function bytesToBase64(bytes) {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function readRequestBodyAsBase64(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const buf = await req.arrayBuffer()
  if (buf.byteLength === 0) return undefined
  return bytesToBase64(new Uint8Array(buf))
}

// Listen for responses from main thread
self.addEventListener('message', (event) => {
  const msg = event.data
  if (msg.type === 'PLAT_SKIP_WAITING') {
    self.skipWaiting()
    return
  }
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
self.addEventListener('fetch', (event) => {
  const url = event.request.url
  if (!shouldIntercept(url)) return

  const path = normalizePath(url)
  const method = event.request.method
  const headers = {}
  event.request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  event.respondWith(
    (async () => {
      try {
        // Serialize request body
        const body = await readRequestBodyAsBase64(event.request.clone())

        // Send request to main thread and wait for response
        const id = `${Math.random()}`
        const responsePromise = new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject })
        })

        const clients = await self.clients.matchAll()
        if (clients.length === 0) {
          throw new Error('No client available to handle request')
        }

        const msg = {
          type: 'PLAT_REQUEST',
          id,
          clientId: event.clientId,
          method,
          path,
          headers,
          bodyEncoding: body ? 'base64' : 'none',
          body,
        }
        clients[0].postMessage(msg)

        // Wait for response with timeout
        const responseData = await Promise.race([
          responsePromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Service Worker request timeout')), 30000)
          ),
        ])

        // Decode body if base64
        let responseBody = null
        if (responseData.bodyEncoding === 'base64' && responseData.body) {
          const binaryStr = atob(responseData.body)
          const bytes = new Uint8Array(binaryStr.length)
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
          responseBody = bytes
        } else if (responseData.bodyEncoding === 'none' && responseData.body !== null && responseData.body !== undefined) {
          responseBody = responseData.body
        }

        return new Response(responseBody, {
          status: responseData.status,
          statusText: responseData.statusText,
          headers: new Headers(responseData.headers),
        })
      } catch (err) {
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
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('install', () => {
  self.skipWaiting()
})

