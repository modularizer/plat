/**
 * Plugin Architecture: Rate Limits, Token Limits, Caching
 */

// ============================================================================
// SHARED TYPES
// ============================================================================

export interface BucketConfig {
  maxBalance: number
  fillInterval: number // milliseconds between refills
  fillAmount: number // tokens to add per interval
  refundedStatusCodes?: number[] // refund deducted cost when response matches
  refundSuccessful?: boolean // shorthand: refund on any 2xx (cost pre-deducted)
  minBalance?: number // <= 0; enables overdraft. defaults to 0
}

// ============================================================================
// RATE LIMIT TYPES
// ============================================================================

export interface RateLimitEntry {
  key?: string // default ':route'. Supports :route, :parent substitutions
  cost?: number // default 1
  config?: BucketConfig // inline; server named config takes priority
}

export type RateLimitMeta = RateLimitEntry | RateLimitEntry[]

export interface ResolvedRateLimitEntry {
  key: string // fully substituted
  cost: number
  config: BucketConfig
}

export interface RateLimitContext {
  entries: ResolvedRateLimitEntry[]
  remainingBalances: number[]
}

export interface RateLimitController {
  // Non-mutating balance check (for observability / pre-checks)
  check(key: string, config: BucketConfig): Promise<number> | number
  // Deduct cost atomically. Throws HttpError(429, ..., { retryAfterMs }) if balance - cost < minBalance
  deduct(
    key: string,
    cost: number,
    config: BucketConfig
  ): Promise<number> | number
  // Return cost to the bucket (capped at maxBalance)
  refund(
    key: string,
    cost: number,
    config: BucketConfig
  ): Promise<void> | void
}

// ============================================================================
// TOKEN LIMIT TYPES
// ============================================================================

export interface TokenCallCostFormula {
  initial?: number
  perLimit?: number
  perChar?: number
}

export interface TokenResponseCostFormula {
  perMs?: number
  perItem?: number
  perChar?: number
  perKey?: number
}

export interface TokenLimitEntry {
  key?: string
  // Cost deducted BEFORE handler. Default 1.
  callCost?:
    | number
    | TokenCallCostFormula
    | ((params: any, ctx: any) => number | Promise<number>)
  // Additional cost deducted AFTER successful handler. Default 0.
  responseCost?:
    | number
    | TokenResponseCostFormula
    | ((
        result: any,
        timing: TokenLimitTiming,
        params: any
      ) => number | Promise<number>)
  // Cost deducted (or negative = refund) when handler throws/returns 4xx/5xx. Default 0.
  failureCost?:
    | number
    | ((
        error: Error,
        timing: TokenLimitTiming,
        params: any
      ) => number | Promise<number>)
  config?: BucketConfig
}

export type TokenLimitMeta = TokenLimitEntry | TokenLimitEntry[]

export interface TokenLimitTiming {
  startMs: number
  endMs: number
  durationMs: number
}

export interface ResolvedTokenLimitEntry {
  key: string
  callCost: number // resolved numeric value (stored for potential refund)
  responseCostSpec: TokenLimitEntry['responseCost']
  failureCostSpec: TokenLimitEntry['failureCost']
  config: BucketConfig
}

export interface TokenLimitContext {
  entries: ResolvedTokenLimitEntry[]
  remainingBalances: number[]
  responseCosts?: number[]
  failureCosts?: number[]
  timing?: TokenLimitTiming
}

export interface TokenLimitController {
  // Non-mutating balance check
  check(key: string, config: BucketConfig): Promise<number> | number
  // Deduct callCost before handler. Throws HttpError(429, ..., { retryAfterMs }) if insufficient
  deduct(
    key: string,
    cost: number,
    config: BucketConfig
  ): Promise<number> | number
  // Refund cost (e.g. on refundedStatusCodes match or negative failureCost)
  refund(
    key: string,
    cost: number,
    config: BucketConfig
  ): Promise<void> | void
}

// ============================================================================
// CACHE TYPES
// ============================================================================

export interface CacheEntry {
  key: string // template: :route, :parent, {paramName}
  ttl?: number // seconds; undefined = no expiry
  methods?: string[] // default ['GET']
}

export type CacheMeta = CacheEntry | CacheEntry[]

export interface CacheContext {
  key: string | null
  hit: boolean
  stored: boolean
}

// ============================================================================
// CONFIG TYPE EXPORTS
// ============================================================================

export type RateLimitConfigs = Record<string, BucketConfig>
export type TokenLimitConfigs = Record<string, BucketConfig>

export interface CacheController {
  get(key: string): Promise<any> | any
  set(key: string, value: any, ttlSeconds?: number): Promise<void> | void
  clear(key: string): Promise<void> | void // exact key clear (pattern matching left to implementations)
}
