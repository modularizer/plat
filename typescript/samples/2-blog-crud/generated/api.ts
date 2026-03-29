/**
 * plat API Client (TypeScript)
 *
 * Auto-generated from openapi.json — DO NOT EDIT
 * Regenerate with: npx tsx scripts/gen-client-openapi.ts
 */

// ── Data Models ──────────────────────────────────────────

export interface Post {
  id: number
  title: string
  content: string
  author: string
  createdAt: string
  updatedAt: string
}

export interface CreatePostInput {
  title: string
  content: string
  author: string
}

export interface UpdatePostInput {
  title?: string
  content?: string
  author?: string
}

export interface PostList {
  posts: Post[]
  total: number
}

// ── Client ──────────────────────────────────────────────

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

export interface ApiClientOptions {
  baseUrl?: string
  headers?: Record<string, string>
  timeout?: number
  /** Number of retries on 429/5xx (default 3) */
  retries?: number
  /** Base backoff in ms, doubles each retry (default 500) */
  backoff?: number
}

export class ApiClient {
  private baseUrl: string
  private headers: Record<string, string>
  private timeout: number
  private retries: number
  private backoff: number

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '')
    this.headers = { 'Content-Type': 'application/json', ...options.headers }
    this.timeout = options.timeout ?? 30000
    this.retries = options.retries ?? 3
    this.backoff = options.backoff ?? 500
  }

  private async request<T>(method: string, path: string, opts?: {
    params?: Record<string, unknown>
    body?: unknown
    headers?: Record<string, string>
  }): Promise<T> {
    let url = this.baseUrl + path
    if (opts?.params) {
      const qs = Object.entries(opts.params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
      if (qs) url += '?' + qs
    }
    let lastErr: Error | undefined
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: { ...this.headers, ...opts?.headers },
          body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(this.timeout),
        })
        if (!RETRYABLE_STATUS.has(res.status) || attempt === this.retries) {
          if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(`${method} ${path} failed (${res.status}): ${text}`)
          }
          return res.json() as Promise<T>
        }
        lastErr = new Error(`${method} ${path} returned ${res.status}`)
      } catch (err) {
        if (attempt === this.retries) throw err
        lastErr = err as Error
      }
      const delay = this.backoff * (2 ** attempt) + Math.random() * this.backoff
      await new Promise(r => setTimeout(r, delay))
    }
    throw lastErr
  }

  async listPosts(input?: { limit?: number; offset?: number }): Promise<PostList> {
    return this.request('GET', '/listPosts', { params: input as Record<string, unknown> })
  }

  async getPost(input: { id: number }): Promise<Post> {
    return this.request('GET', '/getPost', { params: input as Record<string, unknown> })
  }

  async createPost(): Promise<Post> {
    return this.request('POST', '/createPost')
  }

  async updatePost(): Promise<Post> {
    return this.request('PUT', '/updatePost')
  }

  async deletePost(input: { id: number }): Promise<{ success?: boolean; id?: number }> {
    return this.request('DELETE', '/deletePost', { params: input as Record<string, unknown> })
  }

}

export function createApiClient(options?: ApiClientOptions): ApiClient {
  return new ApiClient(options)
}
