# PLAT Authority — Full Technical Implementation Plan

This document describes the technical implementation plan for a new `plat/authority` subsystem in the PLAT repo.

It is based on the actual current PLAT TypeScript source layout and extension model:

- client-side CSS connections currently use `typescript/src/client-side-server/mqtt-webrtc.ts`
- CSS URL parsing is centralized in `typescript/src/client-side-server/signaling.ts`
- CSS client transport is provided by `typescript/src/client/css-transport-plugin.ts`
- browser/client-side servers are represented by `typescript/src/client-side-server/server.ts`
- Node PLAT servers are hosted by `typescript/src/server/server.ts`
- PLAT already supports extensible transport/runtime hooks through `typescript/src/server/protocol-plugin.ts`
- this plan intentionally ignores the existing `authority-server.ts` demo trust authority and treats it as unrelated to this new subsystem

This plan also incorporates the previously agreed product behavior:

- dual mode routing: `dmz/*` stays on MQTT
- non-`dmz/*` CSS names use the new authority control plane
- single request/response WebRTC handshake in v1
- Postgres persistent store, private to the docker-compose network
- Redis for rate limits, strikes, bans, suppressions, liveness, and other TTL-heavy state
- Cloudflare Tunnel for external ingress
- very low CPU and bandwidth per client/server pair
- minimal persistence and minimal background chatter

---

## 1. Goals

### Functional goals

1. Preserve existing DMZ MQTT signaling behavior unchanged.
2. Add a new authority signaling path for non-`dmz/*` names.
3. Keep the PLAT client call surface the same: callers still use `css://...` URLs.
4. Let authority-mode hosts register server names, receive connect requests, validate access, and return answers.
5. Support optional presence subscriptions for online/offline UX.

### Non-functional goals

1. Extremely low per-connection overhead.
2. Minimal persistent storage.
3. No TURN in v1.
4. No trickle ICE in v1.
5. Low CPU usage under both normal traffic and abuse.
6. Strict rejection of malformed traffic before expensive work.
7. Internal-only Postgres and Redis, reachable only on the compose network.
8. Cloudflare Tunnel as the only public ingress.

---

## 2. What exists already in the repo and how we will use it

### Existing code we will keep using

#### `typescript/src/client-side-server/signaling.ts`
This already parses CSS addresses and establishes the `css://` URL model. We should extend routing logic around this model, not replace it.

#### `typescript/src/client/css-transport-plugin.ts`
This is the existing client transport plugin for CSS endpoints. It already converts an `OpenAPIClient` request into a channel-based RPC exchange. We should keep this plugin as the CSS transport entry point and make its `connect()` callback select DMZ or authority mode.

#### `typescript/src/client-side-server/mqtt-webrtc.ts`
This is the current DMZ signaling implementation. It contains the current MQTT announce/discover/offer/answer/ICE path, trust checks, and WebRTC data-channel setup. We should leave DMZ behavior here intact and factor authority-mode connection logic into a separate connector rather than bloating this file further.

#### `typescript/src/client-side-server/server.ts`
This is the browser/client-side server runtime. It already knows how to handle JSON-RPC-style request messages over a generic channel. We should reuse this runtime exactly as the authority-mode host-side request handler behind a WebRTC data channel.

#### `typescript/src/server/server.ts`
This is the main Node `PLATServer`. It already provides:
- Express hosting
- controller registration
- middleware/hooks
- rate/token/cache support
- HTTP server creation
- protocol plugin attachment points

The authority service should use the existing `PLATServer` hosting model for its HTTP surface and share the same runtime conventions.

#### `typescript/src/server/protocol-plugin.ts`
This is important. It gives us a clean way to attach a new long-lived protocol surface to a `PLATServer`, including WebSocket attachment. We should use this pattern for the authority host WebSocket server instead of inventing a parallel bootstrap style.

### Existing code we will not reuse for this project

#### `typescript/src/server/authority-server.ts`
Per your instruction, this is ignored. It is a minimal trust authority for the DMZ network and is not the new control plane.

---

## 3. Top-level architecture

The new subsystem lives at repo root as:

```text
plat/
  authority/
```

That folder is the source of truth for this new service and its deployment.

### Internal implementation split

