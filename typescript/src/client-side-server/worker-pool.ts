import type { ClientSideServerChannel } from './channel'
import type {
  ClientSideServerPublicIdentity,
  ClientSideServerSignedAuthorityRecord,
} from './identity'
import { clientSideServerPublicKeysEqual } from './identity'
import type {
  ClientSideServerMessage,
  ClientSideServerPeerMessage,
} from './protocol'
import { isClientSideServerPeerMessage } from './protocol'
import type {
  ClientSideServerAddress,
} from './signaling'
import { parseClientSideServerAddress } from './signaling'
import type {
  ClientSideServerDiscoveryCandidate,
  ClientSideServerDiscoveryResult,
  ClientSideServerMQTTWebRTCOptions,
  ClientSideServerPeerSession,
  ClientSideServerWorkerPoolOptions,
  ClientSideServerWorkerState,
} from './mqtt-webrtc'
import {
  connectFirstDiscovery,
  createClientSideServerMQTTWebRTCPeerSession,
  discoverClientSideServers,
} from './mqtt-webrtc'

export interface ClientSideServerWorkerPoolSession {
  readonly address: ClientSideServerAddress
  readonly workers: ReadonlyArray<ClientSideServerWorkerState>
  isOpen(): boolean
  send(message: ClientSideServerMessage): Promise<void>
  subscribe(listener: (message: any) => void | Promise<void>): () => void
  rediscover(): Promise<void>
  setWorkerWeight(instanceId: string, weight: number): void
  close(): Promise<void>
}

export interface ClientSideServerMultiWorkerPool {
  connect(address: string | ClientSideServerAddress): Promise<ClientSideServerWorkerPoolSession>
  close(address: string | ClientSideServerAddress): Promise<void>
  closeAll(): Promise<void>
}

export function createClientSideServerMultiWorkerPool(
  options: ClientSideServerMQTTWebRTCOptions = {},
): ClientSideServerMultiWorkerPool {
  const sessions = new Map<string, Promise<ClientSideServerWorkerPoolSession>>()

  const normalizeAddress = (input: string | ClientSideServerAddress) =>
    typeof input === 'string' ? parseClientSideServerAddress(input) : input

  return {
    async connect(input) {
      const address = normalizeAddress(input)
      const existing = sessions.get(address.href)
      if (existing) {
        const session = await existing
        if (session.isOpen()) return session
        sessions.delete(address.href)
      }

      const created = createWorkerPoolSession(address, options)
      sessions.set(address.href, created)
      try {
        return await created
      } catch (error) {
        sessions.delete(address.href)
        throw error
      }
    },

    async close(input) {
      const address = normalizeAddress(input)
      const existing = sessions.get(address.href)
      if (!existing) return
      sessions.delete(address.href)
      const session = await existing
      await session.close()
    },

    async closeAll() {
      const pending = Array.from(sessions.values())
      sessions.clear()
      for (const p of pending) {
        const session = await p
        await session.close()
      }
    },
  }
}

