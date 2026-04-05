import mqtt, { type IClientOptions, type MqttClient } from 'mqtt'
import { createClientSideServerTransportPlugin } from '../client/css-transport-plugin'
import type { OpenAPIClientTransportPlugin } from '../client/transport-plugin'
import { createRTCDataChannelAdapter, type ClientSideServerChannel } from './channel'
import {
  buildClientSideServerIdentityChallenge,
  clientSideServerPublicKeysEqual,
  type ClientSideServerAuthorityServer,
  type ClientSideServerExportedKeyPair,
  type ClientSideServerPublicIdentity,
  type ClientSideServerSignedAuthorityRecord,
  type ClientSideServerStorageLike,
  type ClientSideServerTrustedServerRecord,
  getOrCreateClientSideServerIdentityKeyPair,
  loadTrustedClientSideServerRecordFromMap,
  resolveTrustedClientSideServerFromAuthorities,
  loadTrustedClientSideServerRecord,
  trustClientSideServerFromAuthorityRecord,
  saveTrustedClientSideServerRecordToMap,
  signClientSideServerChallenge,
  toClientSideServerPublicIdentity,
  trustClientSideServerOnFirstUse,
  verifyClientSideServerChallenge,
  verifySignedClientSideServerAuthorityRecord,
} from './identity'
import {
  isClientSideServerPeerMessage,
  type ClientSideServerMessage,
  type ClientSideServerPeerMessage,
} from './protocol'
import {
  parseClientSideServerAddress,
  type ClientSideServerAddress,
} from './signaling'
import type { PLATClientSideServer } from './server'

export const DEFAULT_CLIENT_SIDE_SERVER_MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt'
export const DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC = 'mrtchat/plat-css'
export const DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
]

interface ClientSideServerSignalingMessageBase {
  protocol: 'plat-css-v1'
  kind: 'announce' | 'offer' | 'answer' | 'ice'
  senderId: string
  targetId?: string
  serverName?: string
  connectionId?: string
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  identity?: ClientSideServerPublicIdentity
  authorityRecord?: ClientSideServerSignedAuthorityRecord
  challengeNonce?: string
  challengeSignature?: string
  at: number
}

type ClientSideServerSignalingMessage = ClientSideServerSignalingMessageBase

export interface ClientSideServerMQTTWebRTCOptions {
  mqttBroker?: string
  mqttTopic?: string
  mqttOptions?: IClientOptions
  iceServers?: RTCIceServer[]
  connectionTimeoutMs?: number
  announceIntervalMs?: number
  clientIdPrefix?: string
  identity?: ClientSideServerIdentityOptions
}

export interface ClientSideServerMQTTWebRTCServerOptions extends ClientSideServerMQTTWebRTCOptions {
  serverName: string
  server: PLATClientSideServer
}

export interface ClientSideServerIdentityOptions {
  keyPair?: ClientSideServerExportedKeyPair
  storage?: ClientSideServerStorageLike
  keyPairStorageKey?: string
  knownHosts?: Record<string, ClientSideServerTrustedServerRecord>
  knownHostsStorage?: ClientSideServerStorageLike
  knownHostsStorageKey?: string
  trustOnFirstUse?: boolean
  authority?: {
    publicKeyJwk: JsonWebKey
    authorityName?: string
  }
  authorityServers?: ClientSideServerAuthorityServer[]
  authorityResolver?: (serverName: string) => Promise<ClientSideServerTrustedServerRecord | null>
  authorityRecord?: ClientSideServerSignedAuthorityRecord
}

export interface ClientSideServerPeerSession extends ClientSideServerChannel {
  readonly address: ClientSideServerAddress
  readonly connectionId: string
  readonly peerId: string
  readonly connectedAt: number
  isOpen(): boolean
  sendPeer(event: string, data?: unknown): Promise<void>
  subscribePeer(listener: (message: ClientSideServerPeerMessage) => void | Promise<void>): () => void
}

export interface ClientSideServerPeerPool {
  connect(address: string | ClientSideServerAddress): Promise<ClientSideServerPeerSession>
  close(address: string | ClientSideServerAddress): Promise<void>
  closeAll(): Promise<void>
}

let defaultPeerPool: ClientSideServerPeerPool | undefined
let defaultTransportPlugin: OpenAPIClientTransportPlugin | undefined

