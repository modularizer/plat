import { createClient, type RedisClientType } from 'redis'

interface MemoryBanEntry {
  expiresAt: number
  reason?: string
}

interface MemorySuppressionEntry {
  expiresAt: number
  reason?: string
}

export interface BlockServiceOptions {
  redisUrl?: string
}

export class BlockService {
  private readonly memoryBans = new Map<string, MemoryBanEntry>()
  private readonly memorySuppressions = new Map<string, MemorySuppressionEntry>()
  private readonly redis?: RedisClientType
  private readonly ready: Promise<void>

  constructor(options: BlockServiceOptions = {}) {
	if (options.redisUrl) {
	  this.redis = createClient({ url: options.redisUrl })
	  this.ready = this.redis.connect().then(() => undefined).catch(() => undefined)
	  this.redis.on('error', () => undefined)
	} else {
	  this.ready = Promise.resolve()
	}
  }

  private suppressionKey(serverName: string, clientKey: string): string {
	return `suppress:${serverName}:${clientKey}`
  }

  private banKey(clientKey: string): string {
	return `ban:${clientKey}`
  }

  private purgeExpired(): void {
	const now = Date.now()
	for (const [key, value] of this.memoryBans.entries()) {
	  if (value.expiresAt <= now) this.memoryBans.delete(key)
	}
	for (const [key, value] of this.memorySuppressions.entries()) {
	  if (value.expiresAt <= now) this.memorySuppressions.delete(key)
	}
  }

  async banClient(clientKey: string, ttlSeconds: number, reason?: string): Promise<void> {
	await this.ready
	if (this.redis?.isOpen) {
	  await this.redis.set(this.banKey(clientKey), reason || 'banned', { EX: ttlSeconds })
	  return
	}

	this.memoryBans.set(clientKey, {
	  expiresAt: Date.now() + ttlSeconds * 1000,
	  reason,
	})
  }

  async isClientBanned(clientKey: string): Promise<boolean> {
	await this.ready
	if (this.redis?.isOpen) {
	  return (await this.redis.exists(this.banKey(clientKey))) === 1
	}

	this.purgeExpired()
	return this.memoryBans.has(clientKey)
  }

  async suppressClient(serverName: string, clientKey: string, ttlSeconds: number, reason?: string): Promise<void> {
	await this.ready
	const key = this.suppressionKey(serverName, clientKey)

	if (this.redis?.isOpen) {
	  await this.redis.set(key, reason || 'suppressed', { EX: ttlSeconds })
	  return
	}

	this.memorySuppressions.set(key, {
	  expiresAt: Date.now() + ttlSeconds * 1000,
	  reason,
	})
  }

  async isClientSuppressed(serverName: string, clientKey: string): Promise<boolean> {
	await this.ready
	const key = this.suppressionKey(serverName, clientKey)

	if (this.redis?.isOpen) {
	  return (await this.redis.exists(key)) === 1
	}

	this.purgeExpired()
	return this.memorySuppressions.has(key)
  }
}

