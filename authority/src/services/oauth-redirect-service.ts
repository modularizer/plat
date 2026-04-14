import { randomUUID } from 'node:crypto'

export interface OAuthRedirectServiceOptions {
  stateTtlMs?: number
  allowedRedirectOrigins?: string[]
}

interface OAuthStateEntry {
  redirectUri?: string
  role: 'admin' | 'user'
  createdAt: number
}

export class OAuthRedirectService {
  private readonly stateTtlMs: number
  private readonly allowedRedirectOrigins: string[]
  private readonly stateStore = new Map<string, OAuthStateEntry>()

  constructor(options: OAuthRedirectServiceOptions = {}) {
    this.stateTtlMs = options.stateTtlMs ?? 10 * 60 * 1000
    this.allowedRedirectOrigins = options.allowedRedirectOrigins ?? []
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [state, entry] of this.stateStore.entries()) {
      if (entry.createdAt + this.stateTtlMs <= now) {
        this.stateStore.delete(state)
      }
    }
  }

  private isRedirectAllowed(redirectUri: string): boolean {
    if (this.allowedRedirectOrigins.length === 0) {
      return true
    }

    let origin: string
    try {
      origin = new URL(redirectUri).origin
    } catch {
      return false
    }

    return this.allowedRedirectOrigins.includes(origin)
  }

  createState(redirectUri?: string, role: 'admin' | 'user' = 'user'): string {
    this.cleanup()

    if (redirectUri && !this.isRedirectAllowed(redirectUri)) {
      throw new Error('redirect_uri origin is not allowed')
    }

    const state = randomUUID()
    this.stateStore.set(state, {
      redirectUri,
      role,
      createdAt: Date.now(),
    })
    return state
  }

  consumeState(state: string): OAuthStateEntry {
    this.cleanup()

    const entry = this.stateStore.get(state)
    if (!entry) {
      throw new Error('Invalid or expired oauth state')
    }
    this.stateStore.delete(state)
    return entry
  }
}
