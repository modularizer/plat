# PLAT Authority Mode — Getting Started

This README covers **authority mode**, the new centralized signaling path for PLAT. It complements the existing DMZ/MQTT path and enforces namespace ownership.

## Current Status

**Foundation (✅ Complete):** Type contracts, validation, registration rules, and routing logic are implemented and tested.

**Server (✅ Complete):** HTTP `/connect`, host WebSocket `/ws/host`, and presence WebSocket `/ws/presence` are implemented.

**Storage adapters (✅ Available):** `drizzle`, `memory`, `json`, and `yaml` can be selected with `STORAGE_TYPE`.

**Status:** Runnable now via Docker Compose or local Node.

---

## Quick Concept

### Origin-Scoped Ownership

Authority treats namespace ownership as `(origin, namespace)`.

- Owning `donkey` on `apple.pear.com` means owning both `apple.pear.com/donkey` and `donkey.apple.pear.com`
- Subdomain and path forms are just routing views of the same ownership record
- `AUTHORITY_ALLOWED_ORIGINS` defines which marketplace origins participate in this model
- `api` is always reserved, and `AUTHORITY_DISALLOWED_NAMESPACE_GLOBS` can reserve additional namespace patterns

### Dual Routing

```typescript
if (serverName.startsWith('dmz/')) {
  // Legacy MQTT path — no changes, works as before
  // Example: css://dmz/my-room
} else {
  // New authority path — centralized, ownership-enforced
  // Example: css://team/alice/notebook
}
```

### Authority Mode vs DMZ

| Aspect | DMZ (`dmz/*`) | Authority (everything else) |
|--------|---------------|-----|
| Signaling | Public MQTT broker | Private control plane |
| Namespace | First-come, no ownership | PLAT enforces ownership |
| Registration | Implicit (announce) | Explicit with token |
| Auth Model | TOFU / challenge | Google + app-specific |
| Reliability | Best-effort | Guaranteed routing |

---

## How to Use Authority Mode

### For Clients

**1. Use authority-mode server names**

```typescript
// ❌ DMZ (legacy)
const dmzClient = await plat.createClient('css://dmz/my-room')

// ✅ Authority (recommended)
const authClient = await plat.createClient('css://team/alice/notebook')
// or any non-dmz/* name
```

**2. That's it!** The CSS transport plugin will automatically:
- Detect the server name is in authority mode
- Create a WebRTC offer
- Wait for ICE gathering
- Send `POST /connect` to the authority server
- Apply the answer
- Connect over the WebRTC data channel

No code changes needed. The routing is transparent.

### For Hosts (Client-Side Servers)

**1. Register with the authority on startup**

```typescript
import { PLATClientSideServer } from 'plat'

const server = new PLATClientSideServer({ /* your config */ })

// For authority-mode names, authenticate and register
const hostToken = await getGoogleAuthToken() // Your auth flow

await server.registerWithAuthority({
  url: 'wss://authority.example.com/ws/host',
  token: hostToken,
  serverNames: [
    { server_name: 'team/alice/notebook', auth_mode: 'public' },
    { server_name: 'team/alice/whiteboard', auth_mode: 'private' },
  ],
})

// DMZ names continue to work as before (MQTT announce)
await server.announceOnMQTT({
  serverName: 'dmz/legacy-room',
  // ...
})
```

**2. Handle incoming connect requests**

Authority will forward WebRTC offers from clients. Your server automatically handles them using the existing request/response machinery — no changes needed there either.

**3. Optional: Suppress abusive clients**

```typescript
// If a client is misbehaving, tell authority to block them temporarily
await server.suppressClient({
  serverName: 'team/alice/notebook',
  clientKey: 'ip:192.0.2.1', // or 'google-sub:...' if authenticated
  ttlSeconds: 3600, // 1 hour
  reason: 'spam',
})
```

---

## Server Configuration

Run with Docker Compose:

```bash
cd /home/mod/Code/plat/authority
docker-compose up
```

Or standalone:

```bash
cd plat/authority
npm ci
npm run dev
```

### Quick Start (No Docker)

```bash
cd /home/mod/Code/plat/authority
npm ci
npm run build
npm start
```

Environment variables:

