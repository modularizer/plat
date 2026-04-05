# plat Sample Projects

Seven examples showing different project structures, generation targets, and deployment patterns.

## At a Glance

| Sample | Entry | Controllers | Types | Generates | Auth |
|--------|-------|-------------|-------|-----------|------|
| 1-hello-world | `server.ts` | `server/` | `shared/` | openapi + TS client | none |
| 2-blog-crud | `app.ts` | `api/` | `types/` | openapi + TS client | none |
| 3-ecommerce | `server.ts` | `server/` | `shared/` | openapi + TS + JS(ESM+CJS) + Python + CLIs | none |
| 4-saas-analytics | `src/index.ts` | `src/api/` | `shared/` | openapi + Python client + CLI | JWT |
| 5-client-only | N/A | N/A | N/A | TS + JS(ESM+CJS) + Python + CLIs | N/A |
| 6-client-side-server | `server.html` + `client.html` | browser-hosted | inline editor | static HTML client/server over MQTT-signaled WebRTC | N/A |
| 7-python-client-side-server | `server.html` + `client.html` + `python-client.html` | browser-hosted Python | inline Python editor | static HTML Python server with JS and Python browser clients over MQTT-signaled WebRTC | N/A |

---

## 1. Hello World

Minimal project. Standard layout.

```
server.ts, server/, shared/ -> src/client.ts + openapi.json
```

---

## 2. Blog CRUD

Custom folder layout. Shows that plat doesn't enforce a rigid structure.

```
app.ts, api/, types/ -> generated/client.ts + openapi.json
```

Key difference: entry is `app.ts`, controllers are in `api/`, types are in `types/`, output goes to `generated/`.

---

## 3. E-commerce

Generates **every client type** from a single API. Two controllers (products + orders).

```
server.ts, server/ -> clients/api.ts + api.mjs + api.cjs + api_client.py + cli.mjs + cli.py
```

Shows: TS client, JS ESM client, JS CJS client, Python client, JS CLI, Python CLI.

---

## 4. SaaS Analytics

Nested `src/` layout with JWT authentication. Generates Python client and CLI only.

```
src/index.ts, src/api/ -> dist/api_client.py + dist/cli.py
```

Key difference: entry is `src/index.ts`, controllers live in `src/api/`, outputs go to `dist/`.

---

## 5. Client-Only

**No server at all.** Consumes an `openapi.json` (from file or URL) and generates all client types. This is the pattern for consuming an API from a separate repo.

```
openapi.json -> api.ts + api.mjs + api.cjs + api_client.py + cli.mjs + cli.py
```

---

## 6. Client-Side Server

Two static HTML files:

- `server.html` hosts the browser-side plat server, with an editable code panel that is truly re-imported from the editor contents
- `client.html` acts as the browser-side client, with one-line request snippets and an onscreen response/console view

They communicate through MQTT-signaled WebRTC using the `css://server-name` address shape.

The transport can also persist a host identity keypair and let clients remember or verify the server's public key.

---

## 7. Python Client-Side Server

Two static HTML files again, but this time the browser-hosted server is written in Python via `plat_browser` and launched by the TypeScript browser host utilities.

- `server.html` runs browser Python code and exposes it as a plat client-side server
- `client.html` connects to it like any other OpenAPI-backed plat client

This is the browser-Python parallel of sample 6.

- `python-client.html` runs browser Python client code that connects with `connect_client_side_server(...)`

Like sample 6, the underlying `css://` transport can keep a stable host identity with persisted keys and known-host trust.

---

## Configuration

Each sample has a `.env` file with `PLAT_*` variables that control generation:

```env
# Where things are
PLAT_ENTRY=server.ts              # server entrypoint
PLAT_CONTROLLERS=server/**/*.api.ts  # glob for controller files
PLAT_SPEC=openapi.json            # spec path or URL
PLAT_TYPES=shared                 # shared | generated
PLAT_TYPES_DIR=shared/            # directory for shared types

# What to generate
PLAT_GEN_OPENAPI=openapi.json     # output path for openapi spec
PLAT_GEN_CLIENT_TS=src/api.ts     # TypeScript client
PLAT_GEN_CLIENT_JS=src/api.mjs    # JavaScript client (ESM + CJS)
PLAT_GEN_CLIENT_PY=src/client.py  # Python client
PLAT_GEN_CLI=src/cli.mjs          # CLI scripts (JS + TS + Python)
```

Omit any `PLAT_GEN_*` variable to skip that output.

---

## Core Philosophy

### Method names are routes

```typescript
@GET()
async listProducts(input: ListProductsInput) { }  // GET /listProducts
```

### All input in objects (never path params)

```typescript
// Correct
@GET()
async getPost(input: { id: number }) { }  // GET /getPost?id=123

// Wrong
@GET('/:id')
async getPost(input: any) { }
```

### Plain TypeScript types

Types are defined as plain interfaces with inline comment constraints:

```typescript
export interface Product {
  id: number        // min: 1
  name: string      // min: 1, max: 200
  price: number     // min: 0
  status: 'active' | 'archived'
}
```

### Standard parameter names

| Parameter | Purpose |
|-----------|---------|
| `id` | Resource identifier |
| `q` | Search query |
| `limit` | Pagination limit |
| `offset` | Pagination offset |
| `from` / `to` | Date range |
