# WebRTC Serving + HTTP⇄WebRTC Bridge — Plan

## Goals

1. **TS server-side `PLATServer` serves over WebRTC** (in addition to HTTP/WS).
2. **Python server-side `PLATServer` serves over WebRTC** (in addition to HTTP).
3. **HTTP⇄WebRTC bridge** (TS and Python): a standalone process that registers with the authority exactly like a client-side server, but every incoming request is forwarded as a raw HTTP call to a configured upstream on the same LAN, and the response is shipped back over the same data channel.

All three reuse the existing `css://` signaling, identity, and authority-registration machinery — no new trust model.

## What exists today (reusable)

- `typescript/src/client-side-server/mqtt-webrtc.ts` — MQTT-signalled WebRTC server runtime. Already falls back to `@roamhq/wrtc` in Node (`resolveClientWebRTCImplementation`, line ~2136).
- `typescript/src/client-side-server/server.ts` — CSS `PLATServer` that uses the shared `PLATServerCore`. Shows the full wire-up: identity → signaler → data channel → `PLATServerCore.dispatch`.
- `typescript/src/client-side-server/identity.ts` — authority/trust-on-first-use identity, sealed envelopes, challenges.
- `typescript/src/client-side-server/protocol.ts` — wire types. Note two relevant framings:
  - `ClientSideServerRequest` (JSON-RPC) — what the existing CSS server speaks.
  - `ServiceWorkerBridgeRequestMessage` / `ServiceWorkerBridgeResponseMessage` — **already raw-HTTP-shaped** (method, path, headers, base64 body, status, statusText). We'll adopt this framing for the bridge.
- `python/plat/css_transport_plugin.py` — Python CSS *client* (aiortc + paho-mqtt). Reuse its MQTT/aiortc/identity glue for the server and bridge.
- `python/plat/css_identity.py` — Python authority/trust machinery.

## Wire format

Two data-channel framings coexist on a single channel, discriminated by top-level field:

- `{ jsonrpc: "2.0", ... }` → JSON-RPC envelope (existing CSS `PLATServer` path).
- `{ type: "PLAT_REQUEST" | "PLAT_RESPONSE", ... }` → raw-HTTP framing (used by the bridge).

The raw-HTTP framing already exists (`ServiceWorkerBridgeRequestMessage`, `ServiceWorkerBridgeResponseMessage`) so **no new wire type is introduced**. The bridge only speaks the raw-HTTP framing; the server-side `PLATServer`s only speak JSON-RPC.

A client that wants to target a bridge uses the raw-HTTP framing directly (e.g. a `fetch` polyfill that writes `PLAT_REQUEST` over the channel). This matches the existing service-worker code path and is reusable.

## 1. TS server-side WebRTC serving

**New file:** `typescript/src/server/webrtc-plugin.ts` — extracts the MQTT-signaler+WebRTC wiring shared with `client-side-server/server.ts`. Takes a `PLATServerCore` and options, returns `{ start, stop }`.

**Edits:**
- `typescript/src/server/config.ts` — add `webrtc?: PLATServerWebRTCOptions` to `PLATServerOptions`:
  ```ts
  export interface PLATServerWebRTCOptions {
    name: string                              // css:// name, e.g. "dmz/my-api" or "myauthority.com/my-api"
    mqtt?: { broker?: string; topic?: string }
    iceServers?: RTCIceServer[]
    identity?: ClientSideServerExportedKeyPair | 'generate' | 'persist'
    authorityRecord?: ClientSideServerSignedAuthorityRecord
  }
  ```
- `typescript/src/server/server.ts` — in `listen()`, if `options.webrtc` is set, start the WebRTC plugin pointed at the same `this.core`. In `close()`, stop it.
- Refactor `typescript/src/client-side-server/server.ts` to delegate to `webrtc-plugin.ts` so there is exactly one implementation.

**Deps:** add `@roamhq/wrtc` as an **optionalDependency** in `typescript/package.json`. Throw a clear error if `options.webrtc` is set but the package is not installed.

## 2. Python server-side WebRTC serving

**New file:** `python/plat/css_server_transport_plugin.py` — the Python counterpart to `mqtt-webrtc.ts`:
- Subscribe on `config.mqtt_topic` via `paho-mqtt`.
- For each incoming sealed `offer`: verify client identity (if required), create `aiortc.RTCPeerConnection`, set remote description, create/send `answer` (signed with the server identity), stream ICE candidates, accept the data channel.
- For each JSON-RPC `ClientSideServerRequest` on the data channel: resolve via the server's `transport_runtime` (existing dispatch path, same one HTTP uses) and send back `ClientSideServerSuccessResponse` / `ClientSideServerErrorResponse`.
- Reuse `css_identity.py` for identity/challenges and the sealed-envelope format.

