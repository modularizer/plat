/**
 * Environment variable configuration loader
 * Uses dotenv to load variables from .env file
 */

import dotenv from 'dotenv'

// Load .env file
dotenv.config()

export interface ServerEnvConfig {
  port: number
  host: string
  protocol: string
  errorExposure: 'none' | 'message' | 'full'
  jwtSecret?: string
  cors: boolean
  swagger: boolean
  redoc: boolean
  defaultAuth: string
  rateLimitMaxBalance: number
  rateLimitFillInterval: number
  rateLimitFillAmount: number
  rateLimitHeaders: boolean
  tokenLimitMaxBalance: number
  tokenLimitFillInterval: number
  tokenLimitFillAmount: number
  tokenCostHeader: boolean
  cacheHeader: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  nodeEnv: 'development' | 'production' | 'test'
}

/**
 * Parse boolean from environment variable
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue
  return value.toLowerCase() === 'true' || value === '1' || value === 'yes'
}

/**
 * Parse number from environment variable
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  const num = parseInt(value, 10)
  return isNaN(num) ? defaultValue : num
}

/**
 * Load and parse server configuration from environment variables
 */
export function loadServerConfig(): ServerEnvConfig {
  return {
    port: parseNumber(process.env.PLAT_SERVER_PORT, 3000),
    host: process.env.PLAT_SERVER_HOST || 'localhost',
    protocol: process.env.PLAT_PROTOCOL || 'http',
    errorExposure: (process.env.PLAT_ERROR_EXPOSURE as any) || 'message',
    jwtSecret: process.env.JWT_SECRET,
    cors: process.env.PLAT_CORS ? parseBoolean(process.env.PLAT_CORS, true) : true,
    swagger: process.env.PLAT_SWAGGER ? parseBoolean(process.env.PLAT_SWAGGER, true) : true,
    redoc: process.env.PLAT_REDOC ? parseBoolean(process.env.PLAT_REDOC, true) : true,
    defaultAuth: process.env.PLAT_DEFAULT_AUTH || 'public',
    rateLimitMaxBalance: parseNumber(process.env.PLAT_RATE_LIMIT_MAX_BALANCE, 100),
    rateLimitFillInterval: parseNumber(process.env.PLAT_RATE_LIMIT_FILL_INTERVAL, 1000),
    rateLimitFillAmount: parseNumber(process.env.PLAT_RATE_LIMIT_FILL_AMOUNT, 10),
    rateLimitHeaders: parseBoolean(process.env.PLAT_RATE_LIMIT_HEADERS, true),
    tokenLimitMaxBalance: parseNumber(process.env.PLAT_TOKEN_LIMIT_MAX_BALANCE, 10000),
    tokenLimitFillInterval: parseNumber(process.env.PLAT_TOKEN_LIMIT_FILL_INTERVAL, 1000),
    tokenLimitFillAmount: parseNumber(process.env.PLAT_TOKEN_LIMIT_FILL_AMOUNT, 100),
    tokenCostHeader: parseBoolean(process.env.PLAT_TOKEN_COST_HEADER, true),
    cacheHeader: parseBoolean(process.env.PLAT_CACHE_HEADER, true),
    logLevel: (process.env.PLAT_LOG_LEVEL as any) || 'info',
    nodeEnv: (process.env.NODE_ENV as any) || 'development',
  }
}

/**
 * Get JWT configuration from environment
 */
export function getJwtConfig() {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set')
  }

  return {
    secret,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  }
}
