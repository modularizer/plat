# Service Worker Bridge: Universal HTTP Interception

> **Recommended approach** for plat-bridge HTTP interception. Eliminates monkey-patching and intercepts requests at the browser's lowest network layer.

## Overview

The Service Worker bridge is a **native browser API** that sits between your application and the network. When registered, it receives **every single HTTP request** before it leaves the browser—regardless of how it was initiated (fetch, XHR, resource elements, forms, WebSocket upgrades, etc.).

### Why Service Workers?

| Aspect | Monkey-patch | Service Worker |
|--------|--------------|-----------------|
| **Coverage** | ~95% (fragile) | ~99% (robust) |
| **Code size** | 750+ lines | 150 lines |
| **Special cases** | 10+ (fetch, XHR, Worker, EventSource, forms, sendBeacon, etc.) | 0 |
| **Maintenance** | High (each API needs patches) | Low (single handler) |
| **Browser support** | Universal | Good (no IE, needs HTTPS/localhost) |
| **Lifecycle** | Per-page | Persistent (survives page reloads) |

### What Gets Intercepted

✅ `fetch()` calls  
✅ `XMLHttpRequest`  
✅ All resource elements (`<img>`, `<script>`, `<link>`, `<iframe>`, `<audio>`, `<video>`, etc.)  
✅ Form submissions  
✅ Worker scripts  
✅ `navigator.sendBeacon()`  
✅ `EventSource` streaming  
✅ CSS `@import` and `url()` references  
✅ Image `srcset` responsive images  
✅ Stylesheets  
✅ **Any future fetch-like API**  

### What Doesn't Get Intercepted

⚠️ **WebSocket connections** — Uses binary protocol, not HTTP semantics  
⚠️ **Browser navigations** — `window.location =`, `<meta refresh>`, context-menu "open in new tab"  
⚠️ **Service Worker itself** — Cannot intercept its own registration/update  

These are **fundamental browser limitations**, not implementation gaps.

---

## Setup

### 1. Place the Service Worker File

The Service Worker must be served from your static assets at a predictable URL (e.g., `/plat-service-worker.js`):

```bash
cp dist/plat-service-worker.js public/
```

Or generate it dynamically:

```typescript
import { generateServiceWorkerCode } from '@modularizer/plat/client-server'

app.get('/plat-service-worker.js', (req, res) => {
  res.type('application/javascript')
  res.send(generateServiceWorkerCode())
})
```

### 2. Create a Channel

Create your plat channel (MQTT, WebRTC, or custom):

```typescript
import { ClientSideServerMQTT } from '@modularizer/plat/client-server'

const channel = new ClientSideServerMQTT({
  brokerUrl: 'mqtt://localhost:1883',
  serverName: 'my-app',
  onConnect: () => console.log('Connected to MQTT broker'),
})
```

### 3. Install the Bridge

In your main HTML or JavaScript:

```typescript
import { installServiceWorkerBridge, installServiceWorkerClient } from '@modularizer/plat/client-server'

// Register the Service Worker
const bridgeHandle = await installServiceWorkerBridge(channel, {
  scope: '/',  // Intercept all paths
  workerUrl: '/plat-service-worker.js'  // Where the worker file is served
})

// Install the main-thread message handler
const clientHandle = installServiceWorkerClient(channel)
```

Done! All requests are now intercepted.

---

## Architecture

### Request Flow

```
User Code
  ↓
fetch('/api/users') or <img src="/logo.png"> or form.submit()
  ↓
[Service Worker intercepts fetch event]
  ↓
generateRequest: { method, path, headers, body }
  ↓
postMessage to main thread
  ↓
[Main thread receives PLAT_REQUEST message]
  ↓
createPlatFetch() routes through channel (MQTT, WebRTC, etc.)
  ↓
Response from server (same or different origin)
  ↓
postMessage back to Service Worker
  ↓
Service Worker: new Response(body, { status, headers })
  ↓
Promise resolves to Response object
  ↓
Application receives Response
```

### Message Protocol

**PLAT_REQUEST** (Service Worker → Main Thread):
```typescript
{
  type: 'PLAT_REQUEST',
  id: '0.8493927849320',    // Unique request ID
  method: 'GET',
  path: '/api/users',
  headers: { 'content-type': 'application/json', ... },
  body: null | 'request body',
}
```

**PLAT_RESPONSE** (Main Thread → Service Worker):
```typescript
{
  type: 'PLAT_RESPONSE',
  id: '0.8493927849320',    // Matches request ID
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json', ... },
  body: null,
  bodyBase64: 'base64-encoded-response-body',  // Safe for postMessage
  error?: 'optional error message',  // If request failed
}
```

### Timeout Behavior

