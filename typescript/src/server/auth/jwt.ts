import jwt from 'jsonwebtoken'
import type { AuthMode } from '../../types/endpoints'
import { HttpError } from '../../types'

export interface JwtAuthConfig {
  secret: string
  algorithms?: string[]
  issuer?: string
  audience?: string
  expiresIn?: string | number
  refreshExpiresIn?: string | number
  getToken?: (req: any) => string | undefined
}

export interface AuthHandler {
  verify(mode: AuthMode, req: any, ctx: any): Promise<any> | any
}

/**
 * Extract token from request using standard Bearer pattern
 * Supports custom token extraction via config.getToken
 */
function extractToken(req: any, config: JwtAuthConfig): string | undefined {
  if (config.getToken) {
    return config.getToken(req)
  }

  const authHeader = req.headers?.authorization
  if (!authHeader) {
    return undefined
  }

  const headerStr = typeof authHeader === 'string' ? authHeader : Array.isArray(authHeader) ? authHeader[0] : undefined
  if (!headerStr) {
    return undefined
  }

  const parts = headerStr.split(' ')
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1]
  }

  return undefined
}

/**
 * Sign a JWT token
 */
export function signToken(payload: any, config: JwtAuthConfig): string {
  const options: any = {
    expiresIn: config.expiresIn ?? '1h',
  }
  if (config.issuer) {
    options.issuer = config.issuer
  }
  if (config.audience) {
    options.audience = config.audience
  }
  if (config.algorithms) {
    options.algorithm = config.algorithms[0]
  }
  return jwt.sign(payload, config.secret, options)
}

/**
 * Sign a refresh token
 */
export function signRefreshToken(payload: any, config: JwtAuthConfig): string {
  const options: any = {
    expiresIn: config.refreshExpiresIn ?? '7d',
  }
  if (config.issuer) {
    options.issuer = config.issuer
  }
  if (config.audience) {
    options.audience = config.audience
  }
  if (config.algorithms) {
    options.algorithm = config.algorithms[0]
  }
  return jwt.sign(payload, config.secret, options)
}

/**
 * Create a JWT auth handler
 */
export function createJwtAuth(config: JwtAuthConfig): AuthHandler {
  const algorithms = config.algorithms ?? ['HS256']

  return {
    verify(mode: AuthMode, req: any, ctx: any): any {
      // Only verify if mode is 'jwt'
      if (mode !== 'jwt') {
        return undefined
      }

      const token = extractToken(req, config)
      if (!token) {
        throw new HttpError(401, 'Missing or invalid authorization token')
      }

      try {
        const options: any = {
          issuer: config.issuer,
          audience: config.audience,
        }
        if (algorithms && algorithms.length > 0) {
          options.algorithms = algorithms
        }
        const payload = jwt.verify(token, config.secret, options)
        return payload
      } catch (err: any) {
        const statusCode = err.name === 'TokenExpiredError' ? 401 : 401
        throw new HttpError(statusCode, 'Invalid or expired token')
      }
    },
  }
}

export type { AuthMode } from '../../types/endpoints'
