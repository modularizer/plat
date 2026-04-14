import { createClient, type RedisClientType } from 'redis'

const HOST_TTL_SECONDS = 300
const SERVER_EVENT_CAP = 200
const RECENT_CAP = 500

export interface ActivityHostInfo {
  hostSessionId: string
  googleSub: string
  ip: string
  connectedAt: number
  lastPongAt: number
}

export interface ActivityServerEvent {
  ts: number
  type: 'online' | 'offline' | 'client_connect_ok' | 'client_connect_rejected' | 'client_connect_timeout' | 'client_connect_error'
  serverName: string
  hostSessionId?: string
  googleSub?: string
  clientKey?: string
  reason?: string
  authMode?: string
}

export interface ActivityServerSnapshot {
  serverName: string
  online: boolean
  hostSessionId?: string
  host?: ActivityHostInfo
  authMode?: string
  events: ActivityServerEvent[]
}

export interface ActivityServiceOptions {
  redisUrl?: string
}

export class ActivityService {
  private readonly redis?: RedisClientType
  private readonly ready: Promise<void>
  private readonly memoryHosts = new Map<string, ActivityHostInfo>()
  private readonly memoryOnline = new Map<string, { hostSessionId: string; authMode?: string }>()
  private readonly memoryServerEvents = new Map<string, ActivityServerEvent[]>()
  private readonly memoryRecent: ActivityServerEvent[] = []

  constructor(options: ActivityServiceOptions = {}) {
    if (options.redisUrl) {
      this.redis = createClient({ url: options.redisUrl }) as RedisClientType
      this.ready = this.redis.connect().then(() => undefined).catch(() => undefined)
      this.redis.on('error', () => undefined)
    } else {
      this.ready = Promise.resolve()
    }
  }

  private hostKey(id: string) { return `authority:host:${id}` }
  private onlineKey() { return 'authority:servers:online' }
  private serverSessionKey(name: string) { return `authority:server:${name}:session` }
  private serverEventsKey(name: string) { return `authority:server:${name}:events` }
  private recentKey() { return 'authority:recent-connects' }

  async recordHostConnected(info: Omit<ActivityHostInfo, 'lastPongAt'>): Promise<void> {
    await this.ready
    const full: ActivityHostInfo = { ...info, lastPongAt: info.connectedAt }
    if (!this.redis) {
      this.memoryHosts.set(info.hostSessionId, full)
      return
    }
    try {
      const key = this.hostKey(info.hostSessionId)
      await this.redis.hSet(key, {
        hostSessionId: info.hostSessionId,
        googleSub: info.googleSub,
        ip: info.ip,
        connectedAt: String(info.connectedAt),
        lastPongAt: String(full.lastPongAt),
      })
      await this.redis.expire(key, HOST_TTL_SECONDS)
    } catch {}
  }

  async recordHostPong(hostSessionId: string, at = Date.now()): Promise<void> {
    await this.ready
    if (!this.redis) {
      const entry = this.memoryHosts.get(hostSessionId)
      if (entry) entry.lastPongAt = at
      return
    }
    try {
      const key = this.hostKey(hostSessionId)
      await this.redis.hSet(key, { lastPongAt: String(at) })
      await this.redis.expire(key, HOST_TTL_SECONDS)
    } catch {}
  }

  async recordHostDisconnected(hostSessionId: string): Promise<void> {
    await this.ready
    if (!this.redis) {
      this.memoryHosts.delete(hostSessionId)
      return
    }
    try {
      await this.redis.del(this.hostKey(hostSessionId))
    } catch {}
  }

  async markServerOnline(serverName: string, hostSessionId: string, authMode?: string): Promise<void> {
    await this.ready
    const event: ActivityServerEvent = {
      ts: Date.now(),
      type: 'online',
      serverName,
      hostSessionId,
      authMode,
    }
    if (!this.redis) {
      this.memoryOnline.set(serverName, { hostSessionId, authMode })
      this.pushMemoryEvent(serverName, event)
      return
    }
    try {
      await this.redis.sAdd(this.onlineKey(), serverName)
      await this.redis.set(this.serverSessionKey(serverName), JSON.stringify({ hostSessionId, authMode }))
      await this.pushRedisEvent(serverName, event)
    } catch {}
  }

  async markServerOffline(serverName: string): Promise<void> {
    await this.ready
    const event: ActivityServerEvent = { ts: Date.now(), type: 'offline', serverName }
    if (!this.redis) {
      this.memoryOnline.delete(serverName)
      this.pushMemoryEvent(serverName, event)
      return
    }
    try {
      await this.redis.sRem(this.onlineKey(), serverName)
      await this.redis.del(this.serverSessionKey(serverName))
      await this.pushRedisEvent(serverName, event)
    } catch {}
  }