**Edits:**
- `python/plat/server_types.py` — add `webrtc: CSSServerOptions | None = None` to `PLATServerOptions`.
- `python/plat/server.py` — in `PLATServer.listen()`, if `options.webrtc` is set, start the WebRTC server task on the event loop alongside uvicorn; cancel it on shutdown.
- `python/plat/css_transport_plugin.py` — lift shared helpers (MQTT client, sealed envelope parse/build, ICE candidate serde) into a new `python/plat/css_shared.py` so the client and server both use the same code.

**Deps:** `aiortc` and `paho-mqtt` are already under the `[css]` extra in `python/pyproject.toml`. No new deps. (If running the server-side over WebRTC, users install with `pip install "modularizer-plat[css]"`.)

## 3. HTTP⇄WebRTC bridge

The bridge is a CSS-style endpoint that:
- Registers with an authority (or runs DMZ) under a configured `css://` name.
- Accepts `ServiceWorkerBridgeRequestMessage` on the data channel.
- Makes a `fetch` / `httpx` call to `upstream_base_url + path` with the same method/headers/body.
- Returns a `ServiceWorkerBridgeResponseMessage` with the upstream's status/headers/body.

It does **not** use `PLATServerCore`, OpenAPI, controllers, routing, or any operation registry — it is a pure HTTP tunnel.

### 3a. TypeScript bridge

- **New package entry:** `typescript/src/bridge/index.ts` and CLI `typescript/src/bridge/cli.ts`.
- **CLI:** `plat-bridge --name <css-name> --upstream http://localhost:8080 [--authority <url>] [--identity <path>] [--mqtt <url>]`
- Uses the shared `webrtc-plugin.ts` from step 1 to run the signaler, but installs a **raw-HTTP handler** for `PLAT_REQUEST` messages instead of wiring to `PLATServerCore`.
- Streaming: start with buffered request/response (simplest, matches current framing). Add chunked streaming later if needed.

### 3b. Python bridge

- **New file:** `python/plat/bridge.py` + CLI entry in `python/plat/cli.py` (`plat bridge ...` subcommand).
- Same shape as the TS bridge, but uses `aiortc` + `paho-mqtt` + `httpx.AsyncClient` for the upstream.
- Shares `css_shared.py` helpers from step 2.

### Bridge invariants

