/**
 * plat-bridge: Universal HTTP → CSS:// bridge
 *
 * Transparently intercepts all browser network requests (fetch, XHR, resource elements)
 * and routes them through a plat client-side server channel instead of HTTP.
 *
 * Two modes:
 *
 * 1. Full-page (direct channel):
 *    import { installBridge } from '@modularizer/plat-client/client-server'
 *    installBridge(channel)
 *    // All fetch/XHR/resource loads now route through the channel
 *
 * 2. Iframe (postMessage):
 *    Parent injects generateBridgeScript() into iframe srcdoc, then handles
 *    'plat-fetch' postMessages and responds with 'plat-fetch-response'.
 */

import type { ClientSideServerChannel } from './channel'
import { createPlatFetch } from './plat-fetch'

// ── Public API ───────────────────────────────────────────────────────────────

export interface BridgeHandle {
  /** Stop intercepting — restore original fetch/XHR */
  restore(): void
}

/**
 * Install the plat bridge on the current page.
 * All relative and css:// URLs will be routed through the given channel.
 * Returns a handle to restore the original behavior.
 */
export function installBridge(channel: ClientSideServerChannel): BridgeHandle {
  const platFetch = createPlatFetch({ channel })
  return installBridgeWithFetch(platFetch)
}

/**
 * Install the bridge using a custom fetch function.
 * Useful if you already have a configured platFetch instance.
 */
