import { createPlatFetch } from './plat-fetch'
import type { ClientSideServerChannel } from './channel'

describe('createPlatFetch', () => {
  it('turns an http-response envelope into a real Response', async () => {
    let listener: ((message: any) => void | Promise<void>) | undefined
    const channel: ClientSideServerChannel = {
      async send(message) {
        await listener?.({
          jsonrpc: '2.0',
          id: message.id,
          ok: true,
          result: {
            _type: 'http-response',
            status: 404,
            statusText: 'Not Found',
            headers: { 'content-type': 'text/html; charset=utf-8' },
            bodyEncoding: 'none',
            body: '<html>missing</html>',
          },
        })
      },
      subscribe(fn) {
        listener = fn
        return () => { listener = undefined }
      },
    }

    const platFetch = createPlatFetch({ channel })
    const response = await platFetch('/missing')

    expect(response.status).toBe(404)
    expect(response.statusText).toBe('Not Found')
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await response.text()).toBe('<html>missing</html>')
  })

  it('preserves a string body on the channel request for mirror-style POSTs', async () => {
    let sent: any
    let listener: ((message: any) => void | Promise<void>) | undefined
    const channel: ClientSideServerChannel = {
      async send(message) {
        sent = message
        await listener?.({
          jsonrpc: '2.0',
          id: message.id,
          ok: true,
          result: {
            _type: 'http-response',
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            bodyEncoding: 'none',
            body: 'ok',
          },
        })
      },
      subscribe(fn) {
        listener = fn
        return () => { listener = undefined }
      },
    }

    const platFetch = createPlatFetch({ channel })
    await platFetch('/submit', {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: 'payload',
    })

    expect(sent).toMatchObject({
      method: 'POST',
      path: '/submit',
      requestOrigin: 'http://localhost',
      interceptOrigin: 'http://localhost',
      bodyEncoding: 'none',
      body: 'payload',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
    expect(sent.clientOrigin).toBeUndefined()
  })

  it('sends explicit request and intercept origins for absolute intercepted URLs', async () => {
    let sent: any
    let listener: ((message: any) => void | Promise<void>) | undefined
    const channel: ClientSideServerChannel = {
      async send(message) {
        sent = message
        await listener?.({
          jsonrpc: '2.0',
          id: message.id,
          ok: true,
          result: {
            _type: 'http-response',
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            bodyEncoding: 'none',
            body: 'ok',
          },
        })
      },
      subscribe(fn) {
        listener = fn
        return () => { listener = undefined }
      },
    }

    const platFetch = createPlatFetch({ channel, interceptBase: 'https://mirror.example.test' })
    await platFetch('https://mirror.example.test/assets/app.js?rev=1')

    expect(sent).toMatchObject({
      method: 'GET',
      path: '/assets/app.js?rev=1',
      requestOrigin: 'https://mirror.example.test',
      interceptOrigin: 'https://mirror.example.test',
    })
    expect(sent.clientOrigin).toBeUndefined()
  })

  it('keeps non-root relative paths relative to the current route base', async () => {
    let sent: any
    let listener: ((message: any) => void | Promise<void>) | undefined
    const channel: ClientSideServerChannel = {
      async send(message) {
        sent = message
        await listener?.({
          jsonrpc: '2.0',
          id: message.id,
          ok: true,
          result: {
            _type: 'http-response',
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            bodyEncoding: 'none',
            body: 'ok',
          },
        })
      },
      subscribe(fn) {
        listener = fn
        return () => { listener = undefined }
      },
    }

    const originalWindow = (globalThis as any).window
    ;(globalThis as any).window = {
      location: {
        href: 'https://www.google.com/maps/',
        origin: 'https://www.google.com',
      },
    }

    try {
      const platFetch = createPlatFetch({ channel })
      await platFetch('tiles/vector.pbf?z=12')
    } finally {
      ;(globalThis as any).window = originalWindow
    }

    expect(sent).toMatchObject({
      method: 'GET',
      path: 'tiles/vector.pbf?z=12',
      requestOrigin: 'https://www.google.com',
      interceptOrigin: 'https://www.google.com/maps',
      clientOrigin: 'https://www.google.com',
    })
  })
})
