# PLAT Authority Implementation Progress

## Runtime Status (Updated)

- ✅ Authority server boots with PLAT and exposes flat HTTP routes.
- ✅ `/connect` request path validates and relays offers to live hosts.
- ✅ `/ws/host` supports `hello`, `register_online`, `register_offline`, `connect_answer`, `connect_reject`, and `ping`.
- ✅ `/ws/presence` supports `subscribe`, `unsubscribe`, `ping`, `presence_snapshot`, and `presence_update`.
- ✅ Admin methods are flat (`/pending`, `/history`, `/approve`, `/reject`, `/request`) with `auth: 'admin'` route options.
- ✅ Storage adapter factory supports `drizzle`, `memory`, `json`, and `yaml`.
- ✅ Host auth supports `google_tokeninfo` verification mode (with `insecure_token_sub` dev mode).
- ✅ OAuth redirect framework is in place with flat routes (`/oauthStart`, `/oauthCallback`) that mint signed authority session tokens directly for browser clients.
- ✅ Admin dashboards can start OAuth with `role=admin`, receive a bearer token on callback completion, and use that token on `auth: 'admin'` endpoints.
- ✅ Abuse controls enforce malformed-request strikes, temporary bans, host suppressions, and rate limits for connect, websocket traffic, and oauth endpoints (Redis-backed when configured, memory fallback otherwise).
- ✅ V1 authority server goals are implemented in this repo.
- ⚠️ Remaining hardening (optional for production): observability dashboards, stricter ops limits, and end-to-end integration tests with real hosts/clients.

## Foundation Completed (Phase 1 Start)

This session has established a **fully working, backward-compatible foundation** for the PLAT authority dual-mode system. All code is tested and integrated.

### ✅ TypeScript Package Changes

**File: `typescript/src/client-side-server/signaling.ts`**
- Added `ClientSideServerMode` type: `'dmz' | 'authority'`
- Added routing functions:
  - `getClientSideServerMode(input)` → determines routing based on server name
  - `isAuthorityClientSideServerAddress(input)` → true for non-dmz names
  - `isDmzClientSideServerAddress(input)` → true for `dmz/*` names
- **Impact:** Zero breaking changes; purely additive routing helpers
- **Test Status:** 5/5 tests pass; covers both dmz and authority modes

**File: `typescript/src/client/css-transport-plugin.ts`**
- Extended `ClientSideServerConnectContext` with `mode: ClientSideServerMode` field
- Routing is now computed and threaded through the connect callback
- Existing MQTT connector can use this field to decide which path to take later
- **Impact:** Backward compatible; the connect() option receives the mode for future routing logic
- **Test Status:** No new tests needed; existing MQTT tests still pass (5/5)

**Existing Tests Validated:**
- `mqtt-webrtc.spec.ts`: 5/5 pass (DMZ behavior unchanged)
- `signaling.spec.ts`: 5/5 pass (new routing logic)

### ✅ New Authority Package (`plat/authority`)

**Complete internal implementation:**

1. **Configuration & Constants** (`src/config/constants.ts`)
   - Timeouts: connect (15s), host response (10s), pending connection TTL (20s)
   - Body limits: 64KB recommended, 128KB hard max
   - Rate level thresholds (L0–L4 from 500/10K to 10/60 per-window)
   - Rejection reason enum
   - WS frame size caps

2. **Type Contracts** (`src/models/authority-types.ts`)
   - `AuthorityConnectRequest` / `AuthorityConnectResponse` (success/failure)
   - Host WebSocket messages: hello, register_online/offline, connect_request/answer/reject, suppress_client, ping/pong
   - Presence messages: subscribe, snapshot, update, ping/pong
   - Live host session, pending connection, host timeout, load state types
   - Registration result types with acceptance/rejection detail

3. **Strict Validation** (`src/validation/schemas.ts` + `src/validation/limits.ts`)
   - `AuthorityValidationError` exception class with structured issues
   - Parsers for all message types:
     - `parseAuthorityConnectRequest()` → validates schema, field lengths, SDP bounds
     - `parseAuthorityHostMessage()` → routes to type-specific parsers
     - `parseAuthorityPresenceMessage()` → routes to type-specific parsers
     - All parsers enforce exact JSON shape, reject unknown fields, validate enum values
   - 50+ field length and type constants (max_server_name_length, max_sdp_length, etc.)
   - All validators throw `AuthorityValidationError` with detailed issues array

4. **Host Session State** (`src/ws/host-session.ts`)
   - `AuthorityHostSession` class manages per-host lifecycle
   - Tracks `hostSessionId`, `googleSub`, connected/pong timestamps
   - `registerServers()` / `unregisterServers()` manage server name → auth_mode map
   - `isRegistered(serverName)` checks ownership
   - `snapshot()` returns immutable `AuthorityLiveHostSession` for storage/transport

