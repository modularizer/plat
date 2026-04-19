import { createWebRTCProtocolPlugin } from './webrtc-plugin'
import type { ClientSideServerChannel } from '../client-side-server/channel'
import type { ClientSideServerMessage, ClientSideServerRequest } from '../client-side-server/protocol'
import type {
  PLATServerProtocolPlugin,
  PLATServerTransportRuntime,
} from './protocol-plugin'
import type { PLATServerResolvedOperation } from './transports'

jest.mock('../client-side-server/mqtt-webrtc', () => {
  const actual = jest.requireActual('../client-side-server/mqtt-webrtc')
  return {
    ...actual,
    createClientSideServerMQTTWebRTCServer: jest.fn(() => ({
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      connectionUrl: 'css://test',
    })),
  }
})

describe('WebRTC server-side protocol plugin', () => {
  function buildFakeChannel() {
    let listener: ((message: ClientSideServerMessage) => void | Promise<void>) | undefined
    const sent: ClientSideServerMessage[] = []
    const channel: ClientSideServerChannel = {
      async send(message) { sent.push(message) },
      subscribe(fn) { listener = fn; return () => { listener = undefined } },
    }
    const deliver = async (message: ClientSideServerMessage) => { await listener?.(message) }
    return { channel, deliver, sent }
  }

  function buildFakeRuntime(overrides: Partial<PLATServerTransportRuntime> = {}): PLATServerTransportRuntime {
    const dummyOp: PLATServerResolvedOperation = {
      method: 'GET',
      path: '/hello',
      methodName: 'hello',
      boundMethod: async () => ({ msg: 'hi' }),
      controllerTag: 'TestController',
      routeMeta: {},
      controllerMeta: {},
    }
    return {
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
      resolveOperation: () => dummyOp,
      dispatch: async (_op, envelope) => ({
        kind: 'success',
        result: await _op.boundMethod(envelope.input, envelope.ctx),
        statusCode: 200,
      }),
      normalizeInput: (input) => input,
      serializeValue: (v) => v,
      createCallContext: ({ ctx }) => {
        ctx.call = {
          id: '', mode: 'rpc',
          emit: async () => {},
          progress: async () => {},
          log: async () => {},
          chunk: async () => {},
          cancelled: () => false,
        }
        return ctx.call
      },
      createEnvelope: (args) => ({
        protocol: args.protocol,
        method: args.operation.method,
        path: args.operation.path,
        headers: args.headers ?? {},
        input: args.input,
        ctx: args.ctx,
        operationId: args.operation.methodName,
        requestId: args.requestId,
        req: args.req,
        res: args.res,
        allowHelp: !!args.allowHelp,
        helpRequested: !!args.helpRequested,
      }),
      ...overrides,
    }
  }

  function startPlugin(runtime: PLATServerTransportRuntime, infoOverrides: Partial<Parameters<typeof createWebRTCProtocolPlugin>[1]> = {}): PLATServerProtocolPlugin {
    const plugin = createWebRTCProtocolPlugin(
      { name: 'test' },
      {
        getOpenAPISpec: () => ({ openapi: '3.1.0', info: { title: 'x', version: '0' }, paths: {} }),
        getToolsList: () => [{ name: 'hello' }],
        getServerStartedAt: () => 1000,
        ...infoOverrides,
      },
    )
    plugin.setup!(runtime)
    return plugin
  }

  async function connectChannel(plugin: PLATServerProtocolPlugin): Promise<ReturnType<typeof buildFakeChannel>> {
    const captured = buildFakeChannel()
    // Simulate mqtt-webrtc handing us a channel — we tap the mocked factory
    const { createClientSideServerMQTTWebRTCServer } = require('../client-side-server/mqtt-webrtc')
    let handler: any
    ;(createClientSideServerMQTTWebRTCServer as jest.Mock).mockImplementationOnce((opts: any) => {
      handler = opts.server
      return { start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined), connectionUrl: 'css://test' }
    })
    await plugin.start!({} as PLATServerTransportRuntime)
    handler.serveChannel(captured.channel)
    return captured
  }

  it('dispatches a regular operation through the runtime', async () => {
    const runtime = buildFakeRuntime()
    const plugin = startPlugin(runtime)
    const { deliver, sent } = await connectChannel(plugin)

    const req: ClientSideServerRequest = {
      jsonrpc: '2.0',
      id: 'r1',
      method: 'GET',
      path: '/hello',
      input: {},
    }
    await deliver(req)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ jsonrpc: '2.0', id: 'r1', ok: true, result: { msg: 'hi' } })
  })

  it('returns openapi spec for GET /openapi.json', async () => {
    const plugin = startPlugin(buildFakeRuntime())
    const { deliver, sent } = await connectChannel(plugin)
    await deliver({ jsonrpc: '2.0', id: 'o1', method: 'GET', path: '/openapi.json' })
    expect(sent[0]).toMatchObject({ id: 'o1', ok: true, result: { openapi: '3.1.0' } })
  })

  it('returns tools for GET /tools', async () => {
    const plugin = startPlugin(buildFakeRuntime())
    const { deliver, sent } = await connectChannel(plugin)
    await deliver({ jsonrpc: '2.0', id: 't1', method: 'GET', path: '/tools' })
    expect(sent[0]).toMatchObject({ id: 't1', ok: true, result: [{ name: 'hello' }] })
  })

  it('returns 404 for unknown operation', async () => {
    const runtime = buildFakeRuntime({
      resolveOperation: () => undefined,
    })
    const plugin = startPlugin(runtime)
    const { deliver, sent } = await connectChannel(plugin)
    await deliver({ jsonrpc: '2.0', id: 'x1', method: 'POST', path: '/nope' })
    expect(sent[0]).toMatchObject({ id: 'x1', ok: false, error: { status: 404 } })
  })

  it('surfaces handler errors with status', async () => {
    const { HttpError } = require('../types')
    const runtime = buildFakeRuntime({
      dispatch: async () => { throw new HttpError(418, 'teapot') },
    })
    const plugin = startPlugin(runtime)
    const { deliver, sent } = await connectChannel(plugin)
    await deliver({ jsonrpc: '2.0', id: 'e1', method: 'GET', path: '/hello' })
    expect(sent[0]).toMatchObject({ id: 'e1', ok: false, error: { status: 418, message: 'teapot' } })
  })
})
