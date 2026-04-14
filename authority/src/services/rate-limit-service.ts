import { createClient, type RedisClientType } from 'redis'

export interface RateLimitServiceOptions {
  redisUrl?: string
  bucketWindowMs?: number
  connectLimitPerWindow?: number
}

export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  retryAfterMs?: number
}

interface MemoryBucket {
  count: number
  expiresAt: number
}

export class RateLimitService {
  private readonly bucketWindowMs: number
  private readonly connectLimitPerWindow: number
  private readonly memoryBuckets = new Map<string, MemoryBucket>()
  private readonly redis?: RedisClientType
  private readonly ready: Promise<void>

  constructor(options: RateLimitServiceOptions = {}) {
    this.bucketWindowMs = options.bucketWindowMs ?? 30_000
    this.connectLimitPerWindow = options.connectLimitPerWindow ?? 500

    if (options.redisUrl) {
      this.redis = createClient({ url: options.redisUrl })
      this.ready = this.redis.connect().then(() => undefined).catch(() => undefined)
      this.redis.on('error', () => undefined)
    } else {
      this.ready = Promise.resolve()
    }
  }

  private nowBucket(): number {
    return Math.floor(Date.now() / this.bucketWindowMs)
  }

  private redisBucketKey(name: string, clientKey: string, bucketWindowMs: number): string {
    const bucket = Math.floor(Date.now() / bucketWindowMs)
    return `rl:${name}:${clientKey}:${bucket}`
  }

  private retryAfterMs(bucketWindowMs: number): number {
    return bucketWindowMs - (Date.now() % bucketWindowMs)
  }

  async checkAllowance(
    name: string,
    clientKey: string,
    limitPerWindow: number,
    bucketWindowMs = this.bucketWindowMs,
  ): Promise<RateLimitDecision> {
    await this.ready

    if (this.redis?.isOpen) {
      const key = this.redisBucketKey(name, clientKey, bucketWindowMs)
      const value = await this.redis.incr(key)
      if (value === 1) {
        await this.redis.expire(key, Math.ceil(bucketWindowMs / 1000) + 1)
      }

      const remaining = Math.max(0, limitPerWindow - value)
      if (value > limitPerWindow) {
        return {
          allowed: false,
          remaining,
          retryAfterMs: this.retryAfterMs(bucketWindowMs),
        }
      }

      return { allowed: true, remaining }
    }

    const bucket = Math.floor(Date.now() / bucketWindowMs)
    const key = `${name}:${clientKey}:${bucket}`
    const now = Date.now()

    for (const [bucketKey, bucketValue] of this.memoryBuckets.entries()) {
      if (bucketValue.expiresAt <= now) {
        this.memoryBuckets.delete(bucketKey)
      }
    }

    const existing = this.memoryBuckets.get(key)
    const nextCount = (existing?.count ?? 0) + 1
    this.memoryBuckets.set(key, {
      count: nextCount,
      expiresAt: now + bucketWindowMs,
    })

    const remaining = Math.max(0, limitPerWindow - nextCount)
    if (nextCount > limitPerWindow) {
      return {
        allowed: false,
        remaining,
        retryAfterMs: this.retryAfterMs(bucketWindowMs),
      }
    }

    return { allowed: true, remaining }
  }

  async checkConnectAllowance(clientKey: string): Promise<RateLimitDecision> {
    return this.checkAllowance('connect', clientKey, this.connectLimitPerWindow, this.bucketWindowMs)
  }
}

