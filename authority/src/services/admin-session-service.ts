import { createHmac, timingSafeEqual } from 'node:crypto'

export interface AdminSession {
  token: string
  googleSub: string
  roles: string[]
  expiresAt: number
}

export interface AdminSessionServiceOptions {
  ttlSeconds?: number
  secret?: string
}

export class AdminSessionService {
  private readonly ttlSeconds: number
  private readonly secret: string

  constructor(options: AdminSessionServiceOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? 12 * 60 * 60
    this.secret = options.secret ?? 'dev-admin-session-secret-change-me'
    if (!this.secret.trim()) {
      throw new Error('AdminSessionService secret must not be empty')
    }
  }

  private encodeBase64Url(input: string): string {
    return Buffer.from(input, 'utf8').toString('base64url')
  }

  private decodeBase64Url(input: string): string {
    return Buffer.from(input, 'base64url').toString('utf8')
  }

  private sign(unsignedToken: string): string {
    return createHmac('sha256', this.secret).update(unsignedToken).digest('base64url')
  }

  issueSession(googleSub: string, roles: string[] = ['admin'], profile?: { email?: string; name?: string; picture?: string }): AdminSession {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const expiresAt = (nowSeconds + this.ttlSeconds) * 1000
    const header = this.encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = this.encodeBase64Url(
      JSON.stringify({
        sub: googleSub,
        roles,
        ...(profile?.email ? { email: profile.email } : {}),
        ...(profile?.name ? { name: profile.name } : {}),
        ...(profile?.picture ? { picture: profile.picture } : {}),
        iat: nowSeconds,
        exp: nowSeconds + this.ttlSeconds,
      }),
    )
    const unsignedToken = `${header}.${payload}`
    const token = `${unsignedToken}.${this.sign(unsignedToken)}`
    const session: AdminSession = {
      token,
      googleSub,
      roles,
      expiresAt,
    }
    return session
  }

  verifySession(token: string): AdminSession | null {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return null
    }

    const [headerPart, payloadPart, signaturePart] = parts
    if (!headerPart || !payloadPart || !signaturePart) {
      return null
    }

    const unsignedToken = `${headerPart}.${payloadPart}`
    const expectedSignature = this.sign(unsignedToken)
    const signatureBuffer = Buffer.from(signaturePart)
    const expectedBuffer = Buffer.from(expectedSignature)
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return null
    }

    try {
      const payload = JSON.parse(this.decodeBase64Url(payloadPart)) as {
        sub?: string
        roles?: string[]
        exp?: number
      }

      if (!payload.sub || !Array.isArray(payload.roles) || typeof payload.exp !== 'number') {
        return null
      }

      if (payload.exp * 1000 <= Date.now()) {
        return null
      }

      return {
        token,
        googleSub: payload.sub,
        roles: payload.roles,
        expiresAt: payload.exp * 1000,
      }
    } catch {
      return null
    }
  }
}
