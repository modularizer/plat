Here’s a **concise, complete plan** incorporating everything: dual modes, control plane, handshake, client/server changes, presence sockets, and rate limiting philosophy.

---

# PLAT Plan of Action (DMZ + Authority)

## Goal

Evolve PLAT into a **dual-mode system**:

* Preserve existing **public MQTT (DMZ)** behavior
* Add a new **PLAT authority/control-plane** path
* Keep **100% backward compatibility**
* Default new usage to the simpler, more reliable authority mode

---

# 1. Routing Model (Core Rule)

```ts
mode = serverName.startsWith("dmz/") ? "dmz" : "authority"
```

## DMZ mode (`css://dmz/...`)

* Uses existing **public MQTT signaling**
* No namespace ownership guarantees
* Collisions allowed
* Existing trust model (TOFU / challenge)
* **No changes required**

## Authority mode (`css://...`)

* Uses **PLAT control plane**
* PLAT enforces ownership + routing
* No MQTT
* Simpler, centralized trust model

---

# 2. PLAT Control Plane (New Server)

## Responsibilities

1. **Trust authority**

    * Google auth for hosts
    * ownership of `server_name`

2. **Connection broker**

    * receives client connect requests
    * forwards to correct host

3. **Signaling relay**

    * forwards SDP offer
    * returns SDP answer

4. **Presence/events**

    * notifies clients when servers come online

---

## Storage

### Persistent (minimal)

```ts
users { google_sub, name, profile_image }
servers { server_name, owner_google_sub }
```

### In-memory

```ts
LiveHostSession { websocket, server_names, auth_modes }
PendingConnection { connection_id, server_name, status }
HostTimeout { server_name, client_key, expires_at }
```

---

# 3. Authority Mode Handshake (v1)

## Constraints

* STUN only
* no TURN
* no trickle ICE
* single request/response

## Flow

1. Client:

    * create offer
    * wait for ICE gathering complete

2. Client → PLAT:

```json
POST /connect
{
  "server_name": "...",
  "auth": {...},
  "offer": {...}
}
```

3. PLAT → Host (WebSocket)

4. Host:

    * validate auth
    * create answer
    * gather ICE

5. Host → PLAT:

```json
{ "type": "answer", "answer": {...} }
```

6. PLAT → Client (same HTTP response)

## Result

* Direct WebRTC connection
* No further signaling

---

# 4. Client Presence WebSocket

Clients may optionally open a persistent WebSocket to PLAT.

## Purpose

* subscribe to server names
* receive “server online/offline” events

## Behavior

* lightweight, read-mostly
* separate from connect flow
* used for UX, not required for connection

---

# 5. Client Changes

## Add routing layer

* choose DMZ vs authority per server name

## Authority mode behavior

* create offer
* wait for ICE complete
* send `POST /connect`
* apply answer
* connect

## Keep DMZ behavior unchanged

## New abstraction

* `DmzConnector`
* `AuthorityConnector`

---

# 6. Client-Side Server (Host) Changes

## Dual-mode hosting

### `dmz/*`

* existing MQTT path

### authority names

* authenticate with PLAT
* open WebSocket
* register servers

```json
{
  "type": "register_online",
  "servers": [{ "server_name": "...", "auth_mode": "..." }]
}
```

## On connection request

* receive offer
* validate
* create answer
* return answer

## Rule

* PLAT must **reject `dmz/*` registrations**

---

# 7. Trust Model

## DMZ

* no guarantees
* collisions expected

## Authority

* PLAT is source of truth
* host identity = Google account
* namespace enforced

---

# 8. Rate Limiting & Abuse Protection

## Philosophy

* **Do NOT punish normal users**
* Use **very lenient rate limits** under normal conditions
* Be **strict on malformed / off-protocol traffic**
* Use **adaptive throttling only under system pressure**

---

## Adaptive Rate Levels (connect requests)

| Level          | Burst (30s) | Sustained (10m) |
| -------------- | ----------- | --------------- |
| L0 (normal)    | 500         | 10,000          |
| L1             | 250         | 5,000           |
| L2             | 100         | 1,500           |
| L3             | 40          | 400             |
| L4 (emergency) | 10          | 60              |

* PLAT dynamically adjusts level based on load

---

## Always-on protections (strict)

### Hard limits

* request body size cap
* WebSocket frame size cap
* max field lengths
* max SDP size

### Schema enforcement

* exact JSON shape
* required fields only
* reject unknown / malformed requests

---

## Strike-based temporary bans

Keyed by:

* anonymous: IP
* authenticated: account + IP

### Escalation

* 3 malformed requests → 5 min ban
* repeated violations → 30 min ban
* severe abuse (oversized / flood) → 1h–24h ban

No permanent bans in v1.

---

## Host-determined timeouts

Hosts can suppress clients.

### Behavior

* host marks client as timed out for a server
* PLAT stores timeout
* future requests:

    * rejected immediately
    * NOT forwarded to host

### Key

* authenticated: `google_sub`
* anonymous: IP

### Durations

* 5 minutes
* 1 hour
* 24 hours

---

## Request handling order

1. check global ban
2. enforce size caps
3. parse + validate schema
4. apply strike logic if invalid
5. check rate limits
6. check host timeout
7. forward to host

---

# 9. Migration Plan

## Phase 1

* add routing split
* keep DMZ unchanged
* add control plane

## Phase 2

* default new users to authority mode

## Phase 3

* optional:

    * SSE
    * trickle ICE
    * TURN
    * stronger identity

---

# Final Summary

PLAT becomes:

* **DMZ mode (`dmz/*`)** → legacy, decentralized, MQTT-based
* **Authority mode (everything else)** → simple, centralized, HTTP + WebSocket

Key properties:

* one-request WebRTC handshake
* minimal infrastructure
* strong backward compatibility
* strict abuse filtering via protocol correctness
* adaptive throttling only when needed
* host-level suppression for nuisance clients

---

If you want next step, I can turn this into a **file-by-file implementation checklist** for your repo.