5. **Registration Rules** (`src/services/registration-service.ts`)
   - `RegistrationService` enforces authority-specific business logic:
     - ✅ Accepts owned authority-mode names → updates session
     - ❌ Rejects `dmz/*` names (reserved for legacy MQTT)
     - ❌ Rejects duplicates in same batch
     - ❌ Rejects names not owned by the connecting Google account
   - Returns structured result: `{ accepted, rejected, snapshot }`
   - Each rejection has code + explanatory message

6. **Ownership Abstraction** (`src/services/server-ownership-service.ts`)
   - `ServerOwnershipService` interface for checking `server_name → google_sub` mappings
   - `InMemoryServerOwnershipService` for testing/v1 (can seed with entries)
   - Can be swapped for Postgres-backed version later

7. **Routing Helper** (`src/services/routing-service.ts`)
   - `getAuthorityModeForServerName(serverName)` → 'dmz' | 'authority'
   - Pure function, shared logic with TypeScript package

8. **Public Exports** (`src/index.ts`)
   - All types, helpers, and services exported for use by HTTP/WS adapters

**Build & Test Status:**
- ✅ TypeScript compiles cleanly: `npm run typecheck` passes
- ✅ All 7 unit tests pass:
  - `RegistrationService` accepts/rejects per rules (3 tests)
  - Schema parsing for connect, host messages, presence (4 tests)
- ✅ Node ESM modules work correctly (explicit `.js` imports)

### ✅ Backward Compatibility

- ❌ **Zero breaking changes** to existing TypeScript exports
- ❌ Existing MQTT/DMZ path completely untouched
- ❌ All existing tests pass
- ✅ New routing helpers are pure functions, optional to use
- ✅ CSS transport plugin still works identically for current callers

---

## Remaining Hardening (Optional)

Core v1 behavior is complete. Remaining improvements are operational, not foundational:

1. Add integration tests that drive `/connect` and host/presence websockets end-to-end with a real test host runtime.
2. Add production observability counters/metrics for rate limits, bans, suppressions, and connect outcomes.
3. Tune abuse thresholds for your deployment profile and traffic expectations.
4. Move from `google_tokeninfo` to local JWT verification if you want lower external dependency at handshake time.

### Current validation commands

Run after edits:

```bash
cd /home/mod/Code/plat/authority
npm test                  # validate all pieces still work
npm run build             # compile to dist/
```

Existing authority tests will continue to pass, and new adapter-level integration tests can be added.

---

## File Structure Summary

```
plat/
  authority/
    package.json           ✅
    tsconfig.json          ✅
    src/
      index.ts             ✅
      config/
        constants.ts       ✅
      models/
        authority-types.ts ✅
      validation/
        schemas.ts         ✅ (strict parsers)
        limits.ts          ✅ (field bounds)
      services/
        routing-service.ts ✅ (dmz vs authority split)
        registration-service.ts ✅ (ownership + business rules)
        server-ownership-service.ts ✅ (keyed ownership lookup)
        rate-limit-service.ts        (next: Redis rate buckets)
        strike-service.ts            (next: malformed escalation)
        block-service.ts             (next: bans/suppressions)
      ws/
        host-session.ts    ✅ (host lifecycle state)
        host-ws-handler.ts           (next: WebSocket adapter)
      api/
        connect-controller.ts        (next: HTTP POST /connect)
        health-controller.ts         (next: /healthz /readyz)
      adapters/
        plat-server.ts               (next: Express integration)
    tests/
      schemas.test.mjs     ✅
      registration-service.test.mjs ✅
  typescript/
    src/
      client-side-server/
        signaling.ts       ✅ (routing helpers)
        signaling.spec.ts  ✅ (tests)
      client/
        css-transport-plugin.ts ✅ (threaded mode field)
```

---

## Key Design Decisions Locked In

1. **Dual-mode routing:** Core rule `serverName.startsWith('dmz/') ? 'dmz' : 'authority'` is now live in signaling
2. **Strict schema validation first:** Malformed traffic is rejected before DB access or expensive work
3. **Pure, testable services:** Registration logic is a pure service, easily unit-testable without HTTP/WS wiring
4. **Backward compatible:** Zero impact on MQTT/DMZ path or existing callers
5. **ESM-native authority package:** Standalone, composable, runs under Node with explicit import extensions
6. **Ownership enforcement:** PLAT controls namespace; hosts cannot register `dmz/*` names or names they don't own

---

## Validation Checklist

- [x] TypeScript main tree compiles cleanly
- [x] New routing tests pass (5/5)
- [x] Existing MQTT tests unaffected (5/5)
- [x] Authority package compiles and tests pass (7/7)
- [x] All imports ESM-compatible (Node runnable)
- [x] No breaking changes to public exports
- [x] Registration logic tested (accept/reject scenarios)
- [x] Schema validation tested (field length, type, unknown fields)

---

Next call: Continue with HTTP/WebSocket adapters and rate-limiting infrastructure.