```bash
# Google client ID — used to verify Google-issued ID tokens (host auth + /authSession)
GOOGLE_CLIENT_ID=...

# Optional extra audiences (comma-separated). Useful when CLI / service-account
# flows mint ID tokens with a different `aud` than the browser client ID.
# GOOGLE_ID_TOKEN_AUDIENCES=cli-client-id,service-account-audience

# Optional Workspace hosted-domain allowlist. If set, ID tokens without a
# matching `hd` claim are rejected.
# GOOGLE_ALLOWED_HOSTED_DOMAINS=example.com

# Database (Postgres for ownership, Redis for rate limits)
DATABASE_URL=postgresql://user:pass@postgres:5432/plat_authority
REDIS_URL=redis://redis:6379

# Server
PORT=3000
AUTHORITY_URL=wss://authority.example.com
ADMIN_TOKEN=replace-me
AUTHORITY_ALLOWED_ORIGINS=apple.pear.com,broswerver.com,browservable.com,coolsite.ai
AUTHORITY_DISALLOWED_NAMESPACE_GLOBS=admin-*,*-internal,staging

# Host auth
# insecure_token_sub (dev) | google_tokeninfo (recommended)
HOST_AUTH_MODE=google_tokeninfo

# Abuse controls
CONNECT_RATE_LIMIT_PER_30S=500
WS_HOST_MSG_RATE_LIMIT_PER_30S=300
WS_PRESENCE_MSG_RATE_LIMIT_PER_30S=300
OAUTH_RATE_LIMIT_PER_30S=30

# Admin session config
# ADMIN_GOOGLE_SUBS=google-sub-1,google-sub-2
# ADMIN_SESSION_TTL_SECONDS=43200
ADMIN_SESSION_SECRET=replace-me-with-a-long-random-secret

# Cloudflare Tunnel (external ingress)
CLOUDFLARE_TUNNEL_ID=...
CLOUDFLARE_TUNNEL_TOKEN=...

# Storage adapter selection
# STORAGE_TYPE=drizzle|memory|json|yaml
# STORAGE_PATH=/app/data/servers.json
```

See `docker-compose.yml` for the full stack setup.

---

## API Reference (Server Endpoints)

PLAT routes are flat and method-name based. The admin API methods are:

- `GET /pending`
- `GET /history`
- `GET /availability`
- `POST /approve`
- `POST /reject`
- `POST /request`

### HTTP Endpoints

#### `POST /connect`

Client sends this to initiate an authority-mode connection.

**Request:**
```json
{
  "server_name": "apple.pear.com/donkey/notebook",
  "offer": { "type": "offer", "sdp": "..." },
  "auth": { "mode": "public", "credentials": null },
  "client": { "ip_hint": "...", "request_id": "..." }
}
```

When `AUTHORITY_ALLOWED_ORIGINS` is configured, the same owned namespace can also be addressed in subdomain form, for example `notes.donkey.apple.pear.com`.

**Response (success):**
```json
{
  "ok": true,
  "answer": { "type": "answer", "sdp": "..." }
}
```

**Response (failure):**
```json
{
  "ok": false,
  "error": "server_offline|unauthorized|rejected|timed_out|rate_limited|malformed"
}
```

#### `GET /healthz`

Liveness check.

```bash
curl https://authority.example.com/healthz
# 200 OK
```

#### `GET /readyz`

Readiness check (includes DB and Redis connectivity).

```bash
curl https://authority.example.com/readyz
# 200 OK if ready, 503 if not
```

### WebSocket Endpoints

#### `wss://authority.example.com/ws/host`

Host persistent connection for registration and signaling relay.

**Host → Server:**
```json
{ "type": "hello", "token": "..." }
{ "type": "register_online", "servers": [...] }
{ "type": "register_offline", "server_names": [...] }
{ "type": "connect_answer", "connection_id": "...", "answer": {...} }
{ "type": "connect_reject", "connection_id": "...", "reason": "..." }
{ "type": "suppress_client", "server_name": "...", "client_key": "...", "ttl_seconds": 3600 }
{ "type": "ping" }
```

**Server → Host:**
```json
{ "type": "connect_request", "connection_id": "...", "server_name": "...", "offer": {...} }
{ "type": "pong" }
```

#### `wss://authority.example.com/ws/presence` (optional)

Clients can subscribe to server online/offline events.

**Client → Server:**
```json
{ "type": "subscribe", "server_names": ["team/alice/notebook"] }
{ "type": "unsubscribe", "server_names": ["team/alice/notebook"] }
```

**Server → Client:**
```json
{ "type": "presence_snapshot", "servers": [{ "server_name": "...", "online": true }] }
{ "type": "presence_update", "server_name": "...", "online": true }
```

### Authentication Endpoint

