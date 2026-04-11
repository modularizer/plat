import mqtt from 'mqtt'
import {
  createClientSideServerMQTTWebRTCPeerSession,
  createClientSideServerMQTTWebRTCServer,
} from './mqtt-webrtc'
import {
  createInMemoryClientSideServerStorage,
  generateClientSideServerEncryptionKeyPair,
  generateClientSideServerIdentityKeyPair,
  getClientSideServerEncryptionPublicKeyFingerprint,
  getClientSideServerPublicKeyFingerprint,
} from './identity'
import { parseClientSideServerAddress } from './signaling'

class FakeBroker {
  readonly clients = new Set<FakeMqttClient>()
  readonly messages: Array<{ topic: string; payload: string }> = []

  createClient(): FakeMqttClient {
    const client = new FakeMqttClient(this)
    this.clients.add(client)
    return client
  }

  publish(topic: string, payload: string): void {
    this.messages.push({ topic, payload })
    for (const client of this.clients) {
      if (!client.subscriptions.has(topic)) continue
      queueMicrotask(() => {
        client.emit('message', topic, Buffer.from(payload))
      })
    }
  }

  disconnect(client: FakeMqttClient): void {
    this.clients.delete(client)
  }
}

class FakeMqttClient {
  readonly subscriptions = new Set<string>()
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>()

  constructor(private readonly broker: FakeBroker) {}

  on(event: string, listener: (...args: any[]) => void): this {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
    if (event === 'connect') {
      queueMicrotask(() => listener())
    }
    return this
  }

  off(event: string, listener: (...args: any[]) => void): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args)
    }
  }

  subscribe(topic: string, callback?: (error?: Error) => void): void {
    this.subscriptions.add(topic)
    callback?.()
  }

  publish(topic: string, payload: string, callback?: (error?: Error) => void): void {
    this.broker.publish(topic, payload)
    callback?.()
  }

  end(_force?: boolean, _opts?: unknown, callback?: () => void): void {
    this.broker.disconnect(this)
    callback?.()
  }
}

class FakeRTCSessionDescription {
  type: RTCSdpType
  sdp?: string

  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type
    this.sdp = init.sdp
  }
}

class FakeRTCIceCandidate {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null

  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate
    this.sdpMid = init.sdpMid
    this.sdpMLineIndex = init.sdpMLineIndex
  }

  toJSON(): RTCIceCandidateInit {
    return {
      candidate: this.candidate,
      sdpMid: this.sdpMid ?? undefined,
      sdpMLineIndex: this.sdpMLineIndex ?? undefined,
    }
  }
}

class FakeRTCDataChannel {
  readonly label: string
  readyState: RTCDataChannelState = 'connecting'
  private readonly listeners = new Map<string, Set<(event?: any) => void>>()

  constructor(label: string) {
    this.label = label
  }

  send(_data: any): void {}

  addEventListener(event: string, listener: (event?: any) => void): void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
  }

  removeEventListener(event: string, listener: (event?: any) => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  close(): void {
    this.readyState = 'closed'
    this.dispatch('close')
  }

  open(): void {
    this.readyState = 'open'
    this.dispatch('open')
  }

  private dispatch(event: string, payload?: any): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload)
    }
  }
}

class FakeRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  connectionState: RTCPeerConnectionState = 'new'
  onicecandidate: ((event: { candidate: FakeRTCIceCandidate | null }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((event: { channel: FakeRTCDataChannel }) => void) | null = null
  private dataChannel?: FakeRTCDataChannel

  constructor(_config: { iceServers: RTCIceServer[] }) {}

  createDataChannel(label: string): FakeRTCDataChannel {
    this.dataChannel = new FakeRTCDataChannel(label)
    return this.dataChannel
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake-offer' }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'fake-answer' }
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description
    this.onicecandidate?.({
      candidate: new FakeRTCIceCandidate({ candidate: `candidate:${description.type}` }),
    })
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description
    if (description.type === 'offer') {
      this.ondatachannel?.({ channel: new FakeRTCDataChannel('server-channel') })
      return
    }
    if (description.type === 'answer' && this.dataChannel) {
      this.connectionState = 'connected'
      this.onconnectionstatechange?.()
      this.dataChannel.open()
    }
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {}

  close(): void {
    this.connectionState = 'closed'
    this.onconnectionstatechange?.()
  }
}

describe('client-side-server MQTT/WebRTC secure signaling', () => {
  let broker: FakeBroker
  let connectSpy: jest.SpyInstance
  let previousRTCPeerConnection: any
  let previousRTCSessionDescription: any
  let previousRTCIceCandidate: any

  beforeEach(() => {
    broker = new FakeBroker()
    connectSpy = jest.spyOn(mqtt as any, 'connect').mockImplementation(() => broker.createClient() as any)
    previousRTCPeerConnection = (globalThis as any).RTCPeerConnection
    previousRTCSessionDescription = (globalThis as any).RTCSessionDescription
    previousRTCIceCandidate = (globalThis as any).RTCIceCandidate
    ;(globalThis as any).RTCPeerConnection = FakeRTCPeerConnection
    ;(globalThis as any).RTCSessionDescription = FakeRTCSessionDescription
    ;(globalThis as any).RTCIceCandidate = FakeRTCIceCandidate
  })

  afterEach(() => {
    connectSpy.mockRestore()
    ;(globalThis as any).RTCPeerConnection = previousRTCPeerConnection
    ;(globalThis as any).RTCSessionDescription = previousRTCSessionDescription
    ;(globalThis as any).RTCIceCandidate = previousRTCIceCandidate
  })

  it('uses sealed MQTT envelopes for offer/answer/ice in secure mode', async () => {
    const signingKeyPair = await generateClientSideServerIdentityKeyPair()
    const encryptionKeyPair = await generateClientSideServerEncryptionKeyPair()
    const signingFingerprint = await getClientSideServerPublicKeyFingerprint(signingKeyPair.publicKeyJwk)
    const encryptionFingerprint = await getClientSideServerEncryptionPublicKeyFingerprint(encryptionKeyPair.publicKeyJwk)

    const server = createClientSideServerMQTTWebRTCServer({
      serverName: 'demo',
      server: {
        async getServerInfo() {
          return {}
        },
        serveChannel() {
          return () => undefined
        },
      } as any,
      identity: {
        keyPair: signingKeyPair,
      },
      serverEncryptionKeyPair: encryptionKeyPair,
    })

    await server.start()

    const session = await createClientSideServerMQTTWebRTCPeerSession(parseClientSideServerAddress('css://demo'), {
      identity: {
        knownHosts: {
          demo: {
            serverName: 'demo',
            signingPublicKeyJwk: signingKeyPair.publicKeyJwk,
            encryptionPublicKeyJwk: encryptionKeyPair.publicKeyJwk,
            signingKeyId: signingKeyPair.keyId,
            encryptionKeyId: encryptionKeyPair.keyId,
            signingFingerprint,
            encryptionFingerprint,
            trustedAt: Date.now(),
            source: 'manual',
          },
        },
        trustOnFirstUse: false,
      },
    })

    const sealedMessages = broker.messages
      .filter((message) => message.topic === 'plat')
      .map((message) => JSON.parse(message.payload))

    expect(sealedMessages.length).toBeGreaterThan(0)
    expect(sealedMessages.every((message) => message.platcss === 'sealed')).toBe(true)
    expect(sealedMessages.every((message) => !('serverName' in message))).toBe(true)
    expect(
      broker.messages.some((message) => {
        try {
          const parsed = JSON.parse(message.payload)
          return parsed.protocol === 'plat-css-v1' && ['offer', 'answer', 'ice', 'reject'].includes(parsed.kind)
        } catch {
          return false
        }
      }),
    ).toBe(false)

    expect(session.identity?.publicKeyJwk).toEqual(signingKeyPair.publicKeyJwk)

    await session.close()
    await server.stop()
  })

  it('preserves plaintext signaling when secureSignaling is disabled', async () => {
    const signingKeyPair = await generateClientSideServerIdentityKeyPair()

    const server = createClientSideServerMQTTWebRTCServer({
      serverName: 'legacy-demo',
      server: {
        async getServerInfo() {
          return {}
        },
        serveChannel() {
          return () => undefined
        },
      } as any,
      identity: {
        keyPair: signingKeyPair,
      },
      secureSignaling: false,
    })

    await server.start()

    const session = await createClientSideServerMQTTWebRTCPeerSession(parseClientSideServerAddress('css://legacy-demo'), {
      secureSignaling: false,
      identity: {
        trustOnFirstUse: true,
        knownHostsStorage: createInMemoryClientSideServerStorage(),
      },
    })

    const plaintextKinds = broker.messages
      .map((message) => {
        try {
          return JSON.parse(message.payload).kind as string | undefined
        } catch {
          return undefined
        }
      })
      .filter(Boolean)

    expect(plaintextKinds).toContain('offer')
    expect(plaintextKinds).toContain('answer')
    expect(plaintextKinds).toContain('ice')

    await session.close()
    await server.stop()
  })

  it('bootstraps the server encryption public key over public MQTT when it is not already trusted', async () => {
    const signingKeyPair = await generateClientSideServerIdentityKeyPair()

    const server = createClientSideServerMQTTWebRTCServer({
      serverName: 'static-site',
      server: {
        async getServerInfo() {
          return {}
        },
        serveChannel() {
          return () => undefined
        },
      } as any,
      identity: {
        keyPair: signingKeyPair,
      },
    })

    await server.start()

    const session = await createClientSideServerMQTTWebRTCPeerSession(parseClientSideServerAddress('css://static-site'), {
      identity: {
        trustOnFirstUse: true,
        knownHostsStorage: createInMemoryClientSideServerStorage(),
      },
    })

    const plaintextKinds = broker.messages
      .map((message) => {
        try {
          return JSON.parse(message.payload).kind as string | undefined
        } catch {
          return undefined
        }
      })
      .filter(Boolean)

    const sealedMessages = broker.messages
      .filter((message) => message.topic === 'plat')
      .map((message) => JSON.parse(message.payload))

    expect(plaintextKinds).toContain('discover')
    expect(plaintextKinds).toContain('announce')
    expect(plaintextKinds).not.toContain('offer')
    expect(plaintextKinds).not.toContain('answer')
    expect(sealedMessages.length).toBeGreaterThan(0)
    expect(sealedMessages.every((message) => message.platcss === 'sealed')).toBe(true)
    expect(session.identity?.publicKeyJwk).toEqual(signingKeyPair.publicKeyJwk)

    await session.close()
    await server.stop()
  })

  it('ignores replayed sealed envelopes', async () => {
    const signingKeyPair = await generateClientSideServerIdentityKeyPair()
    const encryptionKeyPair = await generateClientSideServerEncryptionKeyPair()
    const signingFingerprint = await getClientSideServerPublicKeyFingerprint(signingKeyPair.publicKeyJwk)
    const encryptionFingerprint = await getClientSideServerEncryptionPublicKeyFingerprint(encryptionKeyPair.publicKeyJwk)

    const server = createClientSideServerMQTTWebRTCServer({
      serverName: 'replay-demo',
      server: {
        async getServerInfo() {
          return {}
        },
        serveChannel() {
          return () => undefined
        },
      } as any,
      identity: {
        keyPair: signingKeyPair,
      },
      serverEncryptionKeyPair: encryptionKeyPair,
    })

    await server.start()

    const session = await createClientSideServerMQTTWebRTCPeerSession(parseClientSideServerAddress('css://replay-demo'), {
      identity: {
        knownHosts: {
          'replay-demo': {
            serverName: 'replay-demo',
            signingPublicKeyJwk: signingKeyPair.publicKeyJwk,
            encryptionPublicKeyJwk: encryptionKeyPair.publicKeyJwk,
            signingKeyId: signingKeyPair.keyId,
            encryptionKeyId: encryptionKeyPair.keyId,
            signingFingerprint,
            encryptionFingerprint,
            trustedAt: Date.now(),
            source: 'manual',
          },
        },
        trustOnFirstUse: false,
      },
    })

    const firstClientSealed = broker.messages.find((message) => {
      if (message.topic !== 'plat') return false
      try {
        const parsed = JSON.parse(message.payload)
        return parsed.platcss === 'sealed' && typeof parsed.senderId === 'string' && parsed.senderId.startsWith('client:')
      } catch {
        return false
      }
    })
    expect(firstClientSealed).toBeDefined()

    const serverSealedCountBeforeReplay = broker.messages.filter((message) => {
      if (message.topic !== 'plat') return false
      try {
        const parsed = JSON.parse(message.payload)
        return parsed.platcss === 'sealed' && typeof parsed.senderId === 'string' && parsed.senderId.startsWith('replay-demo:')
      } catch {
        return false
      }
    }).length

    broker.publish('plat', firstClientSealed!.payload)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    const serverSealedCountAfterReplay = broker.messages.filter((message) => {
      if (message.topic !== 'plat') return false
      try {
        const parsed = JSON.parse(message.payload)
        return parsed.platcss === 'sealed' && typeof parsed.senderId === 'string' && parsed.senderId.startsWith('replay-demo:')
      } catch {
        return false
      }
    }).length

    expect(serverSealedCountAfterReplay).toBe(serverSealedCountBeforeReplay)

    await session.close()
    await server.stop()
  })

  it('rejects bad sealed signaling credentials with auth-failed', async () => {
    const signingKeyPair = await generateClientSideServerIdentityKeyPair()
    const encryptionKeyPair = await generateClientSideServerEncryptionKeyPair()
    const signingFingerprint = await getClientSideServerPublicKeyFingerprint(signingKeyPair.publicKeyJwk)
    const encryptionFingerprint = await getClientSideServerEncryptionPublicKeyFingerprint(encryptionKeyPair.publicKeyJwk)

    const server = createClientSideServerMQTTWebRTCServer({
      serverName: 'auth-demo',
      server: {
        async getServerInfo() {
          return {}
        },
        serveChannel() {
          return () => undefined
        },
      } as any,
      identity: {
        keyPair: signingKeyPair,
      },
      serverEncryptionKeyPair: encryptionKeyPair,
      signalingAuth: {
        required: true,
        verify: ({ username, password }) => username === 'user' && password === 'pass',
      },
    })

    await server.start()

    await expect(createClientSideServerMQTTWebRTCPeerSession(
      parseClientSideServerAddress('css://auth-demo?username=bad&password=creds'),
      {
        identity: {
          knownHosts: {
            'auth-demo': {
              serverName: 'auth-demo',
              signingPublicKeyJwk: signingKeyPair.publicKeyJwk,
              encryptionPublicKeyJwk: encryptionKeyPair.publicKeyJwk,
              signingKeyId: signingKeyPair.keyId,
              encryptionKeyId: encryptionKeyPair.keyId,
              signingFingerprint,
              encryptionFingerprint,
              trustedAt: Date.now(),
              source: 'manual',
            },
          },
          trustOnFirstUse: false,
        },
      },
    )).rejects.toThrow(/auth-failed/i)

    await server.stop()
  })
})