export class ClientSideServerMQTTWebRTCServer {
  private mqtt?: MqttClient
  private readonly serverInstanceId: string
  private readonly unsubscribeByConnection = new Map<string, () => void>()
  private readonly peers = new Map<string, RTCPeerConnection>()
  private readonly pendingCandidates = new Map<string, RTCIceCandidateInit[]>()
  private announceTimer?: ReturnType<typeof setInterval>
  private identityKeyPair?: ClientSideServerExportedKeyPair
  private publicIdentity?: ClientSideServerPublicIdentity

  constructor(private options: ClientSideServerMQTTWebRTCServerOptions) {
    this.serverInstanceId = `${options.serverName}:${randomId('server')}`
  }

  get connectionUrl(): string {
    return `css://${this.options.serverName}`
  }

  async start(): Promise<void> {
    if (this.mqtt) return

    await this.ensureIdentity()
    this.mqtt = await connectToBroker(this.options)
    this.mqtt.on('message', (_topic, payload) => {
      void this.onMessage(payload)
    })
    await subscribe(this.mqtt, this.options.mqttTopic ?? DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC)
    await this.announce()

    const intervalMs = this.options.announceIntervalMs ?? 30_000
    this.announceTimer = setInterval(() => {
      void this.announce()
    }, intervalMs)
  }

  async stop(): Promise<void> {
    if (this.announceTimer) {
      clearInterval(this.announceTimer)
      this.announceTimer = undefined
    }

    for (const unsubscribe of this.unsubscribeByConnection.values()) {
      unsubscribe()
    }
    this.unsubscribeByConnection.clear()

    for (const peer of this.peers.values()) {
      peer.close()
    }
    this.peers.clear()

    if (this.mqtt) {
      await endClient(this.mqtt)
      this.mqtt = undefined
    }
  }

  private async announce(): Promise<void> {
    if (!this.mqtt) return
    await publish(this.mqtt, this.options.mqttTopic ?? DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC, {
      protocol: 'plat-css-v1',
      kind: 'announce',
      senderId: this.serverInstanceId,
      serverName: this.options.serverName,
      identity: this.publicIdentity,
      authorityRecord: this.options.identity?.authorityRecord,
      at: Date.now(),
    })
  }

  private async onMessage(payload: Buffer | Uint8Array): Promise<void> {
    const message = parseSignalingMessage(payload)
    if (!message || message.senderId === this.serverInstanceId) return
    if (message.targetId && message.targetId !== this.options.serverName && message.targetId !== this.serverInstanceId) return

    if (message.kind === 'offer' && message.targetId === this.options.serverName && message.connectionId && message.description) {
      await this.acceptOffer(message)
      return
    }

    if (
      message.kind === 'ice'
      && (message.targetId === this.options.serverName || message.targetId === this.serverInstanceId)
      && message.connectionId
      && message.candidate
    ) {
      const peer = this.peers.get(message.connectionId)
      if (peer?.remoteDescription) {
        await peer.addIceCandidate(new RTCIceCandidate(message.candidate))
      } else {
        const pending = this.pendingCandidates.get(message.connectionId) ?? []
        pending.push(message.candidate)
        this.pendingCandidates.set(message.connectionId, pending)
      }
    }
  }

