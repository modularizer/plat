/**
 * plat API Client (JavaScript)
 *
 * Auto-generated from openapi.json — DO NOT EDIT
 * Regenerate with: npx tsx scripts/gen-client-js.ts
 *
 * Zero dependencies — uses native fetch.
 */

// ── API Client ──────────────────────────────────────────

export class ApiClient {
  /** @type {string} */ #baseUrl
  /** @type {Record<string, string>} */ #headers
  /** @type {number} */ #timeout
  /** @type {number} */ #retries
  /** @type {number} */ #backoff

  /**
   * @param {Object} [options]
   * @param {string} [options.baseUrl='http://localhost:3000']
   * @param {Record<string, string>} [options.headers]
   * @param {number} [options.timeout=30000]
   * @param {number} [options.retries=3]
   * @param {number} [options.backoff=500] - base backoff in ms, doubles each retry
   */
  constructor(options = {}) {
    this.#baseUrl = (options.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '')
    this.#headers = { 'Content-Type': 'application/json', ...options.headers }
    this.#timeout = options.timeout ?? 30000
    this.#retries = options.retries ?? 3
    this.#backoff = options.backoff ?? 500
  }

  async #request(method, path, opts) {
    let url = this.#baseUrl + path
    if (opts?.params) {
      const qs = Object.entries(opts.params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
      if (qs) url += '?' + qs
    }
    const retryable = new Set([429, 500, 502, 503, 504])
    let lastErr
    for (let attempt = 0; attempt <= this.#retries; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: { ...this.#headers, ...opts?.headers },
          body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.#timeout),
        })
        if (!retryable.has(res.status) || attempt === this.#retries) {
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`${method} ${path} failed (${res.status}): ${text}`)
          }
          return res.json()
        }
        lastErr = new Error(`${method} ${path} returned ${res.status}`)
      } catch (err) {
        if (attempt === this.#retries) throw err
        lastErr = err
      }
      const delay = this.#backoff * (2 ** attempt) + Math.random() * this.#backoff
      await new Promise(r => setTimeout(r, delay))
    }
    throw lastErr
  }

}

/**
 * @param {Object} [options]
 * @param {string} [options.baseUrl]
 * @param {Record<string, string>} [options.headers]
 * @param {number} [options.timeout]
 * @returns {ApiClient}
 */
export function createApiClient(options) {
  return new ApiClient(options)
}