export function installBridgeWithFetch(platFetch: typeof globalThis.fetch): BridgeHandle {
  const originalFetch = window.fetch
  const originalXHROpen = XMLHttpRequest.prototype.open
  const originalXHRSend = XMLHttpRequest.prototype.send
  const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader

  const blobCache = new Map<string, string>()
  const blobPending = new Map<string, Promise<string | null>>()

  // ── fetch patch ──────────────────────────────────────────────────────────

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!shouldIntercept(url)) return originalFetch.call(window, input, init)
    return platFetch(normalizePath(url), init)
  } as typeof window.fetch

  // ── XHR patch ────────────────────────────────────────────────────────────

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string, url: string,
    async_?: boolean, user?: string | null, password?: string | null,
  ) {
    (this as any)._platUrl = shouldIntercept(url) ? url : null;
    (this as any)._platMethod = method
    ;(this as any)._platHeaders = {}
    if (!(this as any)._platUrl) {
      return originalXHROpen.call(this, method, url, async_ ?? true, user ?? null, password ?? null)
    }
    originalXHROpen.call(this, method, 'about:blank', async_ ?? true, user ?? null, password ?? null)
  } as typeof XMLHttpRequest.prototype.open

  XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    if (!(this as any)._platUrl) {
      return originalXHRSetRequestHeader.call(this, name, value)
    }
    const headers = ((this as any)._platHeaders ??= {}) as Record<string, string>
    const key = name.toLowerCase()
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value
  } as typeof XMLHttpRequest.prototype.setRequestHeader

  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    if (!(this as any)._platUrl) {
      return originalXHRSend.call(this, body)
    }
    const xhr = this
    const path = normalizePath((this as any)._platUrl)
    const method = ((this as any)._platMethod || 'GET') as string
    const headers = (((this as any)._platHeaders ?? {}) as Record<string, string>)

    platFetch(path, {
      method,
      headers,
      body: coerceXHRBody(body),
    }).then(async (resp) => {
      const text = await resp.text()
      Object.defineProperty(xhr, 'status', { value: resp.status, configurable: true })
      Object.defineProperty(xhr, 'statusText', { value: resp.statusText, configurable: true })
      Object.defineProperty(xhr, 'responseText', { value: text, configurable: true })
      Object.defineProperty(xhr, 'response', { value: text, configurable: true })
      Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true })
      xhr.dispatchEvent(new Event('readystatechange'))
      xhr.dispatchEvent(new Event('load'))
      xhr.dispatchEvent(new Event('loadend'))
    }).catch(() => {
      xhr.dispatchEvent(new Event('error'))
      xhr.dispatchEvent(new Event('loadend'))
    })
  } as typeof XMLHttpRequest.prototype.send

  // ── Resource element interception ────────────────────────────────────────

  const RESOURCE_ATTRS: Array<[string, string]> = [
    ['img', 'src'], ['script', 'src'], ['link', 'href'],
    ['img', 'srcset'],
    ['audio', 'src'], ['video', 'src'], ['source', 'src'],
    ['source', 'srcset'], ['iframe', 'src'], ['embed', 'src'],
    ['object', 'data'],
  ]

  /** Fetch a resource path and return its blob URL (cached). */
  async function fetchAsBlobUrl(path: string, contentType?: string): Promise<string | null> {
    if (blobCache.has(path)) return blobCache.get(path)!
    if (blobPending.has(path)) return blobPending.get(path)!

    const promise = (async () => {
      try {
        const resp = await platFetch(path)
        if (!resp.ok) return null
        const rawBlob = await resp.blob()
        const blob = contentType && !rawBlob.type
          ? new Blob([rawBlob], { type: contentType })
          : rawBlob
        const blobUrl = URL.createObjectURL(blob)
        blobCache.set(path, blobUrl)
        return blobUrl
      } catch {
        return null
      } finally {
        blobPending.delete(path)
      }
    })()

    blobPending.set(path, promise)
    return promise
  }

  /**
   * Rewrite CSS url() references to blob URLs.
   * Handles: url(/path), url("path"), url('path'), @import url(...), @import "..."
   */
  async function rewriteCssUrls(css: string, basePath: string): Promise<string> {

    // Collect all url() and @import references
    const urlPattern = /url\(\s*['"]?([^'")]+?)['"]?\s*\)|@import\s+['"]([^'"]+?)['"]/g
    const replacements: Array<{ match: string; start: number; end: number; path: string }> = []
    let m: RegExpExecArray | null
    while ((m = urlPattern.exec(css)) !== null) {
      const ref = m[1] ?? m[2]
      if (!ref || !shouldIntercept(ref)) continue
      const resolved = normalizePathWithBase(ref, basePath)
      replacements.push({ match: m[0], start: m.index, end: m.index + m[0].length, path: resolved })
    }

    if (replacements.length === 0) return css

    // Fetch all referenced resources in parallel
    const blobUrls = await Promise.all(replacements.map((r) => fetchAsBlobUrl(r.path)))

    // Rebuild CSS with blob URLs
    let result = ''
    let lastEnd = 0
    for (let i = 0; i < replacements.length; i++) {
      const r = replacements[i]!
      const blobUrl = blobUrls[i]
      result += css.slice(lastEnd, r.start)
      if (blobUrl) {
        if (r.match.startsWith('@import')) {
          result += `@import url("${blobUrl}")`
        } else {
          result += `url("${blobUrl}")`
        }
      } else {
        result += r.match // keep original if fetch failed
      }
      lastEnd = r.end
    }
    result += css.slice(lastEnd)
    return result
  }

  async function rewriteUrl(el: Element, attr: string) {
    const url = el.getAttribute(attr)
    if (!url || !shouldIntercept(url)) return
    const path = normalizePath(url)

    // Special handling for CSS: rewrite url() references inside the CSS
    const rel = (el.getAttribute('rel') ?? '').toLowerCase()
    const isStylesheet = el.tagName.toLowerCase() === 'link' && rel.split(/\s+/).includes('stylesheet')
    if (isStylesheet) {
      const existingBlob = blobCache.get(path)
      if (existingBlob) { el.setAttribute(attr, existingBlob); return }

      const resp = await platFetch(path)
      if (!resp.ok) return
      let cssText = await resp.text()
      cssText = await rewriteCssUrls(cssText, path)
      const blob = new Blob([cssText], { type: 'text/css' })
      const blobUrl = URL.createObjectURL(blob)
      blobCache.set(path, blobUrl)
      el.setAttribute(attr, blobUrl)
      return
    }

    if (attr === 'srcset') {
      const rewritten = await rewriteSrcset(url)
      if (rewritten !== url) el.setAttribute(attr, rewritten)
      return
    }

    const blobUrl = await fetchAsBlobUrl(path)
    if (blobUrl) el.setAttribute(attr, blobUrl)
  }

  async function rewriteSrcset(srcset: string): Promise<string> {
    const entries = srcset.split(',').map((entry) => entry.trim()).filter(Boolean)
    if (entries.length === 0) return srcset
    const rewrittenEntries: string[] = []

    for (const entry of entries) {
      const parts = entry.split(/\s+/)
      const rawUrl = parts[0]
      if (!rawUrl || !shouldIntercept(rawUrl)) {
        rewrittenEntries.push(entry)
        continue
      }
      const path = normalizePath(rawUrl)
      const blobUrl = await fetchAsBlobUrl(path)
      rewrittenEntries.push(blobUrl ? [blobUrl, ...parts.slice(1)].join(' ') : entry)
    }

    return rewrittenEntries.join(', ')
  }

  /** Also rewrite inline <style> elements that contain url() references */
  async function rewriteInlineStyle(el: HTMLStyleElement) {
    if (!el.textContent) return
    const rewritten = await rewriteCssUrls(el.textContent, '/')
    if (rewritten !== el.textContent) {
      el.textContent = rewritten
    }
  }

  function processElement(el: Element) {
    const tag = el.tagName.toLowerCase()
    for (const [t, attr] of RESOURCE_ATTRS) {
      if (tag === t && el.hasAttribute(attr)) {
        void rewriteUrl(el, attr)
      }
    }
    // Inline <style> url() rewriting
    if (tag === 'style' && el instanceof HTMLStyleElement) {
      void rewriteInlineStyle(el)
    }
  }

  function processExisting() {
    for (const [tag, attr] of RESOURCE_ATTRS) {
      document.querySelectorAll(`${tag}[${attr}]`).forEach((el: Element) => void rewriteUrl(el, attr))
    }
    // Rewrite existing inline styles
    document.querySelectorAll('style').forEach((el) => {
      if (el instanceof HTMLStyleElement) void rewriteInlineStyle(el)
    })
  }

  // ── Worker interception ──────────────────────────────────────────────────
  const OriginalWorker = window.Worker
  ;(window as any).Worker = class PlatWorker extends OriginalWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      const url = typeof scriptURL === 'string' ? scriptURL : scriptURL.href
      if (shouldIntercept(url)) {
        const path = normalizePath(url)
        const isModule = options?.type === 'module'
        const loaderCode = isModule
          ? `
            (async () => {
              const resp = await fetch(${JSON.stringify(path)});
              if (!resp.ok) throw new Error('Failed to load worker script: ' + ${JSON.stringify(path)});
              const code = await resp.text();
              const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
              try { await import(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
            })().catch((err) => { throw err; });
          `
          : `
            (async () => {
              const resp = await fetch(${JSON.stringify(path)});
              if (!resp.ok) throw new Error('Failed to load worker script: ' + ${JSON.stringify(path)});
              const code = await resp.text();
              const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
              try { importScripts(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
            })().catch((err) => { throw err; });
          `
        const loaderBlob = new Blob([loaderCode], { type: 'text/javascript' })
        const loaderUrl = URL.createObjectURL(loaderBlob)
        super(loaderUrl, options)
        URL.revokeObjectURL(loaderUrl)
      } else {
        super(scriptURL, options)
      }
    }
  }

  // ── navigator.sendBeacon interception ────────────────────────────────────
  const originalSendBeacon = navigator.sendBeacon?.bind(navigator)
  if (originalSendBeacon) {
    navigator.sendBeacon = function (url: string, data?: BodyInit | null): boolean {
      if (shouldIntercept(url)) {
        const path = normalizePath(url)
        void platFetch(path, {
          method: 'POST',
          body: data as any,
        })
        return true
      }
      return originalSendBeacon(url, data)
    }
  }

  // ── EventSource interception ─────────────────────────────────────────────
  // EventSource over plat doesn't map perfectly (SSE is streaming),
  // but we can intercept construction and poll via fetch
  const OriginalEventSource = window.EventSource
  ;(window as any).EventSource = class PlatEventSource extends EventTarget {
            private abortController?: AbortController
    url: string
    readyState = 0
    withCredentials = false
    onopen: ((ev: Event) => void) | null = null
    onmessage: ((ev: MessageEvent) => void) | null = null
    onerror: ((ev: Event) => void) | null = null
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSED = 2
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSED = 2

    constructor(url: string | URL, init?: EventSourceInit) {
      super()
      this.url = typeof url === 'string' ? url : url.href
      if (shouldIntercept(this.url)) {
        const path = normalizePath(this.url)
        this.readyState = 0
        this.abortController = new AbortController()
        setTimeout(() => {
          this.readyState = 1
          const openEvent = new Event('open')
          this.onopen?.(openEvent)
          this.dispatchEvent(openEvent)

          platFetch(path, {
            headers: { accept: 'text/event-stream' },
            signal: this.abortController!.signal,
          }).then(async (resp) => {
            if (!resp.ok) throw new Error(`EventSource request failed: ${resp.status}`)
            if (!resp.body) {
              const text = await resp.text()
              const msgEvent = new MessageEvent('message', { data: text })
              this.onmessage?.(msgEvent)
              this.dispatchEvent(msgEvent)
              return
            }

            const reader = resp.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let eventName = 'message'
            let eventData: string[] = []

            const flushEvent = () => {
              if (eventData.length === 0) return
              const payload = eventData.join('\n')
              const evt = new MessageEvent(eventName || 'message', { data: payload })
              this.onmessage?.(evt)
              this.dispatchEvent(evt)
              eventName = 'message'
              eventData = []
            }

            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })

              let splitIndex = buffer.indexOf('\n')
              while (splitIndex >= 0) {
                const line = buffer.slice(0, splitIndex).replace(/\r$/, '')
                buffer = buffer.slice(splitIndex + 1)
                if (line === '') {
                  flushEvent()
                } else if (line.startsWith('event:')) {
                  eventName = line.slice(6).trim() || 'message'
                } else if (line.startsWith('data:')) {
                  eventData.push(line.slice(5).trimStart())
                }
                splitIndex = buffer.indexOf('\n')
              }
            }

            if (buffer.trim().length > 0) {
              if (buffer.startsWith('data:')) eventData.push(buffer.slice(5).trimStart())
            }
            flushEvent()
          }).catch(() => {
            this.readyState = 2
            const errEvent = new Event('error')
            this.onerror?.(errEvent)
            this.dispatchEvent(errEvent)
          })
        }, 0)
      } else {
        // Fall back to real EventSource — but we can't extend it easily,
        // so just return a real one
        return new OriginalEventSource(url, init) as any
      }
    }

    close() {
      this.abortController?.abort()
      this.readyState = 2
    }
  }

   // ── <a> click interception (for SPA-like navigation within the bridge) ──
   const onDocumentClick = (e: MouseEvent) => {
     if (e.defaultPrevented) return
     if (e.button !== 0) return
     if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
     const anchor = (e.target as Element).closest?.('a[href]')
     if (!anchor) return
     if ((anchor as HTMLAnchorElement).target && (anchor as HTMLAnchorElement).target !== '_self') return
     const href = anchor.getAttribute('href')
     if (!href || !shouldIntercept(href)) return

     // Prevent default navigation, instead fetch the page through plat
     e.preventDefault()
     const path = normalizePath(href)

     platFetch(path).then(async (resp) => {
       const contentType = resp.headers.get('content-type') || ''
       if (contentType.includes('text/html')) {
         const html = await resp.text()
         // Rewrite the document body (SPA-style navigation)
         document.open()
         document.write(html)
         document.close()
         // Re-process all elements after rewrite
         processExisting()
         history.pushState(null, '', href)
       } else {
         // Non-HTML: download or open in new tab
         const blob = await resp.blob()
         const blobUrl = URL.createObjectURL(blob)
         window.open(blobUrl, '_blank')
       }
     })
   }
   document.addEventListener('click', onDocumentClick, true)

   // ── Form submission interception ──────────────────────────────────────────
   const onFormSubmit = (e: SubmitEvent) => {
     const form = e.target as HTMLFormElement
     if (!form || !(form instanceof HTMLFormElement)) return

     const action = form.getAttribute('action') || window.location.pathname
     if (!shouldIntercept(action)) return

     e.preventDefault()
     const method = (form.getAttribute('method') || 'GET').toUpperCase()
     const path = normalizePath(action)

     let body: BodyInit | undefined = undefined
     const enctype = (form.getAttribute('enctype') || 'application/x-www-form-urlencoded').toLowerCase()

     // For GET, append form data to URL
     if (method === 'GET') {
       const formData = new FormData(form)
       const params = new URLSearchParams(formData as any)
       const separator = path.includes('?') ? '&' : '?'
       const pathWithParams = `${path}${separator}${params.toString()}`
       platFetch(pathWithParams).then(async (resp) => {
         const contentType = resp.headers.get('content-type') || ''
         if (contentType.includes('text/html')) {
           const html = await resp.text()
           document.open()
           document.write(html)
           document.close()
           processExisting()
           history.pushState(null, '', pathWithParams)
         } else {
           const blob = await resp.blob()
           const blobUrl = URL.createObjectURL(blob)
           window.open(blobUrl, '_blank')
         }
       })
     } else {
       // For POST/PUT/PATCH, send form data as body
       body = new FormData(form)

       platFetch(path, { method, body }).then(async (resp) => {
         const contentType = resp.headers.get('content-type') || ''
         if (contentType.includes('text/html')) {
           const html = await resp.text()
           document.open()
           document.write(html)
           document.close()
           processExisting()
           history.pushState(null, '', path)
         } else {
           const blob = await resp.blob()
           const blobUrl = URL.createObjectURL(blob)
           window.open(blobUrl, '_blank')
         }
       })
     }
   }
   document.addEventListener('submit', onFormSubmit, true)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (let i = 0; i < mutation.addedNodes.length; i++) {
        const node = mutation.addedNodes[i]!
        if (node instanceof Element) {
          processElement(node)
          node.querySelectorAll('*').forEach((child) => processElement(child))
        }
      }
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        processElement(mutation.target)
      }
    }
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      processExisting()
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['src', 'href', 'data', 'srcset'],
      })
    })
  } else {
    processExisting()
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'href', 'data', 'srcset'],
    })
  }

   return {
     restore() {
       window.fetch = originalFetch
       XMLHttpRequest.prototype.open = originalXHROpen
       XMLHttpRequest.prototype.send = originalXHRSend
       XMLHttpRequest.prototype.setRequestHeader = originalXHRSetRequestHeader
       ;(window as any).Worker = OriginalWorker
       if (originalSendBeacon) navigator.sendBeacon = originalSendBeacon
       ;(window as any).EventSource = OriginalEventSource
       document.removeEventListener('click', onDocumentClick, true)
       document.removeEventListener('submit', onFormSubmit, true)
       observer.disconnect()
       for (const blobUrl of blobCache.values()) URL.revokeObjectURL(blobUrl)
       blobCache.clear()
       blobPending.clear()
     },
   }
}

