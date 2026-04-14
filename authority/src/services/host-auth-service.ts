export interface VerifiedHostIdentity {
  googleSub: string
}

export interface HostAuthServiceOptions {
  mode?: 'insecure_token_sub' | 'google_tokeninfo'
  googleClientId?: string
  tokenInfoTimeoutMs?: number
  verifySessionToken?: (token: string) => Promise<VerifiedHostIdentity | null> | VerifiedHostIdentity | null
}

export class HostAuthService {
  private readonly mode: 'insecure_token_sub' | 'google_tokeninfo'
  private readonly googleClientId?: string
  private readonly tokenInfoTimeoutMs: number
  private readonly verifySessionToken?: (token: string) => Promise<VerifiedHostIdentity | null> | VerifiedHostIdentity | null

  constructor(options: HostAuthServiceOptions = {}) {
    this.mode = options.mode ?? 'insecure_token_sub'
    this.googleClientId = options.googleClientId
    this.tokenInfoTimeoutMs = options.tokenInfoTimeoutMs ?? 5000
    this.verifySessionToken = options.verifySessionToken

    if (this.mode === 'google_tokeninfo' && !this.googleClientId) {
      throw new Error('GOOGLE_CLIENT_ID is required when HOST_AUTH_MODE=google_tokeninfo')
    }
  }

  async verifyHostToken(token: string): Promise<VerifiedHostIdentity> {
    const trimmed = token.trim()
    if (!trimmed) {
      throw new Error('Host auth token is empty')
    }

    if (this.mode === 'insecure_token_sub') {
      return { googleSub: trimmed }
    }

    if (this.verifySessionToken) {
      const verifiedSession = await this.verifySessionToken(trimmed)
      if (verifiedSession?.googleSub) {
        return verifiedSession
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.tokenInfoTimeoutMs)

    try {
      const url = new URL('https://oauth2.googleapis.com/tokeninfo')
      url.searchParams.set('id_token', trimmed)

      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`Google token verification failed (${response.status})`)
      }

      const payload = (await response.json()) as {
        sub?: string
        aud?: string
        exp?: string
      }

      if (!payload.sub) {
        throw new Error('Google token verification response missing subject')
      }

      if (payload.aud !== this.googleClientId) {
        throw new Error('Google token audience mismatch')
      }

      if (payload.exp && Number(payload.exp) * 1000 <= Date.now()) {
        throw new Error('Google token has expired')
      }

      return { googleSub: payload.sub }
    } finally {
      clearTimeout(timeout)
    }
  }
}