- **Service Worker timeout**: 30 seconds (configurable in worker code)
- If main thread doesn't respond in time, request fails with HTTP 500
- Network errors are caught and returned as HTTP 500 with error message

---

## API Reference

### `installServiceWorkerBridge(channel, options?)`

Register the Service Worker and wire it to a channel.

```typescript
export async function installServiceWorkerBridge(
  channel: ClientSideServerChannel,
  options?: {
    scope?: string          // Default: '/'
    workerUrl?: string      // Default: '/plat-service-worker.js'
  }
): Promise<ServiceWorkerBridgeHandle>
```

**Returns:**
```typescript
interface ServiceWorkerBridgeHandle {
  unregister(): Promise<void>
}
```

**Throws** if:
- Service Workers are not supported (IE, old browsers)
- Worker URL is unreachable (404, CORS, etc.)
- Registration fails for other reasons

### `installServiceWorkerClient(channel)`

Install the main-thread message handler that processes requests from the Service Worker.

```typescript
export function installServiceWorkerClient(
  channel: ClientSideServerChannel
): ServiceWorkerClientHandle
```

**Returns:**
```typescript
interface ServiceWorkerClientHandle {
  uninstall(): void
}
```

### `generateServiceWorkerCode()`

Generate the Service Worker code as a JavaScript string (for dynamic serving).

```typescript
export function generateServiceWorkerCode(): string
```

**Returns** the full Service Worker code, ready to be served with `Content-Type: application/javascript`.

---

## Examples

### Simple Setup (MQTT)

```html
<!doctype html>
<html>
  <head>
    <script type="importmap">
      {
        "imports": {
          "@modularizer/plat/client-server": "../../dist/client-server-entry.js",
          "mqtt": "https://esm.sh/mqtt@5.15.1?bundle"
        }
      }
    </script>
  </head>
  <body>
    <script type="module">
      import { ClientSideServerMQTT, installServiceWorkerBridge, installServiceWorkerClient } from '@modularizer/plat/client-server'

      // Create channel
      const channel = new ClientSideServerMQTT({
        brokerUrl: 'mqtt://localhost:1883',
        serverName: 'my-app',
      })

      // Install bridge
      await installServiceWorkerBridge(channel)
      installServiceWorkerClient(channel)

      // Now all requests are intercepted!
      const data = await (await fetch('/api/users')).json()
      console.log('Got data:', data)
    </script>
  </body>
</html>
```

### Dynamic Worker Serving (Express)

```typescript
import express from 'express'
import { generateServiceWorkerCode } from '@modularizer/plat/client-server'

const app = express()

// Serve generated Service Worker
app.get('/plat-service-worker.js', (req, res) => {
  res.type('application/javascript')
  res.send(generateServiceWorkerCode())
})

// OR: Serve static file
app.use(express.static('public'))  // Contains plat-service-worker.js
```

### Conditional Installation

```typescript
// Only install if supported
if ('serviceWorker' in navigator) {
  try {
    const handle = await installServiceWorkerBridge(channel)
    console.log('Bridge installed successfully')
  } catch (err) {
    console.warn('Service Worker not available, falling back to monkey-patch:', err.message)
    // Optionally fall back to plat-bridge
    // installBridge(channel)
  }
} else {
  console.log('Service Workers not supported')
}
```

### Uninstalling

```typescript
// Later: remove the bridge
const handle = await installServiceWorkerBridge(channel)
// ...
await handle.unregister()
console.log('Service Worker unregistered')
```

---

## Debugging

### Browser DevTools

1. **Service Worker registration:**
   - Open DevTools → Application → Service Workers
   - Should see `/plat-service-worker.js` as "activated and running"

2. **Network inspection:**
   - Open DevTools → Network
   - Requests intercepted by Service Worker show **(from ServiceWorker)** badge
   - Requests NOT intercepted go to actual network

3. **Console logs:**
   - Service Worker logs appear in DevTools → Application → Service Workers → (click worker name)
   - Main thread logs appear in regular console

### Message Inspection

Add logging to see request/response flow:

```typescript
// In plat-service-worker-client.ts, before sending response:
console.log('PLAT_REQUEST received:', msg)
console.log('Forwarding to channel...')

// In Service Worker, before responding:
console.log('PLAT_RESPONSE received:', responseData)
```

### Testing Endpoints

Create test endpoints on your server:

```typescript
app.get('/api/test', (req, res) => {
  res.json({ message: 'Hello from Service Worker!', time: Date.now() })
})
```

Then test in page:
```javascript
const resp = await fetch('/api/test')
const data = await resp.json()
console.log(data)
```

---

## Browser Support

