# Multi-Server Worker Support (Current Implementation)

> **Recommended for HTTP Interception:** Use the **Service Worker bridge** (`SERVICE_WORKER_BRIDGE.md`) for universal request interception. The Service Worker approach intercepts all requests at the browser's network layer with minimal code and maximum reliability.

This document describes what is implemented today in the TypeScript `css://` stack, including client options, server options, self-identification metadata, and practical usage.

Primary sources:
- `typescript/src/client-side-server/mqtt-webrtc.ts`
- `typescript/src/client-side-server/worker-pool.ts`
- `typescript/src/client-side-server/server.ts`
- `typescript/src/client-side-server/runtime.ts`
- `typescript/src/client-side-server/plat-service-worker.ts` (Service Worker bridge)
- `typescript/src/client-side-server/plat-service-worker-client.ts` (Main thread handler)

## What Is Implemented

- Connect-first discovery is implemented (`offer` + MQTT `discover` in parallel).
- Targeted secondary offers (`targetId = instanceId`) are implemented.
- Multi-worker session management is implemented (active + standby, health checks, failover, rediscovery).
- MQTT challenge verification and WebRTC answer challenge verification are implemented.
- Server drain signaling (`{ platcss: 'drain' }`) is implemented.
- Server self-identification metadata is implemented in MQTT announces and via `GET /server-info`.

## API Surface

Exports you will use from `@modularizer/plat/client-server`:
- `createClientSideServerMQTTWebRTCTransportPlugin`
- `createClientSideServerMQTTWebRTCPeerPool`
- `createClientSideServerMQTTWebRTCServer`
- `createClientSideServerMultiWorkerPool`
- `createClientSideServerMQTTWebRTCPeerSession`
- `connectFirstDiscovery`
- `discoverClientSideServers`
- `runClientSideServer`
- `connectClientSideServer`

## Client Options

`ClientSideServerMQTTWebRTCOptions`:

| Option | Type | Purpose |
|---|---|---|
| `mqttBroker` | `string` | MQTT broker URL (default: `wss://broker.emqx.io:8084/mqtt`) |
| `mqttTopic` | `string` | MQTT signaling topic (default: `mrtchat/plat-css`) |
| `mqttOptions` | `IClientOptions` | Raw MQTT client options |
| `iceServers` | `RTCIceServer[]` | WebRTC ICE server list |
| `connectionTimeoutMs` | `number` | Peer connection timeout |
| `announceIntervalMs` | `number` | Server heartbeat interval |
| `clientIdPrefix` | `string` | Prefix for generated MQTT peer IDs |
| `identity` | `ClientSideServerIdentityOptions` | Trust + authority + keypair options |
| `workerPool` | `ClientSideServerWorkerPoolOptions` | Enables/configures multi-worker behavior |
| `requirePrivateChallenge` | `boolean` | Declared, but currently not enforced client-side |

`ClientSideServerWorkerPoolOptions`:

| Option | Default | Behavior |
|---|---:|---|
| `maxActiveWorkers` | `1` | Max active workers |
| `maxStandbyWorkers` | `0` | Max standby workers |
| `maxTotalConnections` | `maxActive + maxStandby` | Global cap |
| `rediscoveryThreshold` | `1` | Rediscover when active count drops below this |
| `discoveryTimeoutMs` | `3000` | MQTT discovery collection window |
| `passiveDiscovery` | `false` | Declared; no periodic-announce auto-enroll loop yet |
| `rankCandidates` | n/a | Custom sort/filter of candidates |
| `assignWeights` | n/a | Custom worker weight assignment |
| `routingStrategy` | `'weighted-random'` | Also supports `'round-robin'`, `'least-pending'`, `'primary-with-fallback'` |
| `healthCheckIntervalMs` | `10000` | Ping cadence (`0` disables) |
| `healthCheckTimeoutMs` | `5000` | Timeout tolerance on pongs |

### Multi-worker Activation Rule

Transport plugin switches to multi-worker mode only when:
- `workerPool.maxActiveWorkers > 1`, or
- `workerPool.maxStandbyWorkers > 0`.

Otherwise the existing single-session peer pool is used.

## Server Options

`ClientSideServerMQTTWebRTCServerOptions`:

| Option | Type | Purpose |
|---|---|---|
| `serverName` | `string` | Logical css server name |
| `server` | `PLATClientSideServer` | Bound request handler server |
| `workerInfo` | `ClientSideServerWorkerInfo` | Weight + load metadata for discovery responses |
| `instanceInfo` | `ClientSideServerInstanceInfo` | Version/self-identification metadata |
| plus all client transport fields | - | Broker/topic/ICE/identity/etc |

