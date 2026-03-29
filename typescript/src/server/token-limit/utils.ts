import { HttpError } from "../../types"
import {
  BucketConfig,
  TokenCallCostFormula,
  TokenLimitController,
  TokenLimitEntry,
  TokenLimitMeta,
  TokenLimitTiming,
  TokenResponseCostFormula,
  TokenLimitConfigs,
  ResolvedTokenLimitEntry,
} from '../../types/plugins'

// ============================================================================
// KEY SUBSTITUTION
// ============================================================================

/**
 * Resolve token limit key with substitutions:
 * - :route → methodName
 * - :parent → basePath
 * - :user:{field} → user[field] from auth context (e.g., :user:plan, :user:id)
 */
export function resolveTokenLimitKey(
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
// COST RESOLVERS
// ============================================================================

/**
 * Resolve call cost to numeric value
 */
export async function resolveCallCost(
  spec: TokenLimitEntry['callCost'],
  params: any,
  ctx: any
): Promise<number> {
  if (typeof spec === 'number') {
    return spec
  }

  if (typeof spec === 'function') {
    return await spec(params, ctx)
  }

  if (typeof spec === 'object') {
    const formula = spec as TokenCallCostFormula
    const initial = formula.initial ?? 0
    const perLimit = formula.perLimit ?? 0
    const perChar = formula.perChar ?? 0

    const limit = params.limit ?? 0
    const paramChars = JSON.stringify(params).length

    return initial + perLimit * limit + perChar * paramChars
  }

  return 1 // default
}

/**
 * Count items in result (for response cost formula)
 */
function countItems(value: any): number {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'object' && value !== null) return 1
  return 0
}

/**
 * Count total characters in result (for response cost formula)
 */
function countChars(value: any): number {
  return JSON.stringify(value).length
}

/**
 * Count keys in result object (for response cost formula)
 */
function countKeys(value: any): number {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.keys(value).length
  }
  return 0
}

/**
 * Resolve response cost to numeric value
 */
export async function resolveResponseCost(
  spec: TokenLimitEntry['responseCost'],
  result: any,
  timing: TokenLimitTiming,
  params: any
): Promise<number> {
  if (spec === undefined || spec === 0) {
    return 0
  }

  if (typeof spec === 'number') {
    return spec
  }

  if (typeof spec === 'function') {
    return await spec(result, timing, params)
  }

  if (typeof spec === 'object') {
    const formula = spec as TokenResponseCostFormula
    const perMs = formula.perMs ?? 0
    const perItem = formula.perItem ?? 0
    const perChar = formula.perChar ?? 0
    const perKey = formula.perKey ?? 0

    const items = countItems(result)
    const chars = countChars(result)
    const keys = countKeys(result)

    return perMs * timing.durationMs + perItem * items + perChar * chars + perKey * keys
  }

  return 0
}

/**
 * Resolve failure cost to numeric value
 */
export async function resolveFailureCost(
  spec: TokenLimitEntry['failureCost'],
  error: Error,
  timing: TokenLimitTiming,
  params: any
): Promise<number> {
  if (spec === undefined || spec === 0) {
    return 0
  }

  if (typeof spec === 'number') {
    return spec
  }

  if (typeof spec === 'function') {
    return await spec(error, timing, params)
  }

  return 0
}

// ============================================================================
// IN-MEMORY IMPLEMENTATION
// ============================================================================

interface BucketState {
  balance: number
  lastRefillMs: number
}

/**
 * Create an in-memory token limit controller with token-bucket algorithm
 * Lazy fills bucket on each access
 */
export function createInMemoryTokenLimit(): TokenLimitController {
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
        throw new HttpError(429, 'Token limit exceeded', { retryAfterMs })
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
 * Pre-handler: resolve callCost → controller.deduct() → return ResolvedTokenLimitEntry[] + remainingBalances
 */
export async function applyTokenLimitCheck(
  meta: TokenLimitMeta | undefined,
  controller: TokenLimitController,
  configs: TokenLimitConfigs,
  methodName: string,
  basePath: string,
  params: any,
  ctx: any,
  user?: any
): Promise<{ entries: ResolvedTokenLimitEntry[]; remainingBalances: number[] }> {
  if (!meta) {
    return { entries: [], remainingBalances: [] }
  }

  const entries = Array.isArray(meta) ? meta : [meta]
  const resolved: ResolvedTokenLimitEntry[] = []
  const remainingBalances: number[] = []

  for (const entry of entries) {
    const rawKey = entry.key ?? ':route'
    const key = resolveTokenLimitKey(rawKey, methodName, basePath, user)
    const callCost = await resolveCallCost(entry.callCost ?? 1, params, ctx)
    const config = entry.config ?? configs[key]

    if (!config) {
      throw new Error(
        `Token limit config not found for key "${key}". ` +
          `Define it in server.tokenLimit.configs or inline in route metadata.`
      )
    }

    const remaining = await controller.deduct(key, callCost, config)

    resolved.push({
      key,
      callCost,
      responseCostSpec: entry.responseCost,
      failureCostSpec: entry.failureCost,
      config,
    })
    remainingBalances.push(remaining)
  }

  return { entries: resolved, remainingBalances }
}

/**
 * Post-handler (success): resolve responseCost → deduct;
 * if refundedStatusCode → refund callCost instead
 * Returns responseCosts[]
 */
export async function applyTokenLimitResponse(
  entries: ResolvedTokenLimitEntry[],
  controller: TokenLimitController,
  result: any,
  timing: TokenLimitTiming,
  params: any,
  statusCode: number
): Promise<number[]> {
  const responseCosts: number[] = []

  for (const entry of entries) {
    const shouldRefundCall =
      (entry.config.refundedStatusCodes?.includes(statusCode)) ||
      (entry.config.refundSuccessful && statusCode >= 200 && statusCode < 300)

    if (shouldRefundCall) {
      await controller.refund(entry.key, entry.callCost, entry.config)
    } else {
      // Deduct response cost
      const responseCost = await resolveResponseCost(
        entry.responseCostSpec,
        result,
        timing,
        params
      )
      if (responseCost > 0) {
        await controller.deduct(entry.key, responseCost, entry.config)
      }
      responseCosts.push(responseCost)
    }
  }

  return responseCosts
}

/**
 * Catch block (error path): resolve failureCost → deduct (or negative → refund)
 * If failureCost is 0 and statusCode in refundedStatusCodes → refund callCost
 */
export async function applyTokenLimitFailure(
  entries: ResolvedTokenLimitEntry[],
  controller: TokenLimitController,
  error: Error,
  timing: TokenLimitTiming,
  params: any,
  statusCode: number
): Promise<number[]> {
  const failureCosts: number[] = []

  for (const entry of entries) {
    const failureCost = await resolveFailureCost(
      entry.failureCostSpec,
      error,
      timing,
      params
    )

    if (failureCost > 0) {
      // Deduct additional failure cost
      await controller.deduct(entry.key, failureCost, entry.config)
    } else if (failureCost < 0) {
      // Negative failure cost = partial refund
      await controller.refund(entry.key, -failureCost, entry.config)
    } else if (failureCost === 0) {
      // Check for refunded status codes even on 0 failure cost
      const shouldRefundCall =
        (entry.config.refundedStatusCodes?.includes(statusCode)) ||
        (entry.config.refundSuccessful && statusCode >= 200 && statusCode < 300)

      if (shouldRefundCall) {
        await controller.refund(entry.key, entry.callCost, entry.config)
      }
    }

    failureCosts.push(failureCost)
  }

  return failureCosts
}