| Browser | Support | Notes |
|---------|---------|-------|
| **Chrome/Edge** | ✅ Full | Requires HTTPS (except localhost) |
| **Firefox** | ✅ Full | Requires HTTPS (except localhost) |
| **Safari** | ✅ Partial | Full support as of Safari 11.1+ |
| **Mobile** | ✅ Good | Works on iOS/Android with HTTPS |
| **IE** | ❌ Not supported | No Service Worker API |

### HTTPS Requirement

Service Workers require a secure context (HTTPS) **except for `localhost`**.

**Development:** Works on `http://localhost:3000` ✓  
**Production:** Must use HTTPS ✓  
**Testing:** `http://192.168.x.x` ❌ (fails without HTTPS)

---

## Known Limitations

### 1. WebSocket Connections

WebSocket upgrade requests go through the `Upgrade` HTTP header, but the Service Worker intercepts them too. However, WebSocket semantics don't map to request/response, so we can't properly handle them.

**Workaround:** Disable interception for WebSocket URLs:
```typescript
// In plat-service-worker.js shouldIntercept():
if (url.includes('ws://') || url.includes('wss://')) return false
```

### 2. Browser Navigation

When user clicks browser back/forward, navigates via address bar, or uses context menu "open in new tab," the Service Worker is **bypassed** and goes directly to network.

**Why:** Browser navigation controls are outside JavaScript scope.

**Workaround:** Use SPA navigation (fetch HTML, update DOM) instead of full-page loads.

### 3. Service Worker Updates

Updating the Service Worker file requires all clients to refresh or wait for auto-update. There's no way to force immediate update from JavaScript.

**Workaround:** Use semantic versioning in service worker file and provide UI button to refresh.

---

## Migration from Monkey-Patch Bridge

If you're currently using `installBridge()` (the monkey-patch approach):

**Before:**
```typescript
import { installBridge } from '@modularizer/plat/client-server'
installBridge(channel)
```

**After:**
```typescript
import { installServiceWorkerBridge, installServiceWorkerClient } from '@modularizer/plat/client-server'
await installServiceWorkerBridge(channel)
installServiceWorkerClient(channel)
```

**Advantages:**
- ✅ Cleaner (2 function calls vs. 1 function patching 10+ APIs)
- ✅ More reliable (native browser API)
- ✅ Persists across page reloads
- ✅ Smaller footprint (150 lines vs. 750 lines)
- ✅ Easier to debug (DevTools → Service Workers)

---

## Comparison: Service Worker vs. Monkey-Patch

### Coverage

**Service Worker:**
- Fetch, XHR, images, scripts, styles, forms, sendBeacon, EventSource, workers
- ~99% coverage

**Monkey-Patch:**
- Same endpoints, but each needs separate patching
- ~95% coverage (edge cases slip through)

### Implementation Complexity

**Service Worker:**
```typescript
// plat-service-worker.ts: ~200 lines
// plat-service-worker-client.ts: ~80 lines
// Total: ~280 lines
```

**Monkey-Patch:**
```typescript
// plat-bridge.ts: 750+ lines
// Patches: fetch, XHR, Worker, EventSource, sendBeacon, forms, DOM elements, etc.
// Special handling: CSS URL rewriting, srcset, inline styles, blob caching, etc.
```

### Request Lifecycle

**Service Worker:**
1. Intercept at network layer
2. Check if should intercept
3. Send to main thread
4. Main thread calls platFetch
5. Response returns to worker
6. Worker sends Response object

**Monkey-Patch:**
1. Application calls fetch/XHR/etc.
2. Patch intercepts
3. Extract URL/body/headers
4. Call platFetch
5. Manipulate Response
6. Return to application

---

## FAQ

**Q: Why does it take 30 seconds to timeout?**  
A: This is the maximum time the Service Worker will wait for the main thread to respond. Adjust in the worker code if needed.

**Q: Can I use Service Worker + Monkey-Patch together?**  
A: Yes, but unnecessary. Service Worker handles everything. Monkey-patch would be redundant.

**Q: What if the main thread crashes?**  
A: Requests timeout after 30 seconds and fail with HTTP 500.

**Q: Does Service Worker work offline?**  
A: Not without additional setup. The bridge assumes network connectivity. To support offline, implement caching strategy separately.

**Q: Can I intercept WebSocket?**  
A: Not cleanly. Add to `shouldIntercept()` exclusion list:
```typescript
if (url.includes('ws:') || url.includes('wss:')) return false
```

---

## Next Steps

1. **Try the demo:** Open `/service-worker-demo.html` in the sample
2. **Read the source:** Check `plat-service-worker.ts` and `plat-service-worker-client.ts`
3. **Deploy:** Copy Service Worker to production static assets
4. **Monitor:** Use DevTools to inspect interception in real deployments

