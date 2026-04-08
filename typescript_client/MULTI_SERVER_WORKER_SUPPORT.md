# Multi-Server Worker Support for Client-Side Servers (css://)

## Problem Statement

Currently, a `css://serverName` address maps to exactly one server instance. The `ClientSideServerPeerPool` caches a single `ClientSideServerPeerSession` per address and has no concept of multiple servers claiming the same name, failover, or load distribution.

When multiple browser tabs (or Node processes) run a `ClientSideServerMQTTWebRTCServer` with the same `serverName`, only one server answers each offer — whichever happens to process the MQTT message first. There is no coordination, no client-side awareness of the pool, and no recovery if that server tab closes.

This plan adds three capabilities:

1. **Trust** — clients discover *all* servers claiming a name, challenge each one's identity, and verify against known trust authorities.
2. **Load Balancing** — clients maintain weighted connections to multiple verified servers and distribute requests across them.
3. **Failover** — clients detect server disconnections and redistribute load to surviving servers instantly, with the option to re-discover via MQTT if supply drops.

**Design constraints:**
- All new options are optional. Existing single-server behavior remains the default.
- Multi-server behavior activates when the client receives multiple server announcements or when the user explicitly configures worker pool options.
- **Zero added latency for the first connection.** The client must not block on a discovery timeout before it can start using a server. Connect first, discover more in parallel.

---

## Phase 1: Connect-First Discovery

### The Problem with Blocking Discovery

A naive approach would be: broadcast a discovery message, wait N seconds for all servers to respond, then pick the best one and connect. This adds N seconds of latency to *every* initial connection — unacceptable for the common single-server case and painful even in multi-server setups.

### 1.1 The Connect-First Model

Instead, the client connects to the **first answering server immediately** (exactly like today) while simultaneously collecting additional server announcements in the background. Discovery and connection happen in parallel, not sequentially.

**Timeline:**

```
t=0ms    Client publishes offer (targeted at serverName, like today)
         Client also publishes discover message (broadcast, with -mqtt challenge)
         Client begins listening for both WebRTC answers AND discovery announces

t≈200ms  First server answers the WebRTC offer → client starts WebRTC handshake
         This server becomes the "primary" worker immediately

t≈200ms+ More servers publish announce responses to the discover message
         Client collects these as candidates in the background

t≈800ms  WebRTC data channel opens with primary → usable immediately
         Client begins verifying the WebRTC answer challenge (as today)

t=Xms    Discovery window closes (configurable, default 3000ms)
         Client now has a list of additional candidates
         Client connects to top-ranked candidates as additional workers / standby
         (these connections happen in the background, not blocking any requests)
```

**The key insight:** the offer and the discover message go out at the same time. The offer gets you a working connection fast. The discover gets you the full picture of who else is available. You never wait for the discover to finish before using the first connection.

### 1.2 Client Discovery Message (`kind: 'discover'`)

Published simultaneously with the first WebRTC offer:

```typescript
interface ClientSideServerDiscoverMessage {
  protocol: 'plat-css-v1'
  kind: 'discover'
  senderId: string              // client's peer ID
  targetId: string              // the serverName being discovered
  clientIdentity?: ClientSideServerPublicIdentity  // client's public key, if available
  challengeNonce: string        // random nonce, MUST contain the substring "-mqtt"
  at: number
}
```

**Key rules:**
- The `challengeNonce` is generated as `randomId('challenge') + '-mqtt'`. The `-mqtt` suffix is mandatory — it marks this challenge as originating from the public MQTT channel, which is inherently untrusted. Servers that see `-mqtt` in a challenge string know the response will be visible to eavesdroppers.
- The `clientIdentity` field is optional. When provided, servers can use it to decide whether to accept the client (e.g., allowlisting by client key fingerprint).

### 1.3 Server Discovery Response (`kind: 'announce'` — extended)

Every server instance claiming `serverName` responds to the discover message. The existing `announce` message is extended with new optional fields:

