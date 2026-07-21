import { OpenAPIClient } from './openapi-client'

const BASE_URL = 'http://localhost:3000'

const SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Test API',
    version: '1.0.0',
  },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {},
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createItem',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
                required: ['name'],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {},
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deleteItem',
        parameters: [
          {
            name: 'id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {},
                },
              },
            },
          },
        },
      },
    },
  },
} as const

describe('OpenAPIClient', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('does not attach a fetch body for GET requests', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }))
    globalThis.fetch = fetchMock as typeof fetch

    const client = new OpenAPIClient(SPEC, { baseUrl: BASE_URL })
    await client.get('/items', { id: '123', extra: 'ignored-body-field' } as any)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/items?id=123`)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
    })
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body')
  })

  it('does not attach a fetch body for DELETE requests', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }))
    globalThis.fetch = fetchMock as typeof fetch

    const client = new OpenAPIClient(SPEC, { baseUrl: BASE_URL })
    await client.delete('/items', { id: '123', extra: 'ignored-body-field' } as any)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/items?id=123`)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
    })
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body')
  })

  it('still attaches a body for POST requests', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }))
    globalThis.fetch = fetchMock as typeof fetch

    const client = new OpenAPIClient(SPEC, { baseUrl: BASE_URL })
    await client.post('/items', { name: 'widget' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE_URL}/items`)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'widget' }),
    })
  })

  it('does not emit debug console output during ordinary requests', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }))
    globalThis.fetch = fetchMock as typeof fetch
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})

    const client = new OpenAPIClient(SPEC, { baseUrl: BASE_URL })
    await client.get('/items', { id: '123' })

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(debugSpy).not.toHaveBeenCalled()
  })
})