Authority uses [Google Identity Services](https://developers.google.com/identity/gsi/web) (GIS). The server never handles authorization codes, client secrets, or redirect callbacks — it only verifies a Google-issued ID token and returns an authority session JWT.

#### `POST /authSession`

**Request:**
```json
{
  "id_token": "<Google-issued ID token (JWT)>",
  "role": "user"
}
```

- `id_token` — required. Must be signed by Google and have `aud` matching `GOOGLE_CLIENT_ID` (or one of `GOOGLE_ID_TOKEN_AUDIENCES`).
- `role` — optional. `"admin"` asks for an admin session; authority enforces `ADMIN_GOOGLE_SUBS` and responds `403 not_admin` if the subject is not allow-listed.

**Response (success):**
```json
{
  "ok": true,
  "session_token": "<authority JWT>",
  "google_sub": "1234567890",
  "roles": ["user"],
  "profile": { "sub": "1234567890", "email": "...", "name": "...", "picture": "..." },
  "picture_data": "data:image/jpeg;base64,..."
}
```

Use `Authorization: Bearer <session_token>` on subsequent authority requests.

#### Client flows that produce an ID token

- **Browser:** load the GIS SDK (`https://accounts.google.com/gsi/client`), call `google.accounts.id.initialize({ client_id, callback })`, then render the Sign-In button or call `prompt()`. The `callback` receives a credential (ID token) that you POST to `/authSession`.
- **CLI / installed apps:** use the Google OAuth device code flow with `openid` scope, then send the returned `id_token` to `/authSession`. Add the CLI client ID to `GOOGLE_ID_TOKEN_AUDIENCES` on the server.
- **Service accounts:** mint a service-account signed JWT with the desired `target_audience` and exchange it at Google's token endpoint for an ID token, then POST that to `/authSession`. Add the target audience to `GOOGLE_ID_TOKEN_AUDIENCES`.

#### Admin dashboard

The bundled admin app in `authority/admin/` uses `google.accounts.id.renderButton` to obtain an ID token and calls `/authSession` with `role=admin`. Set `VITE_GOOGLE_CLIENT_ID` at build time so the button can be rendered.

---

## Migration Path

### Phase 1: Start New Projects in Authority Mode
- New server names default to authority mode (no `dmz/` prefix)
- Existing DMZ names continue to work unchanged
- Zero breaking changes

### Phase 2: Move Existing Names (Optional)
- Migrate DMZ names to authority mode by re-registering without `dmz/` prefix
- Clients automatically route to the new authority path
- Can run both simultaneously for testing

### Phase 3: Enhanced Features (Future)
- Trickle ICE for networks requiring it
- TURN servers for relay fallback
- Stronger identity federation
- Multi-instance authority with horizontal scaling

---

## Troubleshooting

### "server_offline"
The host for that server name is not currently connected to the authority. Check:
- Host auth token validity
- Host network connectivity
- Authority server is running

### "rate_limited"
Too many connection requests from your IP/account. Normal limits:
- L0: 500 burst / 10k sustained per 10 min
- Scales down under load (L0 → L4)
- Very lenient on first attempt

### "malformed"
Your connect request JSON is invalid. Check:
- Required fields: `server_name`, `offer`
- Field lengths (e.g., `server_name` < 255 chars, `sdp` < 48 KB)
- No unknown JSON fields

### "unauthorized"
Host rejected the connection based on `auth` payload or admission rules. Check:
- Your `auth` mode matches server's expectations
- Your credentials are valid
- Host has not suppressed your client

---

## Next Steps

1. **Prepare your setup:**
   - Get Google OAuth credentials for host auth
   - Plan your server naming: which names should be authority vs DMZ?
   - Update your deployment config to include Postgres and Redis

2. **Watch for HTTP/WS adapters:**
   - Next week, the full authority server launches
   - Docker Compose file will be ready
   - You can start testing immediately

3. **Update your clients and hosts:**
   - Clients: Change server names to non-`dmz/*` form
   - Hosts: Add authority registration on startup
   - Tests: Add coverage for both dmz and authority routes

4. **Provide feedback:**
   - Error messages? Let us know.
   - Rate limit too strict/lenient? Adjustable.
   - Missing features? Tell us what matters most.

---

## Examples

### Example 1: Migrate a Chat Room from DMZ to Authority

**Before (DMZ):**
```typescript
// Any client can claim any room
const chatClient = await plat.createClient('css://dmz/chat-room-42')
const host = new PLATClientSideServer()
await host.announceOnMQTT({ serverName: 'dmz/chat-room-42' })
```

**After (Authority):**
```typescript
// Only the owner can claim this room
const chatClient = await plat.createClient('css://acme-corp/chat-room-42')

const host = new PLATClientSideServer()
await host.registerWithAuthority({
  url: 'wss://authority.example.com/ws/host',
  token: googleAuthToken,
  serverNames: [{ server_name: 'acme-corp/chat-room-42', auth_mode: 'public' }],
})
```

**That's it.** Routing and handshake are automatic.

### Example 2: Host with Multiple Authority-Mode Rooms

```typescript
const host = new PLATClientSideServer()

await host.registerWithAuthority({
  url: 'wss://authority.example.com/ws/host',
  token: googleAuthToken,
  serverNames: [
    { server_name: 'team/alice/notebook', auth_mode: 'public' },       // anyone can join
    { server_name: 'team/alice/whiteboard', auth_mode: 'private' },   // needs token
    { server_name: 'team/alice/files', auth_mode: 'private' },        // needs token
    // Legacy MQTT name still works
    { server_name: 'dmz/shared-demo', auth_mode: 'public' },          // old path
  ],
})
```

---

## Support

- **Docs:** See `IMPLEMENTATION_STATUS.md` for architecture details
- **Design:** `authority/OVERVIEW.md` and `TECHNICAL_IMPLEMENTATION.md`
- **Issues:** Report bugs or feature requests in the repo

**Ready to try it?** Start with a client connecting to an authority-mode server name. Once the HTTP/WS adapters are live, hosts can register and the full loop will work.