// ── Iframe mode (self-contained script) ──────────────────────────────────────

/**
 * Generate the bridge script source code for injection into iframes.
 * The returned string is self-contained JS that patches fetch/XHR/DOM
 * resource loading to route through postMessage to the parent frame.
 */
export function generateBridgeScript(): string {
  return `(${iframeBridgeRuntime.toString()})();`
}

/**
 * Self-contained runtime for iframe mode.
 * Serialized and injected — must not reference external variables.
 */
function iframeBridgeRuntime() {
  const _originalFetch = window.fetch.bind(window)
  const _originalXHROpen = XMLHttpRequest.prototype.open
  const _originalXHRSend = XMLHttpRequest.prototype.send
  let _counter = 0
  const _pending = new Map<string, { resolve: (r: any) => void; reject: (e: Error) => void }>()
  const _blobCache = new Map<string, string>()
  const _blobPending = new Map<string, Promise<string>>()

  function shouldIntercept(url: string): boolean {
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return false
    if (url.startsWith('/') || !url.includes('://')) return true
    if (url.startsWith('css://')) return true
    return false
  }

  function normalizePath(url: string): string {
    if (url.startsWith('css://')) {
      try { return new URL(url.replace('css://', 'http://')).pathname } catch { return url }
    }
    if (url.startsWith('/')) return url
    try { return new URL(url, window.location.href).pathname } catch { return '/' + url }
  }

  function bridgeFetch(method: string, path: string, headers: Record<string, string>, body: string | null): Promise<any> {
    const id = `bridge-${++_counter}`
    return new Promise((resolve, reject) => {
      _pending.set(id, { resolve, reject })
      window.parent.postMessage({ type: 'plat-fetch', id, method, path, headers, body }, '*')
      setTimeout(() => {
        if (_pending.has(id)) { _pending.delete(id); reject(new Error(`Timeout: ${method} ${path}`)) }
      }, 30000)
    })
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return
    const data = e.data
    if (!data || data.type !== 'plat-fetch-response' || typeof data.id !== 'string') return
    const p = _pending.get(data.id)
    if (!p) return
    _pending.delete(data.id)
    const body = data.body
    const isBodySupported = typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body)
    if (!isBodySupported) {
      p.reject(new Error('Invalid bridge response body'))
      return
    }
    p.resolve(data)
  })

  function decodeBridgeBody(body: unknown): Uint8Array {
    if (body instanceof ArrayBuffer) return new Uint8Array(body)
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    if (typeof body === 'string') {
      const normalized = body.replace(/-/g, '+').replace(/_/g, '/')
      const padLength = (4 - (normalized.length % 4)) % 4
      const padded = normalized + '='.repeat(padLength)
      try {
        const s = atob(padded)
        const a = new Uint8Array(s.length)
        for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i)
        return a
      } catch {
        // Some hosts may still send plain text payloads instead of base64.
        return new TextEncoder().encode(body)
      }
    }
    throw new Error('Unsupported bridge response body type')
  }

  // Patch fetch
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const isRequestInput = typeof Request !== 'undefined' && input instanceof Request
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!shouldIntercept(url)) return _originalFetch(input, init)
    const method = (init?.method ?? (isRequestInput ? input.method : undefined) ?? 'GET').toUpperCase()
    const path = normalizePath(url)
    const headers: Record<string, string> = {}
    const headerSource = init?.headers ?? (isRequestInput ? input.headers : undefined)
    if (headerSource) {
      const h = new Headers(headerSource)
      h.forEach((v, k) => { headers[k] = v })
    }
    const body = init?.body ? (typeof init.body === 'string' ? init.body : null) : null
    const resp = await bridgeFetch(method, path, headers, body)
    const bytes = decodeBridgeBody(resp.body)
    const rh: Record<string, string> = { ...resp.headers }
    if (resp.contentType) rh['content-type'] = resp.contentType
    return new Response(bytes as any, { status: resp.status, statusText: resp.statusText, headers: rh })
  } as typeof window.fetch

  // Patch XHR
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string, async_?: boolean, user?: string | null, password?: string | null) {
    (this as any)._pUrl = shouldIntercept(url) ? url : null;
    (this as any)._pMethod = method
    if (!(this as any)._pUrl) return _originalXHROpen.call(this, method, url, async_ ?? true, user ?? null, password ?? null)
    _originalXHROpen.call(this, method, 'about:blank', async_ ?? true, user ?? null, password ?? null)
  } as typeof XMLHttpRequest.prototype.open

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    if (!(this as any)._pUrl) return _originalXHRSend.call(this, body)
    const xhr = this, path = normalizePath((this as any)._pUrl), method = (this as any)._pMethod || 'GET'
    bridgeFetch(method, path, {}, body ? String(body) : null).then((r: any) => {
      const text = new TextDecoder().decode(decodeBridgeBody(r.body))
      Object.defineProperty(xhr, 'status', { value: r.status, configurable: true })
      Object.defineProperty(xhr, 'statusText', { value: r.statusText, configurable: true })
      Object.defineProperty(xhr, 'responseText', { value: text, configurable: true })
      Object.defineProperty(xhr, 'response', { value: text, configurable: true })
      Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true })
      xhr.dispatchEvent(new Event('readystatechange'))
      xhr.dispatchEvent(new Event('load'))
      xhr.dispatchEvent(new Event('loadend'))
    }).catch(() => { xhr.dispatchEvent(new Event('error')); xhr.dispatchEvent(new Event('loadend')) })
  } as typeof XMLHttpRequest.prototype.send

  // Resource element rewriting
  const ATTRS: Array<[string, string]> = [
    ['img', 'src'], ['script', 'src'], ['link', 'href'], ['audio', 'src'],
    ['video', 'src'], ['source', 'src'], ['source', 'srcset'],
    ['iframe', 'src'], ['embed', 'src'], ['object', 'data'],
  ]

  async function rewrite(el: Element, attr: string) {
    const url = el.getAttribute(attr)
    if (!url || !shouldIntercept(url)) return
    const path = normalizePath(url)
    if (_blobCache.has(path)) { el.setAttribute(attr, _blobCache.get(path)!); return }
    if (_blobPending.has(path)) { el.setAttribute(attr, await _blobPending.get(path)!); return }
    const p = (async () => {
      try {
        const r = await bridgeFetch('GET', path, {}, null)
        if (!r.ok) return url
        const blob = new Blob([decodeBridgeBody(r.body) as any], { type: r.contentType || 'application/octet-stream' })
        const bu = URL.createObjectURL(blob)
        _blobCache.set(path, bu)
        return bu
      } catch { return url } finally { _blobPending.delete(path) }
    })()
    _blobPending.set(path, p)
    el.setAttribute(attr, await p)
  }

  function processEl(el: Element) {
    const t = el.tagName.toLowerCase()
    for (const [tag, attr] of ATTRS) { if (t === tag && el.hasAttribute(attr)) void rewrite(el, attr) }
  }

  function processAll() {
    for (const [tag, attr] of ATTRS) {
      document.querySelectorAll(`${tag}[${attr}]`).forEach((el: Element) => void rewrite(el, attr))
    }
  }

  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (let i = 0; i < m.addedNodes.length; i++) {
        const n = m.addedNodes[i]!
        if (n instanceof Element) { processEl(n); n.querySelectorAll('*').forEach((c) => processEl(c)) }
      }
      if (m.type === 'attributes' && m.target instanceof Element) processEl(m.target)
    }
  })

   const startObs = () => {
     processAll()
     obs.observe(document.documentElement, {
       childList: true, subtree: true, attributes: true,
       attributeFilter: ['src', 'href', 'data', 'srcset'],
     })
   }
   if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObs)
   else startObs()

   // Form submission interception for iframe
   window.addEventListener('submit', (e: Event) => {
     const form = e.target as HTMLFormElement
     if (!form || !(form instanceof HTMLFormElement)) return
     const action = form.getAttribute('action') || window.location.pathname
     if (action.startsWith('data:') || action.startsWith('blob:') || action.startsWith('javascript:')) return
     if (action.startsWith('/') || !action.includes('://') || action.startsWith('css://')) {
       e.preventDefault()
       const method = (form.getAttribute('method') || 'GET').toUpperCase()
       const path = normalizePath(action)
       const fd = new FormData(form)
       const body = new URLSearchParams(fd as any).toString()
       bridgeFetch(method, path, {}, body)
     }
   }, true)

   // <a> click interception — delegate navigation to parent frame instead of letting
   // the browser attempt a native navigation (which fails for srcdoc-loaded iframes).
   document.addEventListener('click', function(e: MouseEvent) {
     if (e.defaultPrevented || e.button !== 0) return
     if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
     const anchor = (e.target as Element).closest?.('a[href]')
     if (!anchor) return
     const target = (anchor as HTMLAnchorElement).target
     if (target && target !== '_self') return
     const href = anchor.getAttribute('href')
     if (!href || !shouldIntercept(href)) return
     e.preventDefault()
     const path = normalizePath(href)
     // Tell the parent BrowserView to navigate to this path
     window.parent.postMessage({ type: 'plat-navigate', path }, '*')
   }, true)
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function shouldIntercept(url: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return false
  if (url.startsWith('/') || !url.includes('://')) return true
  if (url.startsWith('css://')) return true
  return false
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
    const parsed = new URL(url, window.location.href)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return '/' + url
  }
}

function normalizePathWithBase(url: string, basePath: string): string {
  if (url.startsWith('/')) return url
  const baseDir = basePath.replace(/\/[^/]*$/, '/')
  try {
    const parsed = new URL(url, `http://localhost${baseDir}`)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return normalizePath(url)
  }
}

function coerceXHRBody(body?: Document | XMLHttpRequestBodyInit | null): BodyInit | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)
    || body instanceof URLSearchParams || body instanceof FormData || body instanceof ReadableStream) {
    return body as BodyInit
  }
  if (body instanceof Document) {
    return new XMLSerializer().serializeToString(body)
  }
  return String(body)
}
