import * as mqttModule from 'mqtt'
import type { IClientOptions, MqttClient } from 'mqtt'
import { createClientSideServerTransportPlugin } from '../client/css-transport-plugin'
import type { OpenAPIClientTransportPlugin } from '../client/transport-plugin'
import { createRTCDataChannelAdapter } from './channel'
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
}

export interface ClientSideServerMQTTWebRTCServerOptions extends ClientSideServerMQTTWebRTCOptions {
  serverName: string
  server: PLATClientSideServer
}

export class ClientSideServerMQTTWebRTCServer {
  private mqtt?: MqttClient
  private readonly serverInstanceId: string
  private readonly unsubscribeByConnection = new Map<string, () => void>()
  private readonly peers = new Map<string, RTCPeerConnection>()
  private readonly pendingCandidates = new Map<string, RTCIceCandidateInit[]>()
  private announceTimer?: ReturnType<typeof setInterval>

  constructor(private options: ClientSideServerMQTTWebRTCServerOptions) {
    this.serverInstanceId = `${options.serverName}:${randomId('server')}`
  }

  get connectionUrl(): string {
    return `css://${this.options.serverName}`
  }

  async start(): Promise<void> {
    if (this.mqtt) return

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
      at: Date.now(),
    })
  }
}

export function createClientSideServerMQTTWebRTCTransportPlugin(
  options: ClientSideServerMQTTWebRTCOptions = {},
): OpenAPIClientTransportPlugin {
  return createClientSideServerTransportPlugin({
    connect: async ({ address }) => {
      const mqtt = await connectToBroker(options)
      const topic = options.mqttTopic ?? DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC
      const clientInstanceId = `${options.clientIdPrefix ?? 'client'}:${randomId('peer')}`
      const connectionId = randomId('conn')
      const peer = new RTCPeerConnection({
        iceServers: options.iceServers ?? DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
      })
      const dataChannel = peer.createDataChannel(`plat-css:${connectionId}`)

      const ready = deferred<void>()
      const timeoutMs = options.connectionTimeoutMs ?? 15_000
      const cleanupCallbacks: Array<() => void> = []
      const pendingCandidates: RTCIceCandidateInit[] = []

      await subscribe(mqtt, topic)

      const onMessage = async (_topic: string, payload: Buffer) => {
        const message = parseSignalingMessage(payload)
        if (!message || message.senderId === clientInstanceId || message.targetId !== clientInstanceId || message.connectionId !== connectionId) {
          return
        }

        if (message.kind === 'answer' && message.description) {
          await peer.setRemoteDescription(new RTCSessionDescription(message.description))
          for (const candidate of pendingCandidates.splice(0, pendingCandidates.length)) {
            await peer.addIceCandidate(new RTCIceCandidate(candidate))
          }
          return
        }

        if (message.kind === 'ice' && message.candidate) {
          if (peer.remoteDescription) {
            await peer.addIceCandidate(new RTCIceCandidate(message.candidate))
          } else {
            pendingCandidates.push(message.candidate)
          }
        }
      }

      mqtt.on('message', onMessage)
      cleanupCallbacks.push(() => mqtt.off('message', onMessage))

      peer.onicecandidate = (event) => {
        if (!event.candidate) return
        void publish(mqtt, topic, {
          protocol: 'plat-css-v1',
          kind: 'ice',
          senderId: clientInstanceId,
          targetId: address.serverName,
          connectionId,
          candidate: event.candidate.toJSON(),
          at: Date.now(),
        })
      }

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed') {
          ready.reject(new Error(`WebRTC connection to ${address.serverName} failed`))
        }
      }

      dataChannel.addEventListener('open', () => ready.resolve(), { once: true })
      dataChannel.addEventListener('error', () => ready.reject(new Error(`Data channel to ${address.serverName} failed`)), { once: true })

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await publish(mqtt, topic, {
        protocol: 'plat-css-v1',
        kind: 'offer',
        senderId: clientInstanceId,
        targetId: address.serverName,
        serverName: address.serverName,
        connectionId,
        description: offer,
        at: Date.now(),
      })

      const timer = setTimeout(() => {
        ready.reject(new Error(`Timed out connecting to client-side server ${address.serverName}`))
      }, timeoutMs)
      cleanupCallbacks.push(() => clearTimeout(timer))

      await ready.promise

      const adapter = createRTCDataChannelAdapter(dataChannel)
      const originalClose = adapter.close?.bind(adapter)

      return {
        ...adapter,
        async close() {
          for (const cleanup of cleanupCallbacks) cleanup()
          peer.close()
          await originalClose?.()
          await endClient(mqtt)
        },
      }
    },
  })
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
  const defaultExport = (mqttModule as any).default
  const connect = (mqttModule as any).connect
    ?? defaultExport?.connect
    ?? defaultExport

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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