```text
plat/
  authority/
    README.md
    TECHNICAL_IMPLEMENTATION.md
    package.json
    tsconfig.json
    src/
      api/
      ws/
      services/
      store/
      models/
      validation/
      config/
      adapters/
      utils/
    migrations/
    docker/
    cloudflare/
```

### Relationship to existing TypeScript package

There are two possible ways to implement this cleanly:

#### Option A — standalone workspace package under `plat/authority` importing the published/local TypeScript package
This is the best boundary if you want the authority to be a real service and not just another folder inside `typescript/src/server`.

Pros:
- clear service boundary
- cleaner Docker build
- easier future extraction
- easier dependency isolation

Cons:
- some shared utilities may need explicit exports from the TypeScript package

#### Option B — source directly inside `typescript/src/server/...`
This would integrate more tightly with the current TS source tree, but it conflicts with your desired repo location and makes the authority look like a library feature instead of a service.

### Recommendation

Use **Option A**:
- implementation under `plat/authority`
- import/reuse PLAT runtime pieces from the TypeScript package
- only add exports to the TypeScript package where needed

---

## 4. Dual-mode routing model

This comes directly from the plan you uploaded: `dmz/*` stays on MQTT; everything else becomes authority mode. fileciteturn2file0L9-L26

### Rule

```ts
mode = serverName.startsWith("dmz/") ? "dmz" : "authority"
```

### Effect on CSS URLs

Existing `css://...` URLs continue to work.

Examples:

- `css://dmz/my-server` → existing MQTT path
- `css://photoshare` → authority mode
- `css://team/alice/notebook` → authority mode

### Where routing lives

#### Client-side call path
The routing decision should be applied in the CSS transport connect path, not scattered throughout business logic.

Best location:
- keep `typescript/src/client/css-transport-plugin.ts` as the entry point
- change its `connect()` integration so it delegates to either:
    - `DmzConnector`
    - `AuthorityConnector`

#### Host-side registration path
Host startup should also branch on server name:
- `dmz/*` names continue to use MQTT announces
- authority names register over authority WebSocket

---

## 5. Authority mode request lifecycle

This also follows the uploaded plan: a one-request authority handshake with HTTP client request, host-side answer over WebSocket, and a direct WebRTC data channel afterward. fileciteturn2file4L1-L38

### 5.1 Host boot

1. Host creates its `PLATClientSideServer` as today.
2. Host opens one persistent WebSocket connection to the authority service.
3. Host authenticates with Google-derived bearer token or session token.
4. Host registers one or more authority-mode server names.
5. Authority validates ownership and marks them online.

### 5.2 Client connect

1. Client resolves `css://...` address.
2. Routing decides `authority` mode.
3. Client creates `RTCPeerConnection` with STUN only.
4. Client creates offer.
5. Client waits for ICE gathering to finish.
6. Client sends `POST /connect` to authority with:
    - `server_name`
    - `offer`
    - auth payload if present
    - optional client metadata
7. Authority validates request and finds the live host session.
8. Authority forwards a compact connect message over the host WebSocket.
9. Host validates auth and admission rules.
10. Host creates answer.
11. Host waits for ICE gathering to finish.
12. Host sends answer back over WebSocket.
13. Authority returns the answer in the original HTTP response.
14. Client applies answer.
15. Data channel opens.
16. PLAT RPC request/response continues over the WebRTC channel using the existing channel + message handling model.

### Why this fits the repo

The existing CSS client transport already wants a channel object that can `send`, `subscribe`, and `close`. The authority connector should return the same kind of `ClientSideServerChannel` object that the DMZ path already returns, so higher-level request execution stays unchanged.

---

## 6. Why no trickle ICE in v1

This is the right tradeoff for your goals.

### Benefits

- fewer authority round trips
- simpler state machine
- much less WebSocket traffic
- much easier timeout handling
- lower CPU and code complexity

### Cost

- slower initial connect on some networks
- some NAT combinations will fail without TURN

### Acceptability

For v1, because the design goal is low-bandwidth direct peer connections and not universal reachability, this is acceptable.

---

## 7. Authority service API surface

### HTTP endpoints

#### `POST /connect`
Primary connect endpoint.

Request body:

