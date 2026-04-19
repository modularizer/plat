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

  it('adds X-Forwarded-* and Forwarded headers by default', async () => {
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
})
