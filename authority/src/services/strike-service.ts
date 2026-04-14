import { createClient, type RedisClientType } from 'redis'

export interface StrikeServiceOptions {
  redisUrl?: string
  strikeWindowSeconds?: number
}

export interface StrikeResult {
  strikes: number
  recommendedBanSeconds?: number
}

interface MemoryStrike {
  strikes: number
  expiresAt: number
}

export class StrikeService {
  private readonly strikeWindowSeconds: number
  private readonly memoryStrikes = new Map<string, MemoryStrike>()
  private readonly redis?: RedisClientType
  private readonly ready: Promise<void>

  constructor(options: StrikeServiceOptions = {}) {
    this.strikeWindowSeconds = options.strikeWindowSeconds ?? 24 * 60 * 60

    if (options.redisUrl) {
      this.redis = createClient({ url: options.redisUrl })
      this.ready = this.redis.connect().then(() => undefined).catch(() => undefined)
      this.redis.on('error', () => undefined)
    } else {
      this.ready = Promise.resolve()
    }
  }

  private strikeKey(clientKey: string): string {
    return `strike:${clientKey}`
  }

  private recommendedBanSeconds(strikes: number): number | undefined {
    if (strikes >= 6) return 30 * 60
    if (strikes >= 3) return 5 * 60
    return undefined
  }

  async recordMalformedRequest(clientKey: string): Promise<StrikeResult> {
    await this.ready

    if (this.redis?.isOpen) {
      const key = this.strikeKey(clientKey)
      const strikes = await this.redis.incr(key)
      if (strikes === 1) {
        await this.redis.expire(key, this.strikeWindowSeconds)
      }
      return {
        strikes,
        recommendedBanSeconds: this.recommendedBanSeconds(strikes),
      }
    }

    const now = Date.now()
    for (const [key, value] of this.memoryStrikes.entries()) {
      if (value.expiresAt <= now) this.memoryStrikes.delete(key)
    }

    const current = this.memoryStrikes.get(clientKey)
    const strikes = (current?.strikes ?? 0) + 1
    this.memoryStrikes.set(clientKey, {
      strikes,
      expiresAt: now + this.strikeWindowSeconds * 1000,
    })

    return {
      strikes,
      recommendedBanSeconds: this.recommendedBanSeconds(strikes),
    }
  }
}

