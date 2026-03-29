/**
 * JWT Helper for CLI tool
 * Enables CLI to generate and use JWT tokens for authentication
 */

import dotenv from 'dotenv'
import { signToken } from '../server/auth/jwt'

// Load .env file
dotenv.config()

export interface JwtPayload {
  [key: string]: any
}

/**
 * Generate a JWT token from CLI arguments
 * Usage: plat-jwt --user-id=123 --role=admin
 */
export function generateJwtFromCliArgs(args: string[]): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is not set. ' +
      'Please set JWT_SECRET in your .env file or environment.'
    )
  }

  // Parse arguments into payload
  const payload: JwtPayload = {}
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const parts = arg.slice(2).split('=')
      const key = parts[0]
      if (!key) continue // Skip if no key

      const value = parts.slice(1).join('=') // In case value contains '='
      if (!value) {
        payload[key] = true
      } else {
        // Try to parse as JSON, otherwise treat as string
        try {
          payload[key] = JSON.parse(value)
        } catch {
          payload[key] = value
        }
      }
    }
  }

  const expiresIn = process.env.JWT_EXPIRES_IN || '24h'
  return signToken(payload, { secret, expiresIn })
}

/**
 * Create an auth header value for API requests
 */
export function getAuthHeader(token: string): string {
  return `Bearer ${token}`
}

/**
 * Get JWT credentials from environment
 * Returns null if JWT_SECRET is not set
 */
export function getJwtCredentials(): {
  secret: string
  expiresIn: string
} | null {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    return null
  }

  return {
    secret,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  }
}

/**
 * Parse and validate a JWT token (basic validation)
 */
export function parseJwtToken(token: string): { header: any; payload: any } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !parts[0] || !parts[1]) {
      return null
    }

    const headerStr = Buffer.from(parts[0], 'base64').toString('utf-8')
    const payloadStr = Buffer.from(parts[1], 'base64').toString('utf-8')

    const header = JSON.parse(headerStr)
    const payload = JSON.parse(payloadStr)

    return { header, payload }
  } catch {
    return null
  }
}