```typescript
interface ClientSideServerAnnounceMessage {
  protocol: 'plat-css-v1'
  kind: 'announce'
  senderId: string                    // the server's unique instanceId (e.g., "serverName:server-<uuid>")
  serverName: string
  identity: ClientSideServerPublicIdentity
  authorityRecord?: ClientSideServerSignedAuthorityRecord

  // --- new fields for multi-server support ---
  challengeNonce?: string             // echo back the client's nonce so client can correlate
  challengeSignature?: string         // ECDSA signature over the challenge string (see below)
  workerInfo?: ClientSideServerWorkerInfo
  at: number
}

interface ClientSideServerWorkerInfo {
  weight?: number                     // self-prescribed capability score, 0-5 (default: 3)
  suggestedWorkerCount?: number       // server's suggestion for how many workers client should use
  currentClients?: number             // number of clients currently connected to this instance
  acceptingNewClients?: boolean       // whether this instance will accept new connections (default: true)
  loadBalancing?: ClientSideServerLoadBalancingPreferences
}

interface ClientSideServerLoadBalancingPreferences {
  strategy?: 'weighted-random' | 'round-robin' | 'least-connections' | 'none'
  maxClientsPerInstance?: number      // soft cap — server sets acceptingNewClients=false when reached
}
```

**Challenge string construction for MQTT discovery responses:**

```
plat-css-identity-v1:{serverName}:{serverInstanceId}:{challengeNonce}
```

Since the nonce contains `-mqtt`, this signature is distinguishable from a WebRTC answer challenge. A malicious actor who captures this signature cannot replay it as a WebRTC answer challenge because those nonces never contain `-mqtt`.

**Server behavior:**
- On receiving a `discover` message where `targetId` matches its `serverName`, the server signs the challenge and publishes an `announce` with the new fields.
- Periodic announces (the existing 30s heartbeat) continue but do NOT include `challengeSignature` or `challengeNonce` (those are only sent in response to a specific discover).
- The `workerInfo` fields are populated from `ClientSideServerMQTTWebRTCServerOptions` (all optional).

**Important:** The server that answered the WebRTC offer is likely also one of the servers that responds to the discover. The client deduplicates by matching the announce's `identity.publicKeyJwk` against the already-connected primary's identity.

### 1.4 Client Collects and Ranks Candidates

The client accumulates all announce responses during the discovery window into a `ClientSideServerDiscoveryResult`:

```typescript
interface ClientSideServerDiscoveryCandidate {
  instanceId: string
  serverName: string
  identity: ClientSideServerPublicIdentity
  authorityRecord?: ClientSideServerSignedAuthorityRecord
  mqttChallengeVerified: boolean      // did the MQTT challenge signature verify?
  workerInfo: ClientSideServerWorkerInfo
  discoveredAt: number
  alreadyConnected: boolean           // true if this is the primary we already connected to
}

interface ClientSideServerDiscoveryResult {
  serverName: string
  candidates: ClientSideServerDiscoveryCandidate[]
  discoveredAt: number
}
```

**Processing each announce:**

1. If `challengeSignature` is present, verify it against the server's `identity.publicKeyJwk` using `verifyClientSideServerChallenge()`. Set `mqttChallengeVerified` accordingly.
2. If `authorityRecord` is present and the client has a configured authority public key, verify the authority record using `verifySignedClientSideServerAuthorityRecord()`. If invalid, discard the candidate.
3. Check the candidate's public key against the client's known-hosts store (`ClientSideServerTrustedServerRecord`). If the key is known but doesn't match, flag as suspicious (but don't discard — the trust authority list may include multiple valid keys).
4. If the candidate's public key matches the already-connected primary, mark `alreadyConnected: true` and update the primary's metadata with the `workerInfo`.
5. Default `workerInfo` fields: `weight=3`, `acceptingNewClients=true`, `currentClients=0`.