  async recordClientConnect(
    serverName: string,
    outcome: 'ok' | 'rejected' | 'timeout' | 'error',
    clientKey?: string,
    reason?: string,
  ): Promise<void> {
    await this.ready
    const event: ActivityServerEvent = {
      ts: Date.now(),
      type: outcome === 'ok'
        ? 'client_connect_ok'
        : outcome === 'rejected'
          ? 'client_connect_rejected'
          : outcome === 'timeout'
            ? 'client_connect_timeout'
            : 'client_connect_error',
      serverName,
      clientKey,
      reason,
    }
    if (!this.redis) {
      this.pushMemoryEvent(serverName, event)
      return
    }
    try {
      await this.pushRedisEvent(serverName, event)
    } catch {}
  }

  private pushMemoryEvent(serverName: string, event: ActivityServerEvent) {
    const list = this.memoryServerEvents.get(serverName) ?? []
    list.unshift(event)
    if (list.length > SERVER_EVENT_CAP) list.length = SERVER_EVENT_CAP
    this.memoryServerEvents.set(serverName, list)
    this.memoryRecent.unshift(event)
    if (this.memoryRecent.length > RECENT_CAP) this.memoryRecent.length = RECENT_CAP
  }

  private async pushRedisEvent(serverName: string, event: ActivityServerEvent) {
    if (!this.redis) return
    const payload = JSON.stringify(event)
    await this.redis.lPush(this.serverEventsKey(serverName), payload)
    await this.redis.lTrim(this.serverEventsKey(serverName), 0, SERVER_EVENT_CAP - 1)
    await this.redis.lPush(this.recentKey(), payload)
    await this.redis.lTrim(this.recentKey(), 0, RECENT_CAP - 1)
  }

  async getOnlineServers(): Promise<string[]> {
    await this.ready
    if (!this.redis) return Array.from(this.memoryOnline.keys()).sort()
    try {
      const names = await this.redis.sMembers(this.onlineKey())
      return names.sort()
    } catch {
      return []
    }
  }

  async getHost(hostSessionId: string): Promise<ActivityHostInfo | null> {
    await this.ready
    if (!this.redis) return this.memoryHosts.get(hostSessionId) ?? null
    try {
      const entries = await this.redis.hGetAll(this.hostKey(hostSessionId))
      if (!entries || !entries.hostSessionId) return null
      return {
        hostSessionId: entries.hostSessionId,
        googleSub: entries.googleSub || '',
        ip: entries.ip || '',
        connectedAt: Number(entries.connectedAt || '0'),
        lastPongAt: Number(entries.lastPongAt || '0'),
      }
    } catch {
      return null
    }
  }

  async getServerSnapshot(serverName: string): Promise<ActivityServerSnapshot> {
    await this.ready
    let hostSessionId: string | undefined
    let authMode: string | undefined
    let online = false

    if (!this.redis) {
      const memo = this.memoryOnline.get(serverName)
      if (memo) {
        online = true
        hostSessionId = memo.hostSessionId
        authMode = memo.authMode
      }
      const events = this.memoryServerEvents.get(serverName) ?? []
      const host = hostSessionId ? (this.memoryHosts.get(hostSessionId) ?? undefined) : undefined
      return { serverName, online, hostSessionId, host, authMode, events }
    }

    try {
      online = (await this.redis.sIsMember(this.onlineKey(), serverName)) === true
      const sessionRaw = await this.redis.get(this.serverSessionKey(serverName))
      if (sessionRaw) {
        try {
          const parsed = JSON.parse(sessionRaw) as { hostSessionId: string; authMode?: string }
          hostSessionId = parsed.hostSessionId
          authMode = parsed.authMode
        } catch {}
      }
      const eventsRaw = await this.redis.lRange(this.serverEventsKey(serverName), 0, SERVER_EVENT_CAP - 1)
      const events = eventsRaw.map((raw) => {
        try { return JSON.parse(raw) as ActivityServerEvent } catch { return null }
      }).filter((x): x is ActivityServerEvent => !!x)
      const host = hostSessionId ? await this.getHost(hostSessionId) ?? undefined : undefined
      return { serverName, online, hostSessionId, host, authMode, events }
    } catch {
      return { serverName, online: false, events: [] }
    }
  }

  async getRecent(limit = 100): Promise<ActivityServerEvent[]> {
    await this.ready
    if (!this.redis) return this.memoryRecent.slice(0, limit)
    try {
      const raw = await this.redis.lRange(this.recentKey(), 0, Math.max(0, limit - 1))
      return raw.map((r) => { try { return JSON.parse(r) as ActivityServerEvent } catch { return null } })
        .filter((x): x is ActivityServerEvent => !!x)
    } catch {
      return []
    }
  }
}
