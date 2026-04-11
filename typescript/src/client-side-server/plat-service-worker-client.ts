/**
 * plat-service-worker-client: Main thread handler for Service Worker communication
 *
 * Listens for fetch requests from the Service Worker and routes them through platFetch.
 */

import type { ClientSideServerChannel } from './channel'
import { createPlatFetch } from './plat-fetch'
import type {
  ServiceWorkerBridgeRequestMessage,
  ServiceWorkerBridgeResponseMessage,
} from './protocol'

export interface ServiceWorkerClientHandle {
  /** Uninstall the message handler. */
  uninstall(): void
}

export interface NavigationRepairHandle {
  uninstall(): void
}

export interface NavigationRepairOptions {
  /** Return true if URL is valid in your app. */
  isValidUrl: (url: URL) => boolean
  /** Fallback URL used when invalid URL is detected. */
  fallbackUrl: string
}

/**
 * Install the main-thread message handler for Service Worker bridge.
 * Call this in your main thread to handle requests routed from the Service Worker.
 */
export function installServiceWorkerClient(
  channel: ClientSideServerChannel
): ServiceWorkerClientHandle {
  const platFetch = createPlatFetch({ channel })

  function bytesToBase64(bytes: Uint8Array): string {
    const chunk = 0x8000
    let binary = ''
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
  }

  function base64ToBytes(b64?: string): Uint8Array | undefined {
    if (!b64) return undefined
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }

  async function sendResponse(event: MessageEvent, response: ServiceWorkerBridgeResponseMessage): Promise<void> {
    const source = event.source as ServiceWorker | MessagePort | null
    if (source && 'postMessage' in source) {
      source.postMessage(response)
      return
    }
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(response)
    }
  }

  const onMessage = async (event: MessageEvent) => {
    const msg = event.data as ServiceWorkerBridgeRequestMessage
    if (msg.type !== 'PLAT_REQUEST') return

    try {
      const requestBody = msg.bodyEncoding === 'base64' ? base64ToBytes(msg.body) : msg.body

      // Execute the request through platFetch
      const resp = await platFetch(msg.path, {
        method: msg.method,
        headers: msg.headers,
        body: requestBody as BodyInit | undefined,
      })

      // Read response body
      const responseBody = await resp.arrayBuffer()

      // Convert to base64 for safe transmission
      const bodyBase64 = bytesToBase64(new Uint8Array(responseBody))

      // Send response back to Service Worker
      const headers: Record<string, string> = {}
      resp.headers.forEach((value, key) => {
        headers[key] = value
      })

      const response: ServiceWorkerBridgeResponseMessage = {
        type: 'PLAT_RESPONSE',
        id: msg.id,
        status: resp.status,
        statusText: resp.statusText,
        headers,
        bodyEncoding: 'base64',
        body: bodyBase64,
      }

      await sendResponse(event, response)
    } catch (err) {
      // Send error response
      const response: ServiceWorkerBridgeResponseMessage = {
        type: 'PLAT_RESPONSE',
        id: msg.id,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {},
        bodyEncoding: 'none',
        body: '',
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'upstream-failed',
      }

      await sendResponse(event, response)
    }
  }

  navigator.serviceWorker?.addEventListener('message', onMessage)

  return {
    uninstall() {
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    },
  }
}

/**
 * Best-effort URL repair for SPA navigations that never hit the network.
 * This is optional and framework-agnostic: it observes History API and URL changes.
 */
export function installNavigationRepairShim(options: NavigationRepairOptions): NavigationRepairHandle {
  const fallback = new URL(options.fallbackUrl, window.location.href).toString()
  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState

  let restoring = false
  const repairIfInvalid = () => {
    if (restoring) return
    const current = new URL(window.location.href)
    if (options.isValidUrl(current)) return
    restoring = true
    try {
      history.replaceState(null, '', fallback)
    } finally {
      restoring = false
    }
  }

  history.pushState = function (data: any, unused: string, url?: string | URL | null): void {
    originalPushState.call(history, data, unused, url ?? undefined)
    repairIfInvalid()
  }

  history.replaceState = function (data: any, unused: string, url?: string | URL | null): void {
    originalReplaceState.call(history, data, unused, url ?? undefined)
    repairIfInvalid()
  }

  const onPopState = () => repairIfInvalid()
  const onHashChange = () => repairIfInvalid()
  window.addEventListener('popstate', onPopState)
  window.addEventListener('hashchange', onHashChange)

  // Validate current URL once on install.
  repairIfInvalid()

  return {
    uninstall() {
      history.pushState = originalPushState
      history.replaceState = originalReplaceState
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('hashchange', onHashChange)
    },
  }
}


