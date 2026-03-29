import { HttpError } from "../../types"
import {
  BucketConfig,
  RateLimitController,
  RateLimitEntry,
  RateLimitMeta,
  RateLimitConfigs,
  ResolvedRateLimitEntry,
} from '../../types/plugins'

// ============================================================================
// KEY SUBSTITUTION
// ============================================================================

/**
 * Resolve rate limit key with substitutions:
 * - :route → methodName
 * - :parent → basePath
 * - :user:{field} → user[field] from auth context (e.g., :user:plan, :user:id)
 */
export function resolveRateLimitKey(
  raw: string,
  methodName: string,
  basePath: string,
  user?: any
): string {
  let key = raw
    .replace(':route', methodName)
    .replace(':parent', basePath)

  // Replace :user:{field} with user property
  if (user) {
    const userMatches = key.match(/:user:(\w+)/g)
    if (userMatches) {
      for (const match of userMatches) {
        const field = match.slice(6) // Remove ':user:'
        const value = user[field]
        if (value !== undefined) {
          key = key.replace(match, String(value))
        }
      }
    }
  }

  return key
}

// ============================================================================
// IN-MEMORY IMPLEMENTATION
// ============================================================================

interface BucketState {
  balance: number
  lastRefillMs: number
}

/**
 * Create an in-memory rate limit controller with token-bucket algorithm
 * Lazy fills bucket on each access
 */
export function createInMemoryRateLimit(): RateLimitController {
  const buckets = new Map<string, BucketState>()

  function refillBucket(
    key: string,
    config: BucketConfig
  ): number {
    const now = Date.now()
    let bucket = buckets.get(key)

    if (!bucket) {
      bucket = { balance: config.maxBalance, lastRefillMs: now }
      buckets.set(key, bucket)
      return bucket.balance
    }

    const elapsedMs = now - bucket.lastRefillMs
    const intervalsElapsed = Math.floor(elapsedMs / config.fillInterval)
    if (intervalsElapsed > 0) {
      const tokensGenerated = intervalsElapsed * config.fillAmount
      bucket!.balance = Math.min(config.maxBalance, bucket!.balance + tokensGenerated)
      bucket!.lastRefillMs = now - (elapsedMs % config.fillInterval)
    }

    return bucket!.balance
  }

  return {
    check(key: string, config: BucketConfig): number {
      const balance = refillBucket(key, config)
      return balance
    },

    deduct(
      key: string,
      cost: number,
      config: BucketConfig
    ): number {
      const balance = refillBucket(key, config)
      const minBalance = config.minBalance ?? 0
      const newBalance = balance - cost

      if (newBalance < minBalance) {
        const deficit = minBalance - newBalance
        const intervalsNeeded = Math.ceil(deficit / config.fillAmount)
        const retryAfterMs = intervalsNeeded * config.fillInterval
        throw new HttpError(429, 'Rate limit exceeded', { retryAfterMs })
      }

      const bucket = buckets.get(key)!
      bucket.balance = newBalance
      return newBalance
    },

    refund(
      key: string,
      cost: number,
      config: BucketConfig
    ): void {
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { balance: Math.min(config.maxBalance, cost), lastRefillMs: Date.now() }
        buckets.set(key, bucket)
      } else {
        bucket.balance = Math.min(config.maxBalance, bucket.balance + cost)
      }
    },
  }
}

// ============================================================================
// PIPELINE HELPERS
// ============================================================================

/**
 * Pre-handler: normalize → array, resolve keys, lookup config,
 * call controller.deduct(), return resolved entries + remaining balances
 */
export async function applyRateLimitCheck(
  meta: RateLimitMeta | undefined,
  controller: RateLimitController,
  configs: RateLimitConfigs,
  methodName: string,
  basePath: string,
  user?: any
): Promise<{ entries: ResolvedRateLimitEntry[]; remainingBalances: number[] }> {
  if (!meta) {
    return { entries: [], remainingBalances: [] }
  }

  const entries = Array.isArray(meta) ? meta : [meta]
  const resolved: ResolvedRateLimitEntry[] = []
  const remainingBalances: number[] = []

  for (const entry of entries) {
    const rawKey = entry.key ?? ':route'
    const key = resolveRateLimitKey(rawKey, methodName, basePath, user)
    const cost = entry.cost ?? 1
    const config = entry.config ?? configs[key]

    if (!config) {
      throw new Error(
        `Rate limit config not found for key "${key}". ` +
          `Define it in server.rateLimit.configs or inline in route metadata.`
      )
    }

    const remaining = await controller.deduct(key, cost, config)

    resolved.push({ key, cost, config })
    remainingBalances.push(remaining)
  }

  return { entries: resolved, remainingBalances }
}

/**
 * Post-handler: refund if statusCode in refundedStatusCodes,
 * OR if refundSuccessful && 2xx
 */
export async function applyRateLimitRefund(
  entries: ResolvedRateLimitEntry[],
  controller: RateLimitController,
  statusCode: number
): Promise<void> {
  for (const entry of entries) {
    const shouldRefund =
      (entry.config.refundedStatusCodes?.includes(statusCode)) ||
      (entry.config.refundSuccessful && statusCode >= 200 && statusCode < 300)

    if (shouldRefund) {
      await controller.refund(entry.key, entry.cost, entry.config)
    }
  }
}
