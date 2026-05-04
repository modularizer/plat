import * as http from 'http'
import type { AddressInfo } from 'net'
import { createHTTPForwarder } from './http-forwarder'
import type { ClientSideServerChannel } from '../client-side-server/channel'
import type { ClientSideServerMessage } from '../client-side-server/protocol'

function buildFakeChannel() {
  let listener: ((message: ClientSideServerMessage) => void | Promise<void>) | undefined
  const sent: any[] = []
  const channel: ClientSideServerChannel = {
    async send(message) { sent.push(message) },
    subscribe(fn) { listener = fn; return () => { listener = undefined } },
  }
  const deliver = async (message: any) => { await listener?.(message as ClientSideServerMessage) }
  return { channel, deliver, sent }
}

async function startUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  }
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

describe('plat HTTP bridge forwarder', () => {
  it('forwards a GET request and returns the response body', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ hello: 'world' }))
    })
    try {
      const handler = createHTTPForwarder({ upstream: upstream.url, cssName: 'test-api' })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        type: 'PLAT_REQUEST',
        id: 'r1',
        method: 'GET',
        path: '/hello',
        headers: {},
        bodyEncoding: 'none',
      })
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        type: 'PLAT_RESPONSE',
        id: 'r1',
        status: 200,
        bodyEncoding: 'none',
      })
      expect(JSON.parse(sent[0].body)).toEqual({ hello: 'world' })
    } finally {
      await upstream.close()
    }
  })

  it('forwards a normal client-side-server GET request as an http-response envelope', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'x-upstream': 'yes' })
      res.end('hello from upstream')
    })
    try {
      const handler = createHTTPForwarder({ upstream: upstream.url, cssName: 'test-api' })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        jsonrpc: '2.0',
        id: 'c1',
        method: 'GET',
        path: '/hello',
        headers: {},
      })
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        jsonrpc: '2.0',
        id: 'c1',
        ok: true,
        result: {
          _type: 'http-response',
          status: 200,
          statusText: 'OK',
          bodyEncoding: 'none',
          body: 'hello from upstream',
          headers: expect.objectContaining({
            'content-type': 'text/plain; charset=utf-8',
            'x-upstream': 'yes',
          }),
        },
      })
    } finally {
      await upstream.close()
    }
  })

  it('preserves headers by default without injecting forwarded headers', async () => {
    let observed: http.IncomingHttpHeaders = {}
    const upstream = await startUpstream((req, res) => {
      observed = req.headers
      res.writeHead(204)
      res.end()
    })
    try {
      const handler = createHTTPForwarder({
        upstream: upstream.url,
        cssName: 'authority.example/my-api',
      })
      const { channel, deliver } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        type: 'PLAT_REQUEST',
        id: 'r1',
        method: 'GET',
        path: '/',
        headers: { 'x-custom-header': 'hello' },
        bodyEncoding: 'none',
      })
      expect(observed['x-custom-header']).toBe('hello')
      expect(observed['x-forwarded-proto']).toBeUndefined()
      expect(observed['x-forwarded-host']).toBeUndefined()
      expect(observed['x-forwarded-by']).toBeUndefined()
      expect(observed['x-forwarded-for']).toBeUndefined()
      expect(observed['forwarded']).toBeUndefined()
    } finally {
      await upstream.close()
    }
  })

  it('adds X-Forwarded-* and Forwarded headers when explicitly enabled', async () => {
    let observed: http.IncomingHttpHeaders = {}
    const upstream = await startUpstream((req, res) => {
      observed = req.headers
      res.writeHead(204)
      res.end()
    })
    try {
      const handler = createHTTPForwarder({
        upstream: upstream.url,
        cssName: 'authority.example/my-api',
        bridgeName: 'edge-bridge-1',
        disableForwardedHeaders: false,
      })
      const { channel, deliver } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        type: 'PLAT_REQUEST',
        id: 'r1',
        method: 'GET',
        path: '/',
        headers: {},
        bodyEncoding: 'none',
      })
      expect(observed['x-forwarded-proto']).toBe('webrtc')
      expect(observed['x-forwarded-host']).toBe('authority.example/my-api')
      expect(observed['x-forwarded-by']).toBe('edge-bridge-1')
      expect(observed['x-forwarded-for']).toBe('unknown')
      expect(observed['forwarded']).toContain('by=edge-bridge-1')
      expect(observed['forwarded']).toContain('proto=webrtc')
    } finally {
      await upstream.close()
    }
  })

  it('forwards a POST body and returns binary content as base64', async () => {
    let receivedBody = Buffer.alloc(0)
    const upstream = await startUpstream(async (req, res) => {
      receivedBody = await readBody(req)
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(Buffer.from([0xde, 0xad, 0xbe, 0xef]))
    })
    try {
      const handler = createHTTPForwarder({ upstream: upstream.url, cssName: 'bin' })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        type: 'PLAT_REQUEST',
        id: 'r1',
        method: 'POST',
        path: '/echo',
        headers: { 'content-type': 'application/octet-stream' },
        bodyEncoding: 'base64',
        body: Buffer.from([1, 2, 3, 4]).toString('base64'),
      })
      expect(Array.from(receivedBody)).toEqual([1, 2, 3, 4])
      expect(sent[0]).toMatchObject({ status: 200, bodyEncoding: 'base64' })
      expect(Array.from(Buffer.from(sent[0].body, 'base64'))).toEqual([0xde, 0xad, 0xbe, 0xef])
    } finally {
      await upstream.close()
    }
  })

  it('forwards a normal client-side-server POST body and preserves a non-2xx upstream response', async () => {
    let receivedBody = Buffer.alloc(0)
    const upstream = await startUpstream(async (req, res) => {
      receivedBody = await readBody(req)
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html>missing</html>')
    })
    try {
      const handler = createHTTPForwarder({ upstream: upstream.url, cssName: 'mirror' })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        jsonrpc: '2.0',
        id: 'c2',
        method: 'POST',
        path: '/missing',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        bodyEncoding: 'none',
        body: 'payload',
      })
      expect(receivedBody.toString('utf8')).toBe('payload')
      expect(sent[0]).toMatchObject({
        jsonrpc: '2.0',
        id: 'c2',
        ok: true,
        result: {
          _type: 'http-response',
          status: 404,
          statusText: 'Not Found',
          bodyEncoding: 'none',
          body: '<html>missing</html>',
          headers: expect.objectContaining({
            'content-type': 'text/html; charset=utf-8',
          }),
        },
      })
    } finally {
      await upstream.close()
    }
  })

  it('refuses disallowed methods with 405', async () => {
    const upstream = await startUpstream((_req, res) => { res.writeHead(200); res.end() })
    try {
      const handler = createHTTPForwarder({
        upstream: upstream.url,
        cssName: 'ro',
        allowMethods: ['GET'],
      })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        type: 'PLAT_REQUEST',
        id: 'r1',
        method: 'POST',
        path: '/',
        headers: {},
        bodyEncoding: 'none',
      })
      expect(sent[0]).toMatchObject({ status: 405, errorCode: 'method-not-allowed' })
    } finally {
      await upstream.close()
    }
  })

  it('refuses paths outside allowPaths with 403', async () => {
    const upstream = await startUpstream((_req, res) => { res.writeHead(200); res.end() })
    try {
      const handler = createHTTPForwarder({
        upstream: upstream.url,
        cssName: 'scoped',
        allowPaths: ['^/v1/'],
      })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        type: 'PLAT_REQUEST',
        id: 'r1',
        method: 'GET',
        path: '/admin',
        headers: {},
        bodyEncoding: 'none',
      })
      expect(sent[0]).toMatchObject({ status: 403, errorCode: 'path-not-allowed' })
    } finally {
      await upstream.close()
    }
  })

  it('can resolve the upstream dynamically from interceptOrigin', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'x-forwarded-path': req.url ?? '',
      })
      res.end(JSON.stringify({ ok: true, host: req.headers.host }))
    })
    try {
      const handler = createHTTPForwarder({
        cssName: 'mirror',
        upstreamMode: 'intercept-origin',
      })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        jsonrpc: '2.0',
        id: 'c3',
        method: 'GET',
        path: '/dynamic?x=1',
        headers: {},
        requestOrigin: 'https://ignored.example.test',
        interceptOrigin: upstream.url,
      })
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        jsonrpc: '2.0',
        id: 'c3',
        ok: true,
        result: {
          _type: 'http-response',
          status: 200,
          headers: expect.objectContaining({
            'content-type': 'application/json; charset=utf-8',
            'x-forwarded-path': '/dynamic?x=1',
          }),
        },
      })
      expect(JSON.parse(sent[0].result.body)).toEqual({
        ok: true,
        host: upstream.url.replace(/^https?:\/\//, ''),
      })
    } finally {
      await upstream.close()
    }
  })

  it('returns a synthetic 502 when dynamic upstream metadata is missing', async () => {
    const handler = createHTTPForwarder({
      cssName: 'mirror',
      upstreamMode: 'intercept-origin',
    })
    const { channel, deliver, sent } = buildFakeChannel()
    handler.serveChannel(channel)
    await deliver({
      jsonrpc: '2.0',
      id: 'c4',
      method: 'GET',
      path: '/dynamic',
      headers: {},
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 'c4',
      ok: true,
      result: {
        _type: 'http-response',
        status: 502,
        statusText: 'No upstream origin available for mode "intercept-origin"',
      },
    })
  })

  it('resolves viewer-relative requests against the bridge runtime origin', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(req.url ?? '')
    })
    const originalLocation = (globalThis as any).location
    ;(globalThis as any).location = { origin: upstream.url }
    try {
      const handler = createHTTPForwarder({
        cssName: 'mirror',
        upstreamMode: 'intercept-origin',
      })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        jsonrpc: '2.0',
        id: 'c5',
        method: 'GET',
        path: '/',
        headers: {},
        clientOrigin: 'http://localhost:6005',
        requestOrigin: 'http://localhost:6005',
        interceptOrigin: 'http://localhost:6005',
      })
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        jsonrpc: '2.0',
        id: 'c5',
        ok: true,
        result: {
          _type: 'http-response',
          status: 200,
          body: '/',
        },
      })
    } finally {
      ;(globalThis as any).location = originalLocation
      await upstream.close()
    }
  })

  it('preserves route base path when remapping intercept origin to bridge runtime origin', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(req.url ?? '')
    })
    const originalLocation = (globalThis as any).location
    ;(globalThis as any).location = { origin: upstream.url }
    try {
      const handler = createHTTPForwarder({
        cssName: 'mirror',
        upstreamMode: 'intercept-origin',
      })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        jsonrpc: '2.0',
        id: 'c6',
        method: 'GET',
        path: 'tiles/vector.pbf?z=12',
        headers: {},
        clientOrigin: 'https://www.google.com',
        requestOrigin: 'https://www.google.com',
        interceptOrigin: 'https://www.google.com/maps',
      })
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        jsonrpc: '2.0',
        id: 'c6',
        ok: true,
        result: {
          _type: 'http-response',
          status: 200,
          body: '/maps/tiles/vector.pbf?z=12',
        },
      })
    } finally {
      ;(globalThis as any).location = originalLocation
      await upstream.close()
    }
  })

  it('keeps leading-slash paths origin-root by default', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(req.url ?? '')
    })
    const originalLocation = (globalThis as any).location
    ;(globalThis as any).location = { origin: upstream.url }
    try {
      const handler = createHTTPForwarder({
        cssName: 'mirror',
        upstreamMode: 'intercept-origin',
      })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        jsonrpc: '2.0',
        id: 'c7',
        method: 'GET',
        path: '/xjs/_/js/k=test',
        headers: {},
        clientOrigin: 'https://www.google.com',
        requestOrigin: 'https://www.google.com',
        interceptOrigin: 'https://www.google.com/maps',
      })
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        jsonrpc: '2.0',
        id: 'c7',
        ok: true,
        result: {
          _type: 'http-response',
          status: 200,
          body: '/xjs/_/js/k=test',
        },
      })
    } finally {
      ;(globalThis as any).location = originalLocation
      await upstream.close()
    }
  })

  it('can prefix leading-slash paths with route base when explicitly enabled', async () => {
    const upstream = await startUpstream((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(req.url ?? '')
    })
    const originalLocation = (globalThis as any).location
    ;(globalThis as any).location = { origin: upstream.url }
    try {
      const handler = createHTTPForwarder({
        cssName: 'mirror',
        upstreamMode: 'intercept-origin',
        pathBaseMode: 'route-base',
      })
      const { channel, deliver, sent } = buildFakeChannel()
      handler.serveChannel(channel)
      await deliver({
        jsonrpc: '2.0',
        id: 'c8',
        method: 'GET',
        path: '/xjs/_/js/k=test',
        headers: {},
        clientOrigin: 'https://www.google.com',
        requestOrigin: 'https://www.google.com',
        interceptOrigin: 'https://www.google.com/maps',
      })
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        jsonrpc: '2.0',
        id: 'c8',
        ok: true,
        result: {
          _type: 'http-response',
          status: 200,
          body: '/maps/xjs/_/js/k=test',
        },
      })
    } finally {
      ;(globalThis as any).location = originalLocation
      await upstream.close()
    }
  })

})