```json
{
  "server_name": "team/alice/notebook",
  "offer": { "type": "offer", "sdp": "..." },
  "auth": { "mode": "public", "credentials": null },
  "client": {
    "ip_hint": "optional",
    "user_agent": "optional",
    "request_id": "optional"
  }
}
```

Response success:

```json
{
  "ok": true,
  "answer": { "type": "answer", "sdp": "..." }
}
```

Response failure:

```json
{
  "ok": false,
  "error": "server_offline | unauthorized | rejected | timed_out | rate_limited | malformed"
}
```

#### `GET /healthz`
Cheap liveness endpoint.

#### `GET /readyz`
Readiness endpoint checking:
- Node process healthy
- Redis reachable
- Postgres reachable
- authority WebSocket manager active

#### Optional: `GET /presence/:serverName`
Probably skip in v1 if presence is WebSocket-only.

### WebSocket endpoints

#### `/ws/host`
Persistent host connection.

Messages:
- `hello`
- `register_online`
- `register_offline`
- `connect_request`
- `connect_answer`
- `connect_reject`
- `suppress_client`
- `ping`
- `pong`

#### `/ws/presence`
Optional client-facing presence subscriptions.

Messages:
- `subscribe`
- `unsubscribe`
- `presence_snapshot`
- `presence_update`
- `ping`
- `pong`

---

## 8. Redis and Postgres responsibilities

This follows your minimal-persistence requirement from the uploaded plan. Persistent ownership records live in Postgres; short-lived and rate-limit state belongs in memory/Redis. fileciteturn2file0L37-L44

### 8.1 Postgres: persistent, minimal, internal-only

Postgres stores only data that matters across restarts.

#### Tables

##### `users`