  private async acceptOffer(message: ClientSideServerSignalingMessage): Promise<void> {
    if (!this.mqtt || !message.connectionId || !message.description) return
    await this.ensureIdentity()

    const peer = new RTCPeerConnection({
      iceServers: this.options.iceServers ?? DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
    })
    this.peers.set(message.connectionId, peer)

    peer.onicecandidate = (event) => {
      if (!event.candidate || !this.mqtt) return
      void publish(this.mqtt, this.options.mqttTopic ?? DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC, {
        protocol: 'plat-css-v1',
        kind: 'ice',
        senderId: this.serverInstanceId,
        targetId: message.senderId,
        serverName: this.options.serverName,
        connectionId: message.connectionId,
        candidate: event.candidate.toJSON(),
        at: Date.now(),
      })
    }

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed' || peer.connectionState === 'disconnected') {
        this.unsubscribeByConnection.get(message.connectionId!)?.()
        this.unsubscribeByConnection.delete(message.connectionId!)
        this.peers.delete(message.connectionId!)
      }
    }

    peer.ondatachannel = (event) => {
      const unsubscribe = this.options.server.serveChannel(createRTCDataChannelAdapter(event.channel))
      this.unsubscribeByConnection.set(message.connectionId!, unsubscribe)
      event.channel.addEventListener('close', () => {
        unsubscribe()
        this.unsubscribeByConnection.delete(message.connectionId!)
      }, { once: true })
    }

    await peer.setRemoteDescription(new RTCSessionDescription(message.description))
    for (const candidate of this.pendingCandidates.get(message.connectionId) ?? []) {
      await peer.addIceCandidate(new RTCIceCandidate(candidate))
    }
    this.pendingCandidates.delete(message.connectionId)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)

    await publish(this.mqtt, this.options.mqttTopic ?? DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC, {
      protocol: 'plat-css-v1',
      kind: 'answer',
      senderId: this.serverInstanceId,
      targetId: message.senderId,
      serverName: this.options.serverName,
      connectionId: message.connectionId,
      description: answer,
      identity: this.publicIdentity,
      authorityRecord: this.options.identity?.authorityRecord,
      challengeNonce: message.challengeNonce,
      challengeSignature: message.challengeNonce
        ? await signClientSideServerChallenge(
          this.identityKeyPair!,
          buildClientSideServerIdentityChallenge({
            serverName: this.options.serverName,
            connectionId: message.connectionId,
            challengeNonce: message.challengeNonce,
          }),
        )
        : undefined,
      at: Date.now(),
    })
  }

  private async ensureIdentity(): Promise<void> {
    if (this.identityKeyPair && this.publicIdentity) return
    const storageKey = this.options.identity?.keyPairStorageKey ?? `plat-css:keypair:${this.options.serverName}`
    this.identityKeyPair = this.options.identity?.keyPair
      ?? await getOrCreateClientSideServerIdentityKeyPair({
        storage: this.options.identity?.storage,
        storageKey,
      })
    this.publicIdentity = await toClientSideServerPublicIdentity(this.identityKeyPair)
  }
}

export function createClientSideServerMQTTWebRTCTransportPlugin(
  options: ClientSideServerMQTTWebRTCOptions = {},
): OpenAPIClientTransportPlugin {
  if (isDefaultMQTTWebRTCOptions(options)) {
    defaultTransportPlugin ??= createClientSideServerMQTTWebRTCTransportPluginInternal(options)
    return defaultTransportPlugin
  }
  return createClientSideServerMQTTWebRTCTransportPluginInternal(options)
}

function createClientSideServerMQTTWebRTCTransportPluginInternal(
  options: ClientSideServerMQTTWebRTCOptions,
): OpenAPIClientTransportPlugin {
  const pool = createClientSideServerMQTTWebRTCPeerPool(options)
  return createClientSideServerTransportPlugin({
    connect: async ({ address }) => {
      const session = await pool.connect(address)
      return {
        send: (message) => session.send(message),
        subscribe: (listener) => session.subscribe(listener),
        close: () => undefined,
      }
    },
  })
}

export function createClientSideServerMQTTWebRTCPeerPool(
  options: ClientSideServerMQTTWebRTCOptions = {},
): ClientSideServerPeerPool {
  if (isDefaultMQTTWebRTCOptions(options)) {
    defaultPeerPool ??= createClientSideServerMQTTWebRTCPeerPoolInternal(options)
    return defaultPeerPool
  }
  return createClientSideServerMQTTWebRTCPeerPoolInternal(options)
}

function createClientSideServerMQTTWebRTCPeerPoolInternal(
  options: ClientSideServerMQTTWebRTCOptions,
): ClientSideServerPeerPool {
  const sessions = new Map<string, Promise<ClientSideServerPeerSession>>()

  const normalizeAddress = (input: string | ClientSideServerAddress) =>
    typeof input === 'string' ? parseClientSideServerAddress(input) : input

  const connect = async (input: string | ClientSideServerAddress): Promise<ClientSideServerPeerSession> => {
    const address = normalizeAddress(input)
    const existing = sessions.get(address.href)
    if (existing) {
      const session = await existing
      if (session.isOpen()) return session
      sessions.delete(address.href)
    }

    const created = createClientSideServerMQTTWebRTCPeerSession(address, options)
    sessions.set(address.href, created)
    try {
      return await created
    } catch (error) {
      sessions.delete(address.href)
      throw error
    }
  }

  return {
    connect,
    async close(input) {
      const address = normalizeAddress(input)
      const existing = sessions.get(address.href)
      if (!existing) return
      sessions.delete(address.href)
      const session = await existing
      await session.close?.()
    },
    async closeAll() {
      const pending = Array.from(sessions.values())
      sessions.clear()
      for (const sessionPromise of pending) {
        const session = await sessionPromise
        await session.close?.()
      }
    },
  }
}