`ClientSideServerWorkerInfo` fields:
- `weight?: number`
- `suggestedWorkerCount?: number`
- `currentClients?: number`
- `acceptingNewClients?: boolean`
- `loadBalancing?: { strategy?: 'weighted-random' | 'round-robin' | 'least-connections' | 'none'; maxClientsPerInstance?: number }`

## Server Self-Identification Metadata

`ClientSideServerInstanceInfo`:

| Field | Meaning |
|---|---|
| `version` | Human app/protocol version |
| `versionHash` | Commit hash / source hash / build hash |
| `openapiHash` | Stable SHA-256 hash of generated `openapi.json` |
| `updatedAt` | App update timestamp (ms epoch) |
| `serverStartedAt` | Server instance start timestamp (ms epoch) |

### Where Metadata Is Published

1. MQTT `announce` messages include `instanceInfo`.
2. `GET /server-info` returns resolved instance info from the connected server.

### How Values Are Resolved

- `openapiHash` is auto-computed from stable-stringified OpenAPI JSON in `PLATClientSideServer`.
- `serverStartedAt` is set at signaler start time.
- `version`, `versionHash`, and `updatedAt` are caller-supplied.

## Signaling Behavior (Current)

- Discovery request: `kind: 'discover'`, nonce format includes `-mqtt`.
- Discovery response: `kind: 'announce'` with `challengeNonce`, `challengeSignature`, `workerInfo`, `instanceInfo`.
- Periodic heartbeat announce does not include challenge fields.
- Server accepts offers targeted to either `serverName` or `serverInstanceId`.

## Usage

### 1) Start a Multi-Server Worker with Metadata

```typescript
import { runClientSideServer } from '@modularizer/plat/client-server'

const runtime = await runClientSideServer(sourceCode, {
  workerInfo: {
    weight: 4,
    acceptingNewClients: true,
    suggestedWorkerCount: 3,
  },
  instanceInfo: {
    version: '1.3.0',
    versionHash: '9f4c0d1',
    updatedAt: Date.now(),
  },
})
```

### 2) Connect Client with Multi-Worker Pool

```typescript
import { connectClientSideServer } from '@modularizer/plat/client-server'

const { client } = await connectClientSideServer({
  baseUrl: 'css://multi-demo',
  workerPool: {
    maxActiveWorkers: 3,
    maxStandbyWorkers: 2,
    routingStrategy: 'least-pending',
    discoveryTimeoutMs: 3000,
  },
})
```

### 3) Discover and Rank Before Connecting More Workers

```typescript
import { discoverClientSideServers } from '@modularizer/plat/client-server'

const result = await discoverClientSideServers('multi-demo', {
  workerPool: { discoveryTimeoutMs: 2500 },
})

// Example custom decision logic using server self-identification
const preferred = result.candidates
  .filter((c) => c.instanceInfo?.version?.startsWith('1.3.'))
  .sort((a, b) => (b.workerInfo.weight ?? 3) - (a.workerInfo.weight ?? 3))
```

### 4) Query `GET /server-info` on a Session

```typescript
import { createClientSideServerMQTTWebRTCPeerSession, parseClientSideServerAddress } from '@modularizer/plat/client-server'

const address = parseClientSideServerAddress('css://multi-demo')
const session = await createClientSideServerMQTTWebRTCPeerSession(address, {})

const requestId = `si-${Date.now()}`
const info = await new Promise<any>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), 10_000)
  const unsub = session.subscribe((msg: any) => {
    if (msg.id !== requestId) return
    clearTimeout(timer)
    unsub()
    msg.ok ? resolve(msg.result) : reject(new Error(msg.error?.message ?? 'server-info failed'))
  })
  void session.send({ jsonrpc: '2.0', id: requestId, method: 'GET', path: '/server-info' })
})
```

## Known Gaps / Caveats

- `requirePrivateChallenge` is declared in options but not currently consumed by client connect flow.
- `passiveDiscovery` is declared but periodic announce auto-enrollment is not yet implemented in `worker-pool.ts`.
- Rediscovery de-duplication in worker pool currently compares by public key; if multiple instances share one keypair, they can be treated as already connected.
- Authority multi-key array model is only partially wired in public option typing; primary runtime path still behaves like single expected key for strict answer verification.

## Practical Recommendation

If you need custom worker selection today:

1. Publish `instanceInfo` (`version`, `versionHash`, `updatedAt`) on each server.
2. Use `discoverClientSideServers(...)` and inspect `candidate.instanceInfo` + `candidate.workerInfo`.
3. Connect targeted workers with `createClientSideServerMQTTWebRTCPeerSession(..., candidate.instanceId)`.
4. Keep a periodic rediscovery loop in app code until passive discovery lands in core.