- Respects `Host` header rewriting: forwards the LAN-local `Host` for the upstream, not the `css://` name.
- Strips/relays hop-by-hop headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`) per RFC 7230.
- Body framing: `ServiceWorkerBridgeBodyEncoding = 'none' | 'base64'` already exists — use `base64` for non-UTF-8 bodies.
- One in-flight request per `id`; bridge serially services messages per channel but can run concurrent requests across channels.
- Optional allowlist: `--allow-methods`, `--allow-paths` (regex) so a bridge can be scoped to a specific API.

### Client-IP forwarding (bridge + server-side)

There is no TCP `remoteAddress` over WebRTC. After ICE completes, the bridge/server reads the **selected candidate pair** from the `RTCPeerConnection` and extracts the peer's address. Two realities:

- **Direct P2P:** address is the peer's public IP (possibly behind NAT, but a real endpoint).
- **TURN-relayed:** address is the TURN server's IP. The true origin is only visible to the TURN provider. Document this.

**Headers the bridge adds by default** when forwarding to the upstream HTTP server:

| Header | Value | Notes |
|---|---|---|
| `X-Forwarded-For` | `<ice-remote-ip>` | If the client already sent `X-Forwarded-For` and `--trust-client-forwarded` is set, append the ICE address; otherwise replace. |
| `X-Forwarded-Proto` | `webrtc` | Signals non-HTTP origin. Upstreams that gate on `https` should accept `webrtc` equivalently. |
| `X-Forwarded-Host` | `<css-name>` (e.g. `my-api` or `authority.com/my-api`) | The css:// name the client addressed. |
| `X-Forwarded-By` | `<bridge-css-name>` | Identifies this bridge instance. |
| `Forwarded` | `for=<ice-remote-ip>;proto=webrtc;host=<css-name>;by=<bridge-css-name>` | RFC 7239. Bridge appends to an existing `Forwarded` header rather than replacing. |
| `X-Plat-Client-Identity` | `<client CSS public-key fingerprint>` | Optional, only if the client authenticated via CSS identity. Strong (cryptographic) identifier, unlike IP. |
| `X-Plat-Ice-Candidate-Type` | `host` / `srflx` / `relay` | So upstream can tell whether the IP is real or a TURN relay. |

CLI flags:
- `--trust-client-forwarded` (default: `false`) — if set, the bridge preserves a client-supplied `X-Forwarded-For` / `Forwarded` by appending rather than replacing. Off by default because a malicious CSS client could otherwise spoof IPs.
- `--no-forwarded-headers` — disable all `X-Forwarded-*` / `Forwarded` injection (for upstreams that reject unknown headers).
- `--bridge-name <name>` — value used in `X-Forwarded-By` / `Forwarded by=`. Defaults to the bridge's `--name`.

**Server-side PLATServer (no bridge):** the `RouteContext` is extended with:

```ts
interface RouteContext {
  // ...existing fields
  remoteAddress?: string          // ICE-selected peer IP (may be a TURN relay)
  remoteAddressType?: 'host' | 'srflx' | 'relay'
  clientIdentity?: {              // present iff the CSS client signed a challenge
    publicKeyJwk: JsonWebKey
    fingerprint: string
  }
}
```

Handlers can treat `ctx.remoteAddress` like `req.ip`, but must check `ctx.remoteAddressType === 'relay'` before trusting it for geo/rate-limit purposes. The Python `RouteContext` gains the same fields.

## Dependencies summary

| Package | Node | Python |
|---|---|---|
| WebRTC | `@roamhq/wrtc` (optional) | `aiortc` (existing `[css]` extra) |
| MQTT | `mqtt` (existing) | `paho-mqtt` (existing `[css]` extra) |
| HTTP client (bridge only) | `undici` / global `fetch` | `httpx` (new, bridge-only extra `[bridge]`) |

## Tests

- **TS:** extend `mqtt-webrtc.spec.ts` with a server-side Node test (boot `PLATServer` with `webrtc`, connect via existing CSS client, round-trip a JSON-RPC call). New `bridge.spec.ts` spins up a throwaway `http.createServer` upstream and verifies round-trip through the bridge.
- **Python:** new `python/tests/test_css_server.py` — boot `PLATServer(webrtc=...)`, connect using the existing `css_transport_plugin.py` client, round-trip a controller call. New `python/tests/test_bridge.py` with an `aiohttp`/`httpx` upstream.
- **Cross-runtime smoke:** TS bridge ↔ Python upstream, and Python bridge ↔ TS upstream.

## File-by-file change list

**TS**
- `typescript/src/server/webrtc-plugin.ts` (new)
- `typescript/src/server/config.ts` (add `webrtc` option)
- `typescript/src/server/server.ts` (wire up in `listen`/`close`)
- `typescript/src/client-side-server/server.ts` (delegate to `webrtc-plugin.ts`)
- `typescript/src/bridge/{index,cli,http-forwarder}.ts` (new)
- `typescript/package.json` (optional `@roamhq/wrtc`, bin entry `plat-bridge`)

**Python**
- `python/plat/css_shared.py` (new — MQTT/aiortc/envelope helpers lifted from `css_transport_plugin.py`)
- `python/plat/css_server_transport_plugin.py` (new)
- `python/plat/css_transport_plugin.py` (refactor to import from `css_shared.py`)
- `python/plat/server.py` (wire up webrtc in `listen`)
- `python/plat/server_types.py` (add `webrtc` option)
- `python/plat/bridge.py` (new)
- `python/plat/cli.py` (add `bridge` subcommand)
- `python/pyproject.toml` (optional `[bridge]` extra: `httpx`)

**Docs**
- Update `SIGNALING.md` to note server-side WebRTC is supported.
- New `BRIDGE.md` with usage examples.

## Open questions (flag before coding)

- Should the bridge forward cookies / `Authorization` unchanged, or require an explicit `--forward-headers` allowlist? Default: forward all, but document the exposure.
- Should server-side WebRTC default to DMZ mode (`css://dmz/<name>`) or require an authority? I'd default to "whichever the caller configures," no magic default.
- Identity persistence: where does the server-side server store its long-term CSS keypair? Probably `~/.config/plat/identity.json` on Linux, respecting `$XDG_CONFIG_HOME`; same path for Python and TS.

## Execution order

1. Extract `webrtc-plugin.ts` from `client-side-server/server.ts`, no behavior change. Verify existing CSS tests still pass.
2. Wire it into server-side `PLATServer` (TS). Add a test.
3. Lift Python `css_shared.py`. No behavior change.
4. Build Python `css_server_transport_plugin.py` + wire into `PLATServer`. Add a test.
5. Build TS bridge. Test against a real HTTP upstream.
6. Build Python bridge. Test against a real HTTP upstream.
7. Cross-runtime smoke test.
8. Docs.