async function createClientSideServerMQTTWebRTCPeerSession(
  address: ClientSideServerAddress,
  options: ClientSideServerMQTTWebRTCOptions,
): Promise<ClientSideServerPeerSession> {
  const webrtc = await resolveClientWebRTCImplementation()
  const mqtt = await connectToBroker(options)
  const topic = options.mqttTopic ?? DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC
  const peerId = `${options.clientIdPrefix ?? 'client'}:${randomId('peer')}`
  const connectionId = randomId('conn')
  const challengeNonce = randomId('challenge')
  const peer = new webrtc.RTCPeerConnection({
    iceServers: options.iceServers ?? DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
  })
  const dataChannel = peer.createDataChannel(`plat-css:${connectionId}`)

  const ready = deferred<void>()
  const timeoutMs = options.connectionTimeoutMs ?? (typeof RTCPeerConnection !== 'undefined' ? 15_000 : 30_000)
  const cleanupCallbacks: Array<() => void> = []
  const pendingCandidates: RTCIceCandidateInit[] = []
  const expectedIdentity = await resolveExpectedServerIdentity(address.serverName, options.identity)
  let open = true

  await subscribe(mqtt, topic)

  const onMessage = async (_topic: string, payload: Buffer) => {
    const message = parseSignalingMessage(payload)
    if (!message || message.senderId === peerId || message.targetId !== peerId || message.connectionId !== connectionId) {
      return
    }

    if (message.kind === 'answer' && message.description) {
      await verifyServerIdentityForAnswer({
        serverName: address.serverName,
        connectionId,
        challengeNonce,
        message,
        optionsIdentity: options.identity,
        expectedIdentity,
      })
      await peer.setRemoteDescription(webrtc.createSessionDescription(message.description))
      if (!expectedIdentity && message.authorityRecord && options.identity?.authority?.publicKeyJwk) {
        const trusted = await trustClientSideServerFromAuthorityRecord(
          message.authorityRecord,
          options.identity.authority.publicKeyJwk,
          {
            storage: options.identity?.knownHostsStorage,
            storageKey: options.identity?.knownHostsStorageKey,
          },
        )
        if (options.identity?.knownHosts) {
          saveTrustedClientSideServerRecordToMap(options.identity.knownHosts, trusted)
        }
      } else if (!expectedIdentity && options.identity?.trustOnFirstUse !== false && message.identity) {
        const trusted = await trustClientSideServerOnFirstUse(
          address.serverName,
          message.identity,
          {
            storage: options.identity?.knownHostsStorage,
            storageKey: options.identity?.knownHostsStorageKey,
          },
        )
        if (options.identity?.knownHosts) {
          saveTrustedClientSideServerRecordToMap(options.identity.knownHosts, trusted)
        }
      }
      for (const candidate of pendingCandidates.splice(0, pendingCandidates.length)) {
        await peer.addIceCandidate(webrtc.createIceCandidate(candidate))
      }
      return
    }

    if (message.kind === 'ice' && message.candidate) {
      if (peer.remoteDescription) {
        await peer.addIceCandidate(webrtc.createIceCandidate(message.candidate))
      } else {
        pendingCandidates.push(message.candidate)
      }
    }
  }

  mqtt.on('message', onMessage)
  cleanupCallbacks.push(() => mqtt.off('message', onMessage))

  peer.onicecandidate = (event: any) => {
    if (!event.candidate) return
    void publish(mqtt, topic, {
      protocol: 'plat-css-v1',
      kind: 'ice',
      senderId: peerId,
      targetId: address.serverName,
      connectionId,
      candidate: webrtc.serializeIceCandidate(event.candidate),
      at: Date.now(),
    })
  }

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'failed') {
      ready.reject(new Error(`WebRTC connection to ${address.serverName} failed`))
    }
    if (peer.connectionState === 'failed' || peer.connectionState === 'closed' || peer.connectionState === 'disconnected') {
      open = false
    }
  }

  dataChannel.addEventListener('open', () => ready.resolve(), { once: true })
  dataChannel.addEventListener('error', () => ready.reject(new Error(`Data channel to ${address.serverName} failed`)), { once: true })
  dataChannel.addEventListener(
    'close',
    () => {
      open = false
      ready.reject(new Error(`Data channel to ${address.serverName} closed before becoming ready`))
    },
    { once: true },
  )

  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  await publish(mqtt, topic, {
    protocol: 'plat-css-v1',
    kind: 'offer',
    senderId: peerId,
    targetId: address.serverName,
    serverName: address.serverName,
    connectionId,
    description: offer,
    challengeNonce,
    at: Date.now(),
  })

  const timer = setTimeout(() => {
    ready.reject(new Error(`Timed out connecting to client-side server ${address.serverName}`))
  }, timeoutMs)
  cleanupCallbacks.push(() => clearTimeout(timer))

  await ready.promise

  const channel = createRTCDataChannelAdapter(dataChannel as RTCDataChannel)
  const originalClose = channel.close?.bind(channel)

  return {
    ...channel,
    address,
    connectionId,
    peerId,
    connectedAt: Date.now(),
    isOpen: () => open && dataChannel.readyState === 'open',
    async sendPeer(event, data) {
      await channel.send({
        platcss: 'peer',
        event,
        data,
        fromPeerId: peerId,
        fromServerName: address.serverName,
      })
    },
    subscribePeer(listener) {
      return channel.subscribe(async (message) => {
        if (isClientSideServerPeerMessage(message)) {
          await listener(message)
        }
      })
    },
    async close() {
      if (!open) return
      open = false
      for (const cleanup of cleanupCallbacks) cleanup()
      await originalClose?.()
      await peer.close()
      await endClient(mqtt)
    },
  }
}