**Weight trust policy:** Self-reported weights from non-authority-verified servers default to equal weight (3). Only authority-verified servers get their self-reported weights respected, since a rogue server could claim `weight: 5` to attract all traffic. The user can override this via `assignWeights`.

**Ranking algorithm (client-side, configurable via options):**

The default ranking:
1. Filter out candidates where `acceptingNewClients === false` (unless no candidates remain, in which case keep them all).
2. Sort by: authority-verified first, then MQTT-challenge-verified, then by `weight` descending, then by `currentClients` ascending.
3. The user can supply a custom `rankCandidates` function to override this entirely.

### 1.5 Passive Discovery via Periodic Announces

Servers already broadcast periodic announces every 30s. The client can passively listen for these to discover servers that come online *after* the initial discovery window closes.

**Behavior:**
- If the client has an active worker pool session for a `serverName`, it continues listening for `announce` messages on that name.
- When a new `instanceId` appears that isn't in the current pool, the client adds it as a discovered candidate.
- If `maxStandbyWorkers` allows it and the pool has capacity, the client can opportunistically connect to the new server as standby.
- This is opt-in: only active when the worker pool is configured with `maxStandbyWorkers > 0` or `passiveDiscovery: true`.

---

## Phase 2: Connection Establishment — WebRTC to Additional Servers

### 2.1 Deciding How Many Additional Servers to Connect To

After the discovery window closes, the client has a primary (already connected) and a ranked list of additional candidates. It decides how many more to connect to based on `ClientSideServerWorkerPoolOptions`:

```typescript
interface ClientSideServerWorkerPoolOptions {
  /** Maximum number of active (weighted > 0) workers. Default: 1 for backward compat. */
  maxActiveWorkers?: number

  /** Maximum number of standby (weight 0) connections. Default: 0. */
  maxStandbyWorkers?: number

  /** Total cap on connections (active + standby). If too many candidates, excess are dropped. */
  maxTotalConnections?: number

  /** Whether to re-run MQTT discovery if active workers drop below this threshold. Default: 1. */
  rediscoveryThreshold?: number

  /** How long to collect discovery announces (does NOT block the first connection). Default: 3000ms. */
  discoveryTimeoutMs?: number

  /** Continue listening for periodic server announces after discovery window. Default: false. */
  passiveDiscovery?: boolean

  /** Custom candidate ranking function. */
  rankCandidates?: (candidates: ClientSideServerDiscoveryCandidate[]) => ClientSideServerDiscoveryCandidate[]

  /** Custom weight assignment function. Called after challenge verification. */
  assignWeights?: (workers: ClientSideServerWorkerState[]) => void

  /** Override the default request routing strategy. Default: 'weighted-random'. */
  routingStrategy?: 'weighted-random' | 'round-robin' | 'least-pending' | 'primary-with-fallback'

  /** Interval in ms to ping workers for liveness. 0 disables. Default: 10000. */
  healthCheckIntervalMs?: number

  /** Max ms to wait for a pong before marking worker failed. Default: 5000. */
  healthCheckTimeoutMs?: number
}
```

