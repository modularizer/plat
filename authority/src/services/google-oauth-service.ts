export interface GoogleOAuthServiceOptions {
  clientId: string
  clientSecret: string
  redirectUri: string
  scope?: string
}
export interface GoogleOAuthExchangeResult {
  idToken?: string
  accessToken: string
}
export interface GoogleOAuthProfile {
  sub: string
  email?: string
  name?: string
  picture?: string
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

export class GoogleOAuthService {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly redirectUri: string
  private readonly scope: string
  constructor(options: GoogleOAuthServiceOptions) {
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.redirectUri = options.redirectUri
    this.scope = options.scope ?? 'openid email profile'
  }
  buildAuthorizationUrl(state: string): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('redirect_uri', this.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', this.scope)
    url.searchParams.set('state', state)
    url.searchParams.set('include_granted_scopes', 'true')
    url.searchParams.set('access_type', 'online')
    return url.toString()
  }

  private async readErrorDetails(response: Response): Promise<string | undefined> {
    try {
      const text = (await response.text()).trim()
      if (!text) {
        return undefined
      }
      return text.slice(0, 500)
    } catch {
      return undefined
    }
  }

  async exchangeCode(code: string): Promise<GoogleOAuthExchangeResult> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!response.ok) {
      const details = await this.readErrorDetails(response)
      throw new GoogleOAuthError(
        'oauth_token_exchange_failed',
        response.status,
        `OAuth token exchange failed (${response.status})`,
        details,
      )
    }
    const payload = (await response.json()) as {
      access_token?: string
      id_token?: string
    }
    if (!payload.access_token) {
      throw new GoogleOAuthError(
        'oauth_token_exchange_missing_access_token',
        502,
        'OAuth token exchange response missing access_token',
      )
    }
    return {
      accessToken: payload.access_token,
      idToken: payload.id_token,
    }
  }
  async fetchProfile(accessToken: string): Promise<GoogleOAuthProfile> {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    })
    if (!response.ok) {
      const details = await this.readErrorDetails(response)
      throw new GoogleOAuthError(
        'oauth_profile_fetch_failed',
        response.status,
        `OAuth profile fetch failed (${response.status})`,
        details,
      )
    }
    const payload = (await response.json()) as GoogleOAuthProfile
    if (!payload.sub) {
      throw new GoogleOAuthError(
        'oauth_profile_missing_sub',
        502,
        'OAuth profile response missing sub',
      )
    }
    return payload
  }
}