```sql
users (
  google_sub text primary key,
  display_name text null,
  profile_image_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

##### `servers`

```sql
servers (
  server_name text primary key,
  owner_google_sub text not null references users(google_sub),
  auth_mode text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz null
)
```

##### Optional `server_aliases`
Only if you later want renames or alternate names.

### What is intentionally not persisted

- live host socket presence
- pending connection requests
- bans/strikes/suppressions
- presence subscriptions
- WebRTC state
- client metadata beyond request lifetime

### 8.2 Redis: volatile, TTL-heavy, CPU-cheap

Redis is used for:
- rate-limit buckets
- malformed-request strikes
- temporary bans
- host-specified suppressions
- host online presence mirror
- pending connection rendezvous
- short-lived metrics snapshots if useful

#### Redis key classes

```text
rl:connect:{ip_or_account}
strike:{ip_or_account}
ban:{ip_or_account}
suppress:{server_name}:{client_key}
presence:{server_name}
hostsock:{host_session_id}
pending:{connection_id}
subscribers:{server_name}
```

### Why Redis belongs here

It keeps high-churn state off Postgres, avoids constant disk writes, and gives TTL expiration for free.

---

## 9. Low-bandwidth and CPU-aware design constraints

This is central.

### Rules

1. One HTTP request + one host WS request + one WS response per successful connection.
2. No trickle ICE in v1.
3. No periodic per-client polling.
4. Presence WebSocket is optional and read-mostly.
5. Host heartbeat interval should be coarse, not chatty.
6. JSON message shapes should be small and fixed.
7. Avoid reserializing or storing large payloads unnecessarily.
8. Reject malformed traffic before DB access or offer forwarding.

### Specific tactics

#### Body limits
- `POST /connect` body cap: ~64 KB default, hard max 128 KB
- host WS frame cap: ~128 KB
- presence WS frame cap: small, ~8 KB

#### Keep messages tiny
Do not include:
- verbose debug strings
- large metadata blobs
- arbitrary extra JSON fields
- full host profile details on every response

#### Heartbeats
- host socket ping every 30–60 seconds
- consider app-level heartbeat only if underlying WS library needs it
- no client presence heartbeat unless subscribed

#### Redis over Postgres for hot path
The `/connect` hot path should ideally hit Postgres only when:
- validating ownership-related host registration
- not during ordinary connect requests

Normal connect flow should be:
- parse
- validate
- Redis checks
- in-memory host session lookup
- forward
- return

---

## 10. Security and trust model

The uploaded plan sets the distinction clearly: DMZ remains collision-prone and trust-light; authority mode becomes centrally enforced namespace ownership. fileciteturn2file4L70-L88

### DMZ mode
Unchanged:
- public namespace
- TOFU/challenge style trust
- MQTT based

### Authority mode
New guarantees:
- authority controls namespace ownership
- a server name belongs to exactly one owner account
- only a currently authenticated live host for that owner may register online
- host registration for `dmz/*` is rejected

### Host identity

Use Google auth at the authority boundary.

Recommended model:
1. Browser or app host signs into Google.
2. Host gets ID token or backend-issued session token.
3. Host uses that token to open `/ws/host`.
4. Authority verifies token and extracts `google_sub`.
5. Registration is permitted only for server names owned by that subject.

### Client identity

Client auth is separate from host identity.
The `POST /connect` request may include client auth material that the host needs to evaluate access.

Important: authority does **not** need to understand all app auth semantics. It only needs to pass through enough client auth context for the host to decide.

---

## 11. Admission model

### Three layers of admission

#### Layer 1 — authority admission
The authority checks:
- request is valid
- caller not globally banned
- rate limit not exceeded
- target host online
- host suppression not active

#### Layer 2 — namespace ownership
Authority checks:
- the current host session is allowed to represent this server name

#### Layer 3 — host admission
The host receives the connect request and decides:
- auth accepted
- room/server-specific policy accepted
- temporary suppression needed or not

The host can answer, reject, or suppress.

---

## 12. Authority internal components

### `src/api`

#### `connect-controller.ts`
Implements `POST /connect`.
Responsibilities:
- parse body
- enforce hard caps
- validate schema
- compute requester key
- consult block/rate-limit services
- resolve live host session
- create pending connection
- send connect request to host
- await answer or reject
- clean up pending state

#### `health-controller.ts`
Health and readiness.

### `src/ws`

#### `host-ws-server.ts`
Accepts host WebSocket connections.
Manages handshake and liveness.

#### `presence-ws-server.ts`
Optional client presence subscriptions.

#### `host-session.ts`
Represents one connected host session, including:
- `hostSessionId`
- `googleSub`
- socket
- registered server names
- last pong timestamp
- connection metadata

### `src/services`

#### `registration-service.ts`
- validates registration requests
- rejects `dmz/*`
- verifies ownership in Postgres
- updates in-memory and Redis presence state

#### `routing-service.ts`
Pure helper for `dmz` vs `authority` routing.

#### `signaling-service.ts`
- generates connection IDs
- forwards connect requests
- tracks pending answers
- resolves or times out waiting clients

#### `presence-service.ts`
- tracks online/offline state
- publishes updates to subscribers
- restores clean state after socket closes

#### `rate-limit-service.ts`
Redis-backed buckets for `/connect` and WS misuse.

#### `strike-service.ts`
Tracks malformed traffic violations.

#### `block-service.ts`
Manages bans and host suppressions.

#### `host-auth-service.ts`
Validates Google tokens and returns the normalized host identity.

#### `server-ownership-service.ts`
Small Postgres-backed service for mapping `server_name -> owner_google_sub`.

### `src/store`

#### `postgres/`
- pool setup
- migrations
- repos for `users` and `servers`

#### `redis/`
- client bootstrap
- key helpers
- TTL helpers

### `src/validation`

Schema validation using Zod or similar.

Schemas:
- `ConnectRequestSchema`
- `HostHelloSchema`
- `RegisterOnlineSchema`
- `ConnectAnswerSchema`
- `ConnectRejectSchema`
- `SuppressClientSchema`
- `PresenceSubscribeSchema`

---

## 13. Concrete repo file tree

```text
plat/
  authority/
    README.md
    TECHNICAL_IMPLEMENTATION.md
    package.json
    tsconfig.json
    src/
      index.ts
      config/
        env.ts
        constants.ts
      api/
        connect-controller.ts
        health-controller.ts
      ws/
        host-ws-server.ts
        presence-ws-server.ts
        host-session.ts
        ws-message-types.ts
      services/
        routing-service.ts
        registration-service.ts
        signaling-service.ts
        presence-service.ts
        rate-limit-service.ts
        strike-service.ts
        block-service.ts
        host-auth-service.ts
        server-ownership-service.ts
      store/
        postgres/
          pool.ts
          users-repo.ts
          servers-repo.ts
        redis/
          client.ts
          keys.ts
      validation/
        schemas.ts
        limits.ts
      models/
        authority-types.ts
      adapters/
        plat-server.ts
      utils/
        logger.ts
        time.ts
        ids.ts
    migrations/
      001_init.sql
    docker/
      Dockerfile
      docker-compose.yml
      docker-compose.dev.yml
    cloudflare/
      config.yml
```

---

## 14. Existing repo locations that must change

### 14.1 `typescript/src/client/css-transport-plugin.ts`

#### Why
This is the current CSS transport entry point.

#### Change
Keep the file, but change the injected `connect()` implementation to route by server name.

#### Result
The upper `OpenAPIClient` layer stays unchanged.

### 14.2 `typescript/src/client-side-server/signaling.ts`

#### Why
This file owns CSS URL parsing.

#### Change
Likely minimal.
Possibly add helper(s) such as:
- `getClientSideServerMode(address)`
- authority endpoint derivation rules if you want them centralized

### 14.3 `typescript/src/client-side-server/mqtt-webrtc.ts`

#### Why
This is the current DMZ path and probably also where the existing CSS connection helper lives.

#### Change
Do not rewrite this file into a giant dual-mode file.
Keep DMZ logic here, but extract or wrap the public connection entry point so authority-mode callers use a separate connector.

### 14.4 `typescript/src/client-side-server/runtime.ts`

#### Why
This is the current client-side server boot path.

#### Change
Add host-side authority registration support for non-`dmz/*` names.

Options:
- preserve current API and add optional `authority` config
- or add a new helper for authority-hosted runtime startup

### 14.5 `typescript/src/client-side-server/server.ts`

#### Why
This file is the actual request/response handler for CSS server traffic.

#### Change
Likely none to core dispatch.
Possibly add small hooks or metadata methods for authority registration if useful.

### 14.6 `typescript/src/server/server.ts`

#### Why
Authority service will likely want to use `PLATServer` runtime patterns.

#### Change
Probably none to core behavior.
If needed, export or expose a small helper to attach an external WebSocket server cleanly.

### 14.7 `typescript/src/server/protocol-plugin.ts`

#### Why
This is the existing server extension seam.

#### Change
Possibly none.
Use it as the model for attaching authority host WebSockets.
If necessary, add tiny missing extension points rather than bypassing the plugin model entirely.

### 14.8 `typescript/src/index.ts` and package exports

#### Why
The authority package will likely need stable imports from the TypeScript library.

#### Change
Add exports for any currently internal utilities you want to reuse:
- CSS transport helpers
- channel types
- `PLATServer`
- maybe selected validation or protocol helpers

---

## 15. Host runtime changes

The uploaded plan expects authority-mode hosts to authenticate, open a WebSocket, register names, and answer connect requests. fileciteturn2file4L49-L69

### New host-side component

Add a host client library under the TypeScript package or under `plat/authority-client/`.

Recommended placement if kept in TS package:

```text
typescript/src/client-side-server/authority/
  authority-host-client.ts
  authority-host-registration.ts
  authority-host-signaling.ts
```

### Responsibilities

1. Open `/ws/host`.
2. Authenticate host.
3. Register one or more authority server names.
4. Listen for `connect_request` messages.
5. For each request:
    - create `RTCPeerConnection`
    - apply remote offer
    - validate client auth/admission
    - create answer
    - wait for ICE complete
    - return `connect_answer`
6. If rejected, send `connect_reject`.
7. If abusive, optionally send `suppress_client`.

### Important boundary

The authority service should never execute the app request itself.
It only brokers signaling.
Actual application request handling still happens in the host’s `PLATClientSideServer` once the peer channel is established.

---

## 16. Client runtime changes

### New client-side connector

Add an authority connector that returns a `ClientSideServerChannel`.

Suggested placement:

```text
typescript/src/client-side-server/authority/
  authority-connector.ts
  authority-presence-client.ts
  authority-types.ts
```

### Connector behavior

1. Accept parsed CSS address.
2. Create `RTCPeerConnection` with STUN servers.
3. Create data channel.
4. Create offer.
5. Wait for ICE gather completion.
6. `POST /connect` to authority.
7. Apply answer.
8. Return RTC data-channel adapter using the same channel interface already used elsewhere.

### Result

`OpenAPIClient` stays transport-agnostic.
Only the CSS transport plugin’s connect path changes.

---

## 17. Presence design

The uploaded plan calls presence optional and lightweight; that matches the low-bandwidth goal. fileciteturn2file4L39-L48

### v1 recommendation

Presence is optional and separate from connect flow.

### Presence flow

1. Client opens `/ws/presence` only if needed.
2. Client subscribes to server names.
3. Authority sends:
    - initial snapshot
    - online/offline updates only when state changes

### Storage

- source of truth: in-memory host sessions
- mirrored into Redis for simple multi-process future compatibility

### CPU/bandwidth rules

- no periodic snapshots
- no polling
- only edge-triggered updates
- one small JSON update per change

---

## 18. Rate limiting and abuse controls

These should match the philosophy in your uploaded plan: be lenient to normal users, harsh on malformed traffic, and escalate only when needed. fileciteturn2file2L15-L74

### 18.1 Request handling order

Exactly this order:
1. check global ban
2. enforce hard size caps
3. parse JSON
4. validate schema
5. apply strike logic if malformed
6. check rate limits
7. check host suppression
8. resolve live host
9. forward to host

This ordering minimizes expensive work on junk traffic.

### 18.2 Rate limit dimensions

#### `/connect`
Key by:
- authenticated user + IP when available
- otherwise IP

#### `/ws/host`
Key by:
- host account
- plus IP

#### `/ws/presence`
Key by:
- IP or account

### 18.3 Strike system

Malformed traffic increments a strike counter in Redis.
Thresholds:
- 3 malformed → 5 min ban
- repeated → 30 min ban
- severe oversize/flood → 1h–24h

### 18.4 Host suppressions

The host can temporarily suppress a client for a server name.
Redis key:
`suppr:{server_name}:{client_key}` with TTL.

### 18.5 Dynamic load shedding

You wanted adaptive throttling. Keep it simple.

Implement a global load state with levels `L0` to `L4` and consult it inside `/connect` admission. The thresholds from the uploaded plan are reasonable as initial defaults. fileciteturn2file2L20-L31

---

## 19. Multi-process and horizontal scaling

### v1 target

Run a single authority process behind Cloudflare Tunnel.
That is enough initially and is simplest.

### Why single instance is good first

- less coordination
- simpler pending-connection rendezvous
- lower CPU
- simpler debugging

### What to do so scale-out is possible later

Use Redis for:
- pending connection lookup
- presence mirror
- rate-limit state
- suppressions/bans

Then if you later run multiple authority instances, you only need sticky handling or a pub/sub bridge for pending connection answers.

### Recommendation

Do **not** build distributed pending-answer fanout in v1.
Keep one process.

---

## 20. Docker and deployment plan

### Compose services

```yaml
services:
  authority:
    build: ./plat/authority/docker
    depends_on:
      - postgres
      - redis
    networks:
      - authority_internal
    volumes:
      - ./plat/authority:/app/plat/authority:ro

  postgres:
    image: postgres:16-alpine
    networks:
      - authority_internal
    volumes:
      - ./data/postgres:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    networks:
      - authority_internal

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    depends_on:
      - authority
    networks:
      - authority_internal
```

### Network policy

- `postgres` and `redis` expose no public ports
- only `authority` is reachable inside compose
- only `cloudflared` has external egress to Cloudflare
- clients on the internet hit the tunnel hostname, not the container directly

### Persistence

- Postgres volume mounted to host and persisted
- Redis intentionally ephemeral

### Why Redis should be non-persistent

Because its data is cheap to lose and this avoids write amplification and wasted IO.

---

## 21. Cloudflare Tunnel plan

### Public routes

Expose only:
- `https://authority.example.com/connect`
- `https://authority.example.com/healthz`
- `wss://authority.example.com/ws/host`
- `wss://authority.example.com/ws/presence`

### Why Tunnel is a good fit

- no public inbound ports on home/edge host
- simple TLS termination
- easy DNS + origin hiding
- good enough for small JSON and WebSocket traffic

### Caveats

- watch WebSocket idle timeout behavior
- keep heartbeat interval compatible with Cloudflare
- ensure body size settings exceed your SDP max but remain tight

---

## 22. Schema and protocol details

### Host WebSocket messages

#### Host hello

```json
{
  "type": "hello",
  "token": "..."
}
```

#### Register online

```json
{
  "type": "register_online",
  "servers": [
    { "server_name": "team/alice/notebook", "auth_mode": "public" }
  ]
}
```

#### Connect request from authority to host

```json
{
  "type": "connect_request",
  "connection_id": "c_123",
  "server_name": "team/alice/notebook",
  "offer": { "type": "offer", "sdp": "..." },
  "auth": { "mode": "public", "credentials": null },
  "client": { "ip": "...", "request_id": "..." }
}
```

#### Connect answer from host

```json
{
  "type": "connect_answer",
  "connection_id": "c_123",
  "answer": { "type": "answer", "sdp": "..." }
}
```

#### Connect reject from host

```json
{
  "type": "connect_reject",
  "connection_id": "c_123",
  "reason": "unauthorized"
}
```

#### Suppress client

```json
{
  "type": "suppress_client",
  "server_name": "team/alice/notebook",
  "client_key": "acct:123 or ip:1.2.3.4",
  "ttl_seconds": 3600,
  "reason": "abuse"
}
```

### Presence messages

#### Subscribe

```json
{ "type": "subscribe", "server_names": ["team/alice/notebook"] }
```

#### Presence update

```json
{
  "type": "presence_update",
  "server_name": "team/alice/notebook",
  "online": true
}
```

---

## 23. Timeouts

### `/connect`
- total request timeout: 12–15 seconds
- host response budget: 8–10 seconds

### host WS heartbeat
- ping interval: 30 seconds
- dead after: 90 seconds without pong

### pending connection TTL in Redis
- 20 seconds max

### why
These values are long enough for STUN gather and answer creation but short enough to avoid resource pileup.

---

## 24. Observability

### Logs

Log structured events for:
- host connected/disconnected
- server registered/unregistered
- connect request accepted/rejected/timed out
- rate-limit triggered
- malformed request strike applied
- suppression created

### Metrics

Keep metrics lightweight:
- current live hosts
- current live server names
- connects/sec
- connect success rate
- connect timeout rate
- reject rate
- malformed rate
- Redis latency
- Postgres latency

### Important logging rule

Do not log SDP blobs in production.
They are large and noisy.
At most log length and connection ID.

---

## 25. Migration plan

This aligns with the uploaded migration steps. fileciteturn2file2L75-L89

### Phase 1
- implement `plat/authority`
- add authority connector on client side
- add authority host registration on host side
- keep DMZ untouched
- default new experiments manually to authority mode

### Phase 2
- make non-`dmz/*` the default recommended path
- improve docs and examples
- add presence subscriptions if desired

### Phase 3
Optional:
- trickle ICE
- TURN
- stronger identity federation
- multi-instance authority
- better observability dashboards

---

## 26. Implementation order

### Step 1
Create `plat/authority` package and Docker compose stack.

### Step 2
Implement Postgres + Redis bootstrap and migrations.

### Step 3
Implement `/ws/host` with auth, registration, liveness, and disconnect cleanup.

### Step 4
Implement `/connect` with pending connection tracking and answer wait.

### Step 5
Implement host-side authority runtime client.

### Step 6
Implement client-side authority connector returning a `ClientSideServerChannel`.

### Step 7
Integrate CSS routing split in the existing CSS transport plugin.

### Step 8
Add strict validation, body caps, strikes, bans, and suppressions.

### Step 9
Add optional presence WebSocket.

### Step 10
Write docs and migration examples.

---

## 27. Final architectural summary

The right implementation is:

- keep existing DMZ signaling in `mqtt-webrtc.ts`
- add a brand new authority service under `plat/authority`
- reuse PLAT’s runtime concepts and exports where helpful, especially:
    - `PLATServer`
    - transport/channel model
    - CSS transport entry point
    - existing request dispatch machinery
- keep host application execution where it already belongs: inside `PLATClientSideServer`
- make the authority service a thin, efficient control plane for namespace ownership, host registration, signaling relay, and abuse control

That gives you:
- backward compatibility
- a much simpler trust model for non-DMZ names
- low bandwidth per client/server pair
- low persistence overhead
- clear deployment boundaries
- room to scale later without overbuilding now