async function resolveExpectedServerIdentity(
  serverName: string,
  options?: ClientSideServerIdentityOptions,
): Promise<ClientSideServerTrustedServerRecord | null> {
  const mapped = loadTrustedClientSideServerRecordFromMap(options?.knownHosts, serverName)
  if (mapped) return mapped

  if (options?.authorityServers?.length) {
    const trusted = await resolveTrustedClientSideServerFromAuthorities(
      serverName,
      options.authorityServers,
      {
        storage: options?.knownHostsStorage,
        storageKey: options?.knownHostsStorageKey,
      },
    )
    if (trusted) {
      if (options.knownHosts) {
        saveTrustedClientSideServerRecordToMap(options.knownHosts, trusted)
      }
      return trusted
    }
  }

  const authorityResolved = options?.authorityResolver ? await options.authorityResolver(serverName) : null
  if (authorityResolved) return authorityResolved
  const stored = loadTrustedClientSideServerRecord(serverName, {
    storage: options?.knownHostsStorage,
    storageKey: options?.knownHostsStorageKey,
  })
  if (stored && options?.knownHosts) {
    saveTrustedClientSideServerRecordToMap(options.knownHosts, stored)
  }
  return stored
}

async function verifyServerIdentityForAnswer(input: {
  serverName: string
  connectionId: string
  challengeNonce: string
  message: ClientSideServerSignalingMessage
  optionsIdentity?: ClientSideServerIdentityOptions
  expectedIdentity: ClientSideServerTrustedServerRecord | null
}): Promise<void> {
  const { message, serverName, connectionId, challengeNonce, expectedIdentity } = input
  if (!message.identity || !message.challengeSignature) {
    if (expectedIdentity) {
      throw new Error(`Server ${serverName} did not provide identity proof`)
    }
    return
  }

  if (message.authorityRecord && input.optionsIdentity?.authority?.publicKeyJwk) {
    const authorityOk = await verifySignedClientSideServerAuthorityRecord(
      message.authorityRecord,
      input.optionsIdentity.authority.publicKeyJwk,
    )
    if (!authorityOk) {
      throw new Error(`Server ${serverName} provided an invalid authority record`)
    }
    if (!clientSideServerPublicKeysEqual(message.authorityRecord.publicKeyJwk, message.identity.publicKeyJwk)) {
      throw new Error(`Server ${serverName} authority record does not match presented identity`)
    }
  }

  const verified = await verifyClientSideServerChallenge(
    message.identity.publicKeyJwk,
    buildClientSideServerIdentityChallenge({
      serverName,
      connectionId,
      challengeNonce,
    }),
    message.challengeSignature,
  )
  if (!verified) {
    throw new Error(`Server ${serverName} failed identity challenge verification`)
  }

  if (expectedIdentity && !clientSideServerPublicKeysEqual(expectedIdentity.publicKeyJwk, message.identity.publicKeyJwk)) {
    throw new Error(`Server ${serverName} presented an unexpected public key`)
  }
}

