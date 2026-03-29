import {
  CacheController,
  CacheEntry,
  CacheMeta,
} from '../../types/plugins'

// ============================================================================
// KEY RESOLUTION
// ============================================================================

/**
 * Resolve cache key with substitutions:
 * - :route → methodName
 * - :parent → basePath
 * - :user → user.sub (user ID)
 * - :tier → user.tier (plan level)
 * - :user:{field} → user[field] (any user field)
 * - {name} → params[name]
 */
export function resolveCacheKey(
  template: string,
  params: Record<string, any>,
  methodName: string,
  basePath: string,
  user?: any
): string {
  let key = template
    .replace(':route', methodName)
    .replace(':parent', basePath)

  // Replace :user (shortcut for user ID)
  if (user) {
    const userId = user.sub || user.id
    if (userId) {
      key = key.replace(':user', String(userId))
    }

    // Replace :tier (shortcut for plan level)
    const tier = user.tier || user.plan
    if (tier) {
      key = key.replace(':tier', String(tier))
    }

    // Replace :user:{field} with user property
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

  // Replace {paramName} with param values
  const paramMatches = key.match(/\{([^}]+)\}/g)
  if (paramMatches) {
    for (const match of paramMatches) {
      const paramName = match.slice(1, -1)
      const paramValue = params[paramName]
      if (paramValue !== undefined) {
        key = key.replace(match, String(paramValue))
      }
    }
  }

  return key
}

// ============================================================================
// IN-MEMORY IMPLEMENTATION
// ============================================================================

interface CacheEntryData {
  value: any
  expiresAt?: number // timestamp in ms, undefined = no expiry
}

/**
 * Create an in-memory cache controller
 * Uses Map for storage with lazy TTL eviction on access
 */
export function createInMemoryCache(): CacheController {
  const store = new Map<string, CacheEntryData>()

  return {
    get(key: string): any {
      const entry = store.get(key)
      if (!entry) {
        return undefined
      }

      // Check if expired
      if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        store.delete(key)
        return undefined
      }

      return entry.value
    },

    set(key: string, value: any, ttlSeconds?: number): void {
      const expiresAt = ttlSeconds
        ? Date.now() + ttlSeconds * 1000
        : undefined

      store.set(key, { value, expiresAt })
    },

    clear(key: string): void {
      store.delete(key)
    },
  }
}

// ============================================================================
// PIPELINE HELPERS
// ============================================================================

/**
 * Pre-handler: find first CacheEntry matching httpMethod → resolve key → controller.get()
 */
export async function applyCacheCheck(
  meta: CacheMeta | undefined,
  controller: CacheController,
  params: Record<string, any>,
  httpMethod: string,
  methodName: string,
  basePath: string,
  user?: any
): Promise<{
  cacheKey: string | null
  hit: boolean
  cachedValue?: any
  entry?: CacheEntry
}> {
  if (!meta) {
    return { cacheKey: null, hit: false }
  }

  const entries = Array.isArray(meta) ? meta : [meta]

  for (const entry of entries) {
    const methods = entry.methods ?? ['GET']
    if (!methods.includes(httpMethod)) {
      continue
    }

    const key = resolveCacheKey(entry.key, params, methodName, basePath, user)
    const cachedValue = await controller.get(key)

    if (cachedValue !== undefined) {
      return { cacheKey: key, hit: true, cachedValue, entry }
    }

    return { cacheKey: key, hit: false, entry }
  }

  return { cacheKey: null, hit: false }
}

/**
 * Post-handler (miss): controller.set(key, result, entry.ttl)
 */
export async function applyCacheStore(
  cacheKey: string | null,
  entry: CacheEntry | undefined,
  controller: CacheController,
  result: any
): Promise<void> {
  if (cacheKey && entry) {
    await controller.set(cacheKey, result, entry.ttl)
  }
}
