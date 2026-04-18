import { OAuth2Client, type TokenPayload } from 'google-auth-library'

export interface GoogleIdTokenServiceOptions {
  /**
   * Allowed audience value(s) — the Google client ID(s) that tokens must be
   * issued to. Tokens with a different `aud` claim are rejected.
   */
  audience: string | string[]
  /**
   * Allowed `hd` (hosted domain) claims. If set, only ID tokens from these
   * Google Workspace domains are accepted.
   */
  allowedHostedDomains?: string[]
}

export interface GoogleIdTokenProfile {
  sub: string
  email?: string
  emailVerified?: boolean
  name?: string
  picture?: string
  hd?: string
}

export class GoogleOAuthError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: string

  constructor(code: string, status: number, message: string, details?: string) {
    super(message)
    this.name = 'GoogleOAuthError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export class GoogleIdTokenService {
  private readonly audience: string | string[]
  private readonly allowedHostedDomains: Set<string>
  private readonly client: OAuth2Client

  constructor(options: GoogleIdTokenServiceOptions) {
    if (!options.audience || (Array.isArray(options.audience) && options.audience.length === 0)) {
      throw new Error('GoogleIdTokenService requires at least one audience')
    }
    this.audience = options.audience
    this.allowedHostedDomains = new Set(options.allowedHostedDomains ?? [])
    this.client = new OAuth2Client()
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdTokenProfile> {
    const trimmed = idToken.trim()
    if (!trimmed) {
      throw new GoogleOAuthError('oauth_id_token_missing', 400, 'ID token is empty')
    }

    let payload: TokenPayload | undefined
    try {
      const ticket = await this.client.verifyIdToken({ idToken: trimmed, audience: this.audience })
      payload = ticket.getPayload()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ID token verification failed'
      throw new GoogleOAuthError('oauth_id_token_invalid', 401, message)
    }

    if (!payload) {
      throw new GoogleOAuthError('oauth_id_token_invalid', 401, 'ID token payload missing')
    }
    if (!payload.sub) {
      throw new GoogleOAuthError('oauth_id_token_missing_sub', 401, 'ID token payload missing sub')
    }
    if (this.allowedHostedDomains.size > 0 && (!payload.hd || !this.allowedHostedDomains.has(payload.hd))) {
      throw new GoogleOAuthError('oauth_id_token_hd_not_allowed', 403, 'ID token hd claim is not allowed')
    }

    return {
      sub: payload.sub,
      ...(payload.email ? { email: payload.email } : {}),
      ...(typeof payload.email_verified === 'boolean' ? { emailVerified: payload.email_verified } : {}),
      ...(payload.name ? { name: payload.name } : {}),
      ...(payload.picture ? { picture: payload.picture } : {}),
      ...(payload.hd ? { hd: payload.hd } : {}),
    }
  }
}