export function createClientSideServerMQTTWebRTCServer(
  options: ClientSideServerMQTTWebRTCServerOptions,
): ClientSideServerMQTTWebRTCServer {
  return new ClientSideServerMQTTWebRTCServer(options)
}

async function connectToBroker(options: ClientSideServerMQTTWebRTCOptions): Promise<MqttClient> {
  const client = resolveMqttConnect()(
    options.mqttBroker ?? DEFAULT_CLIENT_SIDE_SERVER_MQTT_BROKER,
    options.mqttOptions,
  )
  await new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      client.off('connect', onConnect)
      client.off('error', onError)
    }
    client.on('connect', onConnect)
    client.on('error', onError)
  })
  return client
}

function resolveMqttConnect(): (brokerUrl: string, options?: IClientOptions) => MqttClient {
  const connect = mqtt.connect ?? (mqtt as any).default?.connect
  if (typeof connect !== 'function') {
    throw new Error('The loaded mqtt module does not expose a connect function')
  }
  return connect as (brokerUrl: string, options?: IClientOptions) => MqttClient
}

function subscribe(client: MqttClient, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function publish(client: MqttClient, topic: string, message: ClientSideServerSignalingMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(message), (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function endClient(client: MqttClient): Promise<void> {
  return new Promise((resolve) => {
    client.end(false, {}, () => resolve())
  })
}

function parseSignalingMessage(payload: Buffer | Uint8Array): ClientSideServerSignalingMessage | null {
  try {
    const text = payload instanceof Uint8Array ? new TextDecoder().decode(payload) : String(payload)
    const parsed = JSON.parse(text) as ClientSideServerSignalingMessage
    if (parsed?.protocol !== 'plat-css-v1' || typeof parsed.kind !== 'string' || typeof parsed.senderId !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}`
}

function isDefaultMQTTWebRTCOptions(options: ClientSideServerMQTTWebRTCOptions): boolean {
  return Object.keys(options).length === 0
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface ClientWebRTCImplementation {
  RTCPeerConnection: new (config: { iceServers: RTCIceServer[] }) => any
  createSessionDescription(description: RTCSessionDescriptionInit): RTCSessionDescriptionInit
  createIceCandidate(candidate: RTCIceCandidateInit): RTCIceCandidateInit
  serializeIceCandidate(candidate: any): RTCIceCandidateInit
}

async function resolveClientWebRTCImplementation(): Promise<ClientWebRTCImplementation> {
  if (typeof RTCPeerConnection !== 'undefined') {
    return {
      RTCPeerConnection,
      createSessionDescription: (description) => new RTCSessionDescription(description),
      createIceCandidate: (candidate) => new RTCIceCandidate(candidate),
      serializeIceCandidate: (candidate) => candidate.toJSON(),
    }
  }

  try {
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>
    const wrtcModule = await dynamicImport('@roamhq/wrtc')
    const wrtc = (wrtcModule as any).default ?? wrtcModule
    if (typeof wrtc?.RTCPeerConnection === 'function') {
      return {
        RTCPeerConnection: wrtc.RTCPeerConnection,
        createSessionDescription: (description) => new wrtc.RTCSessionDescription(description),
        createIceCandidate: (candidate) => new wrtc.RTCIceCandidate(candidate),
        serializeIceCandidate: (candidate) => candidate.toJSON(),
      }
    }
  } catch (error) {
    throw new Error(
      `Node css:// support requires @roamhq/wrtc to be available: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  throw new Error('Node css:// support requires @roamhq/wrtc to expose RTCPeerConnection')
}
