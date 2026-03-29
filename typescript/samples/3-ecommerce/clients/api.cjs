/**
 * plat API Client (JavaScript — CommonJS)
 *
 * Auto-generated from openapi.json — DO NOT EDIT
 * Regenerate with: npx tsx scripts/gen-client-js.ts
 *
 * Zero dependencies — uses native fetch.
 */

// ── Data Models ──────────────────────────────────────────

/**
 * @typedef {Object} Product
 * @property {number} id
 * @property {string} name
 * @property {string} description
 * @property {number} price
 * @property {string} category
 * @property {boolean} inStock
 * @property {number} quantity
 */

/**
 * @typedef {Object} CartItem
 * @property {number} productId
 * @property {number} quantity
 * @property {number} priceAtAdded
 */

/**
 * @typedef {Object} Cart
 * @property {string} userId
 * @property {CartItem[]} items
 * @property {number} subtotal
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} userId
 * @property {CartItem[]} items
 * @property {number} total
 * @property {'pending' | 'processing' | 'shipped' | 'delivered'} status
 * @property {string} createdAt
 */

// ── API Client ──────────────────────────────────────────

class ApiClient {

  /**
   * @param {Object} [options]
   * @param {string} [options.baseUrl='http://localhost:3000']
   * @param {Record<string, string>} [options.headers]
   * @param {number} [options.timeout=30000]
   * @param {number} [options.retries=3]
   * @param {number} [options.backoff=500] - base backoff in ms, doubles each retry
   */
  constructor(options = {}) {
    this._baseUrl = (options.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '')
    this._headers = { 'Content-Type': 'application/json', ...options.headers }
    this._timeout = options.timeout ?? 30000
    this._retries = options.retries ?? 3
    this._backoff = options.backoff ?? 500
  }

  async _request(method, path, opts) {
    let url = this._baseUrl + path
    if (opts?.params) {
      const qs = Object.entries(opts.params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
      if (qs) url += '?' + qs
    }
    const retryable = new Set([429, 500, 502, 503, 504])
    let lastErr
    for (let attempt = 0; attempt <= this._retries; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: { ...this._headers, ...opts?.headers },
          body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this._timeout),
        })
        if (!retryable.has(res.status) || attempt === this._retries) {
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`${method} ${path} failed (${res.status}): ${text}`)
          }
          return res.json()
        }
        lastErr = new Error(`${method} ${path} returned ${res.status}`)
      } catch (err) {
        if (attempt === this._retries) throw err
        lastErr = err
      }
      const delay = this._backoff * (2 ** attempt) + Math.random() * this._backoff
      await new Promise(r => setTimeout(r, delay))
    }
    throw lastErr
  }

  /**
   * @param {string} [input.category]
   * @param {boolean} [input.inStock]
   * @param {number} [input.limit]
   * @param {number} [input.offset]
   */
  async listProducts(input = {}) {
    return this._request('GET', '/products/listProducts', { params: input })
  }

  /**
   * @param {number} input.id
   */
  async getProduct(input) {
    return this._request('GET', '/products/getProduct', { params: input })
  }

  /**
   * @param {string} input.q
   * @param {number} [input.limit]
   */
  async searchProducts(input) {
    return this._request('GET', '/products/searchProducts', { params: input })
  }

  /**
   * @param {string} input.userId
   */
  async getCart(input) {
    return this._request('GET', '/orders/getCart', { params: input })
  }

  /**
   * @param {string} input.userId
   * @param {number} input.productId
   * @param {number} input.quantity
   */
  async addToCart(input) {
    return this._request('POST', '/orders/addToCart', { body: input })
  }

  /**
   * @param {string} input.userId
   */
  async checkout(input) {
    return this._request('POST', '/orders/checkout', { body: input })
  }

  /**
   * @param {string} input.userId
   * @param {number} [input.limit]
   * @param {number} [input.offset]
   */
  async listOrders(input) {
    return this._request('GET', '/orders/listOrders', { params: input })
  }

  /**
   * @param {string} input.id
   */
  async getOrder(input) {
    return this._request('GET', '/orders/getOrder', { params: input })
  }

}

/**
 * @param {Object} [options]
 * @param {string} [options.baseUrl]
 * @param {Record<string, string>} [options.headers]
 * @param {number} [options.timeout]
 * @returns {ApiClient}
 */
function createApiClient(options) {
  return new ApiClient(options)
}

module.exports = { ApiClient, createApiClient }