async function createWorkerPoolSession(
  address: ClientSideServerAddress,
  options: ClientSideServerMQTTWebRTCOptions,
): Promise<ClientSideServerWorkerPoolSession> {
  const poolOpts = options.workerPool ?? {}
  const maxActive = poolOpts.maxActiveWorkers ?? 1
  const maxStandby = poolOpts.maxStandbyWorkers ?? 0
  const maxTotal = poolOpts.maxTotalConnections ?? (maxActive + maxStandby)
  const rediscoveryThreshold = poolOpts.rediscoveryThreshold ?? 1
  const healthIntervalMs = poolOpts.healthCheckIntervalMs ?? 10_000
  const healthTimeoutMs = poolOpts.healthCheckTimeoutMs ?? 5_000
  const routingStrategy = poolOpts.routingStrategy ?? 'weighted-random'

  const workers: ClientSideServerWorkerState[] = []
  const listeners = new Set<(message: any) => void | Promise<void>>()
  let roundRobinIndex = 0
  let healthTimer: ReturnType<typeof setInterval> | undefined
  let closed = false

  // Connect to primary immediately while discovering others in parallel
  const { primary, discovery } = await connectFirstDiscovery(address, options)
  const primaryWorker = createWorkerFromSession(primary, true)
  workers.push(primaryWorker)

  // Set up message forwarding from primary
  setupWorkerMessageForwarding(primaryWorker)

  // Connect to additional workers from discovery results in background
  void discovery.then(async (result) => {
    if (closed) return
    await connectAdditionalWorkers(result)
  })

  // Start health checks
  if (healthIntervalMs > 0) {
    healthTimer = setInterval(() => void runHealthChecks(), healthIntervalMs)
  }

  async function connectAdditionalWorkers(result: ClientSideServerDiscoveryResult): Promise<void> {
    const newCandidates = result.candidates.filter((c) => !c.alreadyConnected)
    let activeCount = workers.filter((w) => w.status === 'active').length
    let standbyCount = workers.filter((w) => w.status === 'standby').length
    let totalCount = workers.length

    for (const candidate of newCandidates) {
      if (totalCount >= maxTotal) break
      if (closed) break

      const needActive = activeCount < maxActive
      const needStandby = standbyCount < maxStandby

      if (!needActive && !needStandby) break

      try {
        const session = await createClientSideServerMQTTWebRTCPeerSession(
          address,
          options,
          candidate.instanceId,
        )
        if (closed) {
          await session.close?.()
          return
        }

        const worker = createWorkerFromCandidate(session, candidate)
        if (needActive) {
          worker.status = 'active'
          worker.weight = resolveWeight(candidate, options)
          activeCount++
        } else {
          worker.status = 'standby'
          worker.weight = 0
          standbyCount++
        }

        workers.push(worker)
        totalCount++
        setupWorkerMessageForwarding(worker)
      } catch {
        // Connection to this candidate failed, skip it
      }
    }

    if (poolOpts.assignWeights) {
      poolOpts.assignWeights(workers)
    }
  }

  function createWorkerFromSession(
    session: ClientSideServerPeerSession,
    isActive: boolean,
  ): ClientSideServerWorkerState {
    return {
      instanceId: session.peerId,
      session,
      identity: session.identity!,
      status: isActive ? 'active' : 'standby',
      weight: isActive ? 3 : 0,
      serverAdvertisedWeight: 3,
      authorityVerified: false,
      pendingRequests: 0,
      totalRequests: 0,
      totalErrors: 0,
      connectedAt: session.connectedAt,
      lastPongAt: Date.now(),
    }
  }

  function createWorkerFromCandidate(
    session: ClientSideServerPeerSession,
    candidate: ClientSideServerDiscoveryCandidate,
  ): ClientSideServerWorkerState {
    const advertisedWeight = candidate.workerInfo.weight ?? 3
    return {
      instanceId: candidate.instanceId,
      session,
      identity: candidate.identity,
      authorityRecord: candidate.authorityRecord,
      status: 'verifying',
      weight: 0,
      serverAdvertisedWeight: advertisedWeight,
      authorityVerified: !!candidate.authorityRecord,
      pendingRequests: 0,
      totalRequests: 0,
      totalErrors: 0,
      connectedAt: session.connectedAt,
      lastPongAt: Date.now(),
    }
  }

  function resolveWeight(
    candidate: ClientSideServerDiscoveryCandidate,
    opts: ClientSideServerMQTTWebRTCOptions,
  ): number {
    // Only trust self-reported weights from authority-verified servers
    if (candidate.authorityRecord) {
      return candidate.workerInfo.weight ?? 3
    }
    return 3
  }

  function setupWorkerMessageForwarding(worker: ClientSideServerWorkerState): void {
    worker.session.subscribe(async (msg) => {
      // Handle control messages
      if ('platcss' in msg) {
        const control = msg as any
        if (control.platcss === 'pong') {
          worker.lastPongAt = Date.now()
          return
        }
        if (control.platcss === 'drain') {
          worker.status = 'draining'
          promoteStandbyIfNeeded()
          return
        }
      }

      // Forward all other messages to pool subscribers
      for (const listener of listeners) {
        await listener(msg)
      }
    })
  }

  function promoteStandbyIfNeeded(): void {
    const activeCount = workers.filter((w) => w.status === 'active').length
    if (activeCount >= maxActive) return

    const standby = workers.find((w) => w.status === 'standby')
    if (standby) {
      standby.status = 'active'
      standby.weight = standby.serverAdvertisedWeight
      if (poolOpts.assignWeights) {
        poolOpts.assignWeights(workers)
      }
    }
  }

  function maybeRediscover(): void {
    const activeCount = workers.filter((w) => w.status === 'active').length
    if (activeCount < rediscoveryThreshold && !closed) {
      void rediscover()
    }
  }

  async function rediscover(): Promise<void> {
    if (closed) return
    const result = await discoverClientSideServers(address.serverName, options)

    // Mark candidates that we already have connections to
    for (const candidate of result.candidates) {
      for (const worker of workers) {
        if (worker.identity && candidate.identity
          && clientSideServerPublicKeysEqual(worker.identity.publicKeyJwk, candidate.identity.publicKeyJwk)) {
          candidate.alreadyConnected = true
          break
        }
      }
    }

    await connectAdditionalWorkers(result)
  }

  async function runHealthChecks(): Promise<void> {
    const now = Date.now()
    for (const worker of workers) {
      if (worker.status !== 'active' && worker.status !== 'standby') continue
      if (!worker.session.isOpen()) {
        worker.status = 'failed'
        promoteStandbyIfNeeded()
        maybeRediscover()
        continue
      }

      try {
        await worker.session.send({ platcss: 'ping', ts: now } as any)
      } catch {
        worker.status = 'failed'
        promoteStandbyIfNeeded()
        maybeRediscover()
        continue
      }

      // Check if previous ping timed out
      if (worker.lastPongAt && (now - worker.lastPongAt) > (healthIntervalMs + healthTimeoutMs)) {
        worker.status = 'failed'
        promoteStandbyIfNeeded()
        maybeRediscover()
      }
    }
  }

  function selectWorker(): ClientSideServerWorkerState | undefined {
    const active = workers.filter((w) => w.status === 'active' && w.session.isOpen())
    if (active.length === 0) return undefined

    switch (routingStrategy) {
      case 'round-robin': {
        roundRobinIndex = (roundRobinIndex + 1) % active.length
        return active[roundRobinIndex]
      }

      case 'least-pending': {
        return active.sort((a, b) => {
          if (a.pendingRequests !== b.pendingRequests) return a.pendingRequests - b.pendingRequests
          return b.weight - a.weight
        })[0]
      }

      case 'primary-with-fallback': {
        return active.sort((a, b) => b.weight - a.weight)[0]
      }

      case 'weighted-random':
      default: {
        const totalWeight = active.reduce((sum, w) => sum + Math.max(w.weight, 1), 0)
        let rand = Math.random() * totalWeight
        for (const worker of active) {
          rand -= Math.max(worker.weight, 1)
          if (rand <= 0) return worker
        }
        return active[active.length - 1]
      }
    }
  }

  return {
    address,
    workers,

    isOpen() {
      return workers.some((w) => w.status === 'active' && w.session.isOpen())
    },

    async send(message) {
      const worker = selectWorker()
      if (!worker) {
        throw new Error(`No active workers available for ${address.serverName}`)
      }
      worker.pendingRequests++
      worker.totalRequests++
      worker.lastRequestAt = Date.now()
      try {
        await worker.session.send(message)
      } catch (error) {
        worker.totalErrors++
        worker.lastErrorAt = Date.now()
        throw error
      } finally {
        worker.pendingRequests--
      }
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async rediscover() {
      await rediscover()
    },

    setWorkerWeight(instanceId, weight) {
      const worker = workers.find((w) => w.instanceId === instanceId)
      if (worker) {
        worker.weight = weight
        if (weight === 0 && worker.status === 'active') {
          worker.status = 'standby'
        } else if (weight > 0 && worker.status === 'standby') {
          worker.status = 'active'
        }
      }
    },

    async close() {
      closed = true
      if (healthTimer) {
        clearInterval(healthTimer)
        healthTimer = undefined
      }
      for (const worker of workers) {
        worker.status = 'closed'
        await worker.session.close?.()
      }
      workers.length = 0
      listeners.clear()
    },
  }
}
