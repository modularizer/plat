import { createClientSideServerTransportPlugin } from './css-transport-plugin'
import type { ClientSideServerChannel } from '../client-side-server/channel'

describe('createClientSideServerTransportPlugin', () => {
  const originalWindow = (globalThis as any).window

  beforeEach(() => {
    ;(globalThis as any).window = {
      location: {
        href: 'http://localhost:6005/view',
        origin: 'http://localhost:6005',
      },
    }
  })

  afterEach(() => {
    ;(globalThis as any).window = originalWindow
  })

  it('includes origin metadata on outbound css rpc requests', async () => {
    let sent: any
    let listener: ((message: any) => void | Promise<void>) | undefined
    const channel: ClientSideServerChannel = {
      async send(message) {
        sent = message
        await listener?.({
          jsonrpc: '2.0',
          id: message.id,
          ok: true,
          result: { ok: true },
        })
      },
      subscribe(fn) {
        listener = fn
        return () => { listener = undefined }
      },
    }

    const plugin = createClientSideServerTransportPlugin({
      connect: () => channel,
    })
    const connection = await plugin.connect!({
      id: 'req-1',
      baseUrl: 'css://dmz/mirror-test',
      transportMode: 'css',
      method: 'GET',
      path: '/resource',
      url: 'http://localhost:6005/resource',
      params: {},
      headers: {},
      requestContext: {},
    } as any)

    await plugin.sendRequest(connection, {
      id: 'req-1',
      baseUrl: 'css://dmz/mirror-test',
      transportMode: 'css',
      method: 'GET',
      path: '/resource',
      url: 'http://localhost:6005/resource',
      params: {},
      headers: {},
      requestContext: {},
    } as any)

    expect(sent).toMatchObject({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'GET',
      path: '/resource',
      clientOrigin: 'http://localhost:6005',
      requestOrigin: 'http://localhost:6005',
      interceptOrigin: 'http://localhost:6005',
    })
  })
})