**Default behavior (`maxActiveWorkers=1`, `maxStandbyWorkers=0`):** connects to the first answering server only, exactly like today. The discover message still goes out (so the client learns who's available), but no additional connections are made. No behavioral change for existing users.

**Multi-worker behavior:** When `maxActiveWorkers > 1`, the client connects to additional top-ranked candidates (excluding the already-connected primary) as active workers, and the next M as standby. All additional connections happen in the background — the primary is already usable.

### 2.2 WebRTC Offer per Additional Candidate

For each additional candidate, the client creates a WebRTC peer connection using the existing `createClientSideServerMQTTWebRTCPeerSession` flow. The `challengeNonce` for the WebRTC offer MUST NOT contain `-mqtt`:

```typescript
// Existing nonce generation (used for WebRTC offers):
const challengeNonce = randomId('challenge')
// This will never contain "-mqtt" because randomId uses crypto.randomUUID() or Math.random().toString(36)
```

This is already the case in the current code. The `-mqtt` suffix is only added during MQTT discovery.

**Targeted offers:** Unlike the initial offer (which targets `serverName` and is answered by whichever server gets there first), additional offers are targeted at a specific `instanceId` from the discovery results. This ensures the client connects to the specific server it chose.

```typescript
// Initial offer (unchanged from today):
{ targetId: address.serverName, ... }

// Additional offer (targeted to a specific instance):
{ targetId: candidate.instanceId, ... }
```

The server must accept offers where `targetId` matches either its `serverName` or its `serverInstanceId`.

### 2.3 Challenge Verification

Challenge verification uses the existing two-layer model:

1. **MQTT discovery challenge** (`-mqtt` nonce) — preliminary, over public channel, establishes that the server probably has the key. Useful for ranking but not authoritative.
2. **WebRTC answer challenge** (no `-mqtt`) — authoritative, per-connection. The nonce is unique per `connectionId` and the answer is targeted to the specific client `peerId`. This already exists in `verifyServerIdentityForAnswer()`.

**Why two challenges are sufficient (no third "private channel" challenge needed):**
- The WebRTC answer is targeted (`targetId: peerId`), not broadcast. An eavesdropper sees it on MQTT but can't use it because the nonce is bound to a specific `connectionId` that only the real client created.
- The `-mqtt` / non-`-mqtt` distinction prevents cross-channel replay: an MQTT discovery response signature cannot be reused as a WebRTC answer signature (different nonce format), and vice versa.
- The WebRTC answer challenge already happens *before* the data channel opens. If it fails, the connection is rejected before any data flows.
- Adding a third challenge over the data channel would add latency to every connection for a marginal security gain. The attack it would prevent — an MITM who can *selectively intercept and replace* targeted MQTT messages while also substituting WebRTC offers — is already mitigated by DTLS encryption on the WebRTC transport itself.

**If paranoid mode is desired:** The option `requirePrivateChallenge` can be set to `true`, which adds a post-connect data channel challenge (see Appendix A). This is off by default.

---

## Phase 3: Worker Pool Management

### 3.1 Worker State Machine

Each connected server is tracked as a `ClientSideServerWorkerState`:

```typescript
interface ClientSideServerWorkerState {
  instanceId: string
  session: ClientSideServerPeerSession
  identity: ClientSideServerPublicIdentity
  authorityRecord?: ClientSideServerSignedAuthorityRecord
  status: 'connecting' | 'verifying' | 'active' | 'standby' | 'draining' | 'failed' | 'closed'
  weight: number                      // 0 = standby, 1-5 = active
  serverAdvertisedWeight: number      // what the server claimed
  authorityVerified: boolean          // was this server's key signed by a trust authority?
  pendingRequests: number             // number of in-flight requests
  totalRequests: number               // lifetime request count
  totalErrors: number                 // lifetime error count
  connectedAt: number
  lastRequestAt?: number
  lastErrorAt?: number
  lastPongAt?: number                 // last successful health check response
}
```

**State transitions:**
```
connecting → verifying → active
connecting → verifying → failed
connecting → failed
active → draining → closed
active → failed → (removed or reconnect)
active ↔ standby (promotion / demotion)
standby → closed (when no longer needed)
```

### 3.2 The Multi-Server Peer Pool

The existing `ClientSideServerPeerPool` interface is extended with a new factory:

```typescript
interface ClientSideServerMultiWorkerPool {
  /** Connect to a server name, performing discovery and establishing worker connections. */
  connect(address: string | ClientSideServerAddress): Promise<ClientSideServerWorkerPoolSession>

  /** Shut down all workers for an address. */
  close(address: string | ClientSideServerAddress): Promise<void>

  /** Shut down everything. */
  closeAll(): Promise<void>
}

interface ClientSideServerWorkerPoolSession {
  readonly address: ClientSideServerAddress
  readonly workers: ReadonlyArray<ClientSideServerWorkerState>

  /** Returns true if at least one active worker is open. */
  isOpen(): boolean

  /** Send a message, routed to a worker according to the routing strategy. */
  send(message: ClientSideServerMessage): Promise<void>

  /** Subscribe to messages from any worker in the pool. */
  subscribe(listener: (message: any) => void | Promise<void>): () => void

  /** Force re-discovery of servers for this address. */
  rediscover(): Promise<void>

  /** Manually adjust a worker's weight. */
  setWorkerWeight(instanceId: string, weight: number): void

  close(): Promise<void>
}
```

The existing `ClientSideServerPeerPool` interface remains unchanged and continues to work for single-server use. `ClientSideServerMultiWorkerPool` is a separate, opt-in API. Internally, when `workerPool` options are provided, the transport plugin uses the multi-worker pool; otherwise it uses the existing pool — same external API surface.

### 3.3 Request Routing Strategies

When `send()` is called on the pool session, a worker is selected based on the configured `routingStrategy`:

**`weighted-random` (default):**
- Each active worker has a weight 1-5. The probability of selecting worker `i` is `weight[i] / sum(all weights)`.
- Implementation: generate a random number in `[0, totalWeight)`, iterate workers accumulating weight until the threshold is crossed.

**`round-robin`:**
- Maintain an index counter. On each request, advance to the next active worker (skipping standby/failed).

**`least-pending`:**
- Select the active worker with the lowest `pendingRequests` count. Ties broken by weight descending.

**`primary-with-fallback`:**
- Always route to the highest-weight active worker. If that worker fails or is draining, fall back to the next. This is closest to the current single-server behavior but with automatic failover.

### 3.4 Health Checks (Application-Level Ping/Pong)

WebRTC `connectionState` changes are unreliable for detecting frozen tabs. A browser can throttle a background tab, leaving the connection technically "open" but unresponsive.

The worker pool sends periodic pings over the data channel:

```typescript
// Client sends:
{ platcss: 'ping', ts: number }

// Server responds:
{ platcss: 'pong', ts: number }  // echoes back the client's ts
```

**Behavior:**
- Every `healthCheckIntervalMs` (default: 10000ms), the pool pings each active and standby worker.
- If no pong arrives within `healthCheckTimeoutMs` (default: 5000ms), the worker transitions to `failed`.
- The `lastPongAt` field tracks the last successful response.
- Health checks are lightweight (~50 bytes each) and run on the existing data channel — no new connections.

### 3.5 Failover and Re-discovery

**On worker failure:**
1. Mark the worker as `failed`. Remove it from routing.
2. If a standby worker exists, promote it to `active` with the failed worker's weight (or re-run `assignWeights` if provided).
3. If no standby exists and the number of active workers drops below `rediscoveryThreshold`, trigger `rediscover()`:
   - Publish a new `discover` message on MQTT.
   - Collect responses for `discoveryTimeoutMs`.
   - Connect to any new candidates not already in the pool.
   - Assign weights and update pool state.
4. Re-discovery also happens on the background: if `passiveDiscovery` is enabled, new servers appearing via periodic announces are automatically added as standby candidates.

**Graceful draining:**
- If a server wants to shut down cleanly, it can send a peer message `{ platcss: 'drain' }` over the data channel.
- The client transitions that worker to `draining`: no new requests are routed to it, but in-flight requests complete.
- After all pending requests resolve (or a configurable timeout), the connection is closed.
- If the server has time, it can also publish a final MQTT announce with `acceptingNewClients: false` so new clients avoid it during discovery.

---

## Phase 4: Trust Authority — Multi-Key Support

### 4.1 Authority Records for Multiple Keys

The existing `ClientSideServerSignedAuthorityRecord` binds one `serverName` to one `publicKeyJwk`. To support multiple legitimate servers under the same name, the authority must be able to issue records for each server's key.

**Changes to the authority server (`PLATAuthorityServerOptions`):**

```typescript
interface PLATAuthorityServerOptions {
  authorityName?: string
  authorityKeyPair: ClientSideServerExportedKeyPair
  /** Now maps serverName → array of trusted records, ordered by preference. */
  knownHosts: Record<string, ClientSideServerTrustedServerRecord | ClientSideServerTrustedServerRecord[]>
  allowServerNames?: string[]
  allow?: (serverName: string, record: ClientSideServerTrustedServerRecord) => boolean
}
```

- `knownHosts[serverName]` can now be a single record (backward compatible) or an ordered array of records.
- **Order semantics:** The first record in the array is the "primary" server. This means:
  - In ranking, a server whose key matches position 0 gets a +1 weight bonus by default.
  - When all else is equal, the primary is preferred for `primary-with-fallback` routing.
  - This gives authority operators a meaningful way to express preference without forcing all clients to follow it.
- The `resolveAuthorityHost` endpoint returns a *list* when multiple keys are trusted:

```typescript
// New response shape (backward compatible — single record still works)
type AuthorityResolveResponse =
  | ClientSideServerSignedAuthorityRecord
  | ClientSideServerSignedAuthorityRecord[]
  | null
```

### 4.2 Client-Side Trust Verification for Multi-Key

When the client has authority records listing multiple keys for a server name, verification succeeds if the server's presented key matches *any* record in the list. The client stores all trusted keys:

```typescript
// The known-hosts store for a serverName becomes an ordered array:
// Storage key: 'plat-css:known-hosts'
// Shape: Record<string, ClientSideServerTrustedServerRecord | ClientSideServerTrustedServerRecord[]>
```

**Verification logic update in `verifyServerIdentityForAnswer`:**
1. Load all trusted records for `serverName` (may be a single record or an array).
2. If the presented key matches *any* record in the list, trust is established.
3. If no record matches and `trustOnFirstUse` is enabled, add the new key to the list (appended, not replacing existing entries).
4. Order is preserved from the authority response.

---

## Phase 5: Server-Side Changes

### 5.1 New Server Options

```typescript
interface ClientSideServerMQTTWebRTCServerOptions extends ClientSideServerMQTTWebRTCOptions {
  serverName: string
  server: PLATClientSideServer

  // --- new optional fields ---
  workerInfo?: ClientSideServerWorkerInfo
}
```

All fields in `ClientSideServerWorkerInfo` are optional. If not provided, the server omits worker info from its announcements (backward compatible).

### 5.2 Server Responds to Discovery

In `ClientSideServerMQTTWebRTCServer.onMessage()`, add handling for `kind: 'discover'`:

```
if message.kind === 'discover' && message.targetId === this.options.serverName:
  1. sign the challenge: challenge string = `plat-css-identity-v1:{serverName}:{serverInstanceId}:{message.challengeNonce}`
  2. publish announce with challengeNonce, challengeSignature, workerInfo, identity, authorityRecord
```

The existing periodic `announce` continues unchanged (no challenge fields).

### 5.3 Server Accepts Targeted Offers

Currently, the server only accepts offers where `targetId === this.options.serverName`. For multi-server support, it must also accept offers targeted at its specific `serverInstanceId`:

```
if message.kind === 'offer' && (message.targetId === this.options.serverName || message.targetId === this.serverInstanceId):
  // accept the offer
```

This allows clients to connect to a specific server instance after discovery, rather than having the offer answered by whichever server processes it first.

### 5.4 Server Handles Ping/Pong

In the data channel message handler:

```
if message.platcss === 'ping':
  respond with { platcss: 'pong', ts: message.ts }
```

### 5.5 Server Drain Support

The server can initiate a graceful drain:

```typescript
// On PLATClientSideServer or ClientSideServerMQTTWebRTCServer:
async drain(): Promise<void> {
  // 1. Set acceptingNewClients = false in workerInfo
  // 2. Publish an announce with acceptingNewClients=false on MQTT
  // 3. Send { platcss: 'drain' } to all connected clients over their data channels
  // 4. Wait for all pending operations to complete (or timeout)
  // 5. Close all connections
}
```

---

## Phase 6: Updated Options Interfaces (All Optional)

### 6.1 Client Options (extended `ClientSideServerMQTTWebRTCOptions`)

```typescript
interface ClientSideServerMQTTWebRTCOptions {
  // --- existing (all optional) ---
  mqttBroker?: string
  mqttTopic?: string
  mqttOptions?: IClientOptions
  iceServers?: RTCIceServer[]
  connectionTimeoutMs?: number
  announceIntervalMs?: number
  clientIdPrefix?: string
  identity?: ClientSideServerIdentityOptions

  // --- new (all optional) ---
  workerPool?: ClientSideServerWorkerPoolOptions
  requirePrivateChallenge?: boolean   // default: false (see Appendix A)
}
```

### 6.2 Server Options (extended `ClientSideServerMQTTWebRTCServerOptions`)

```typescript
interface ClientSideServerMQTTWebRTCServerOptions extends ClientSideServerMQTTWebRTCOptions {
  serverName: string
  server: PLATClientSideServer

  // --- new (all optional) ---
  workerInfo?: ClientSideServerWorkerInfo
}
```

### 6.3 When Multi-Server Activates

Multi-server behavior is **not** the default. It activates when:
- The user sets `workerPool.maxActiveWorkers > 1`, OR
- The user sets `workerPool.maxStandbyWorkers > 0`

If `workerPool` is not provided, the existing single-connection-per-address behavior is preserved exactly. The discover message still fires (so the client knows what's out there), but only the first-answering server is connected to.

---

## Sequence Diagrams

### Connect-First Discovery (Multi-Server)

```
Client                          MQTT Broker                    Server A           Server B
  |                                |                              |                  |
  | [t=0: send offer AND discover simultaneously]                 |                  |
  |-- offer(serverName, nonce=n1)->|------------------------------>|                  |
  |-- discover(nonce=xyz-mqtt) --->|------------------------------>|                  |
  |                                |---------------------------------------------->  |
  |                                |                              |                  |
  | [t≈200ms: first answer arrives — start WebRTC handshake]      |                  |
  |<-- answer(sig_A over n1) -----|<------------------------------|                  |
  | [verify WebRTC answer challenge — this is the AUTHORITATIVE trust check]         |
  |                                |                              |                  |
  | [meanwhile, discovery responses arrive in background]         |                  |
  |<-- announce(A, sig_A_mqtt, w=4)|<-----------------------------|                  |
  |<-- announce(B, sig_B_mqtt, w=2)|<----------------------------------------------|
  |                                |                              |                  |
  | [t≈800ms: data channel opens with A — USABLE NOW]            |                  |
  | [A is primary, already serving requests]                      |                  |
  |                                |                              |                  |
  | [t=3000ms: discovery window closes]                           |                  |
  | [rank candidates: A(already connected), B(new, w=2)]          |                  |
  |                                |                              |                  |
  | [connect to B in background]   |                              |                  |
  |-- offer(B.instanceId, n2) ---->|---------------------------------------------->  |
  |<-- answer(sig_B over n2) ------|<----------------------------------------------|
  | [verify B's WebRTC answer challenge]                          |                  |
  |                                |                              |                  |
  | [pool ready: A(active,w=4), B(active,w=2)]                   |                  |
  | [requests already flowing to A; B now available too]          |                  |
```

### Single-Server (Default — No Latency Change)

```
Client                          MQTT Broker                    Server A
  |                                |                              |
  |-- offer(serverName, nonce=n1)->|------------------------------>|
  |-- discover(nonce=xyz-mqtt) --->|------------------------------>|
  |                                |                              |
  |<-- answer(sig_A over n1) -----|<------------------------------|
  |<-- announce(A, sig_A_mqtt) ---|<------------------------------|
  |                                |                              |
  | [data channel opens — done, identical to today]               |
  | [discover response noted but no additional connections made]  |
```

### Failover

```
Client                          Server A (active, w=4)         Server B (standby, w=0)
  |                                |                              |
  |== request #1 ================>|                              |
  |<= response #1 ================|                              |
  |                                |                              |
  |-- ping ---------------------->|                              |
  |<- pong -----------------------|                              |
  |-- ping --------------------------------------------------- >|
  |<- pong --------------------------------------------------- -|
  |                                |                              |
  |         [Server A tab closes]  |                              |
  |                                X                              |
  |                                                               |
  |-- ping -------> [no pong within 5s]                           |
  | [A → failed]                                                  |
  | [promote B: standby → active, weight = 4]                     |
  |                                                               |
  |== request #2 ================================================>|
  |<= response #2 =================================================|
  |                                                               |
  | [active workers (1) < rediscoveryThreshold?]                  |
  | [if yes: publish discover on MQTT to find new servers]        |
```

---

## Implementation Order

1. **Extend signaling types** — add `discover` kind, `workerInfo` fields to announce, ping/pong message types. All new fields optional.
2. **Server: respond to discover** — in `onMessage`, handle `kind: 'discover'` by signing the MQTT challenge and publishing an enriched announce.
3. **Server: accept targeted offers** — accept offers where `targetId` matches `serverInstanceId` in addition to `serverName`.
4. **Server: handle ping/pong** — respond to `platcss: 'ping'` on data channel.
5. **Client: connect-first discovery** — modify `createClientSideServerMQTTWebRTCPeerSession` to simultaneously publish discover + offer, collect announces in background.
6. **Client: multi-worker pool** — implement `ClientSideServerMultiWorkerPool` with state machine, routing strategies, health checks, and failover logic.
7. **Authority: multi-key support** — update `resolveAuthorityHost` to return arrays, update client-side verification to accept any key in the list.
8. **Server: drain support** — implement graceful drain message and handler.
9. **Transport plugin integration** — update `createClientSideServerMQTTWebRTCTransportPlugin` to use the multi-worker pool when `workerPool` options are provided.

---

## Security Considerations

| Threat | Mitigation |
|--------|-----------|
| MQTT challenge replay as WebRTC answer | `-mqtt` suffix in MQTT nonces; WebRTC answer nonces never contain `-mqtt`; signatures are bound to different `instanceId` vs `connectionId` |
| Rogue server claims high weight to attract traffic | Non-authority-verified servers default to equal weight (3); only authority-signed servers get their self-reported weights respected; client can override via `assignWeights` |
| Authority compromise → fake records for any server | Authorities are configured per-client; clients can pin specific authority keys; authority records include `issuedAt` for staleness checks |
| Denial of service via flooding fake announces | Client caps discovery candidates via `maxTotalConnections`; unverified candidates are ranked lowest |
| Stale server in pool (tab frozen, not closed) | Application-level ping/pong over data channel; `healthCheckTimeoutMs` triggers failure |
| MITM intercepts targeted MQTT messages | WebRTC DTLS provides end-to-end encryption; challenge nonce is bound to `connectionId`; signature proves server holds the private key |

---

## Appendix A: Optional Private Channel Challenge

If `requirePrivateChallenge: true` is set, an additional challenge-response happens over the data channel after it opens:

1. Client sends `{ platcss: 'private-challenge', challengeNonce: string }` (nonce MUST NOT contain `-mqtt`).
2. Server rejects if nonce contains `-mqtt`. Otherwise, signs `plat-css-identity-v1:{serverName}:{connectionId}:{challengeNonce}` and responds with `{ platcss: 'private-challenge-response', challengeSignature, identity, authorityRecord }`.
3. Client verifies signature, key match, and nonce format.

This adds defense-in-depth against an attacker who can selectively intercept and replace targeted MQTT messages while also performing a WebRTC DTLS downgrade. For most deployments, the WebRTC answer challenge is sufficient.
