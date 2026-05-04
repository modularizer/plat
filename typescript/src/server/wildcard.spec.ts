import { Controller, GET } from '../spec/decorators'
import { createServer } from './server'

const quietLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}

async function startServer(...controllers: Array<new () => any>) {
  const server = createServer({ host: '127.0.0.1', logger: quietLogger as any }, ...controllers)

  await new Promise<void>((resolve) => {
    server.listen(0, resolve)
  })

  const address = (server as any).httpServer?.address()
  if (!address || typeof address !== 'object') {
    throw new Error('Server did not bind to an address')
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

describe('PLATServer wildcard routes', () => {
  it('supports any-method wildcards, preserves exact-route priority, and excludes wildcards from OpenAPI', async () => {
    @Controller()
    class Wildcards {
      async $(input: any, ctx: any) {
        return { kind: 'root', method: ctx.method, path: ctx.url, input }
      }

      @GET()
      async hello$(input: any, ctx: any) {
        return { kind: 'wild-hello', method: ctx.method, path: ctx.url, input }
      }
    }

    @Controller()
    class ExactRoutes {
      @GET()
      async hello() {
        return { kind: 'exact-hello' }
      }
    }

    const { server, baseUrl } = await startServer(Wildcards, ExactRoutes)

    try {
      const exactResponse = await fetch(`${baseUrl}/hello`)
      expect(exactResponse.status).toBe(200)
      await expect(exactResponse.json()).resolves.toEqual({ kind: 'exact-hello' })

      const nestedResponse = await fetch(`${baseUrl}/hello/world`)
      expect(nestedResponse.status).toBe(200)
      await expect(nestedResponse.json()).resolves.toMatchObject({
        kind: 'wild-hello',
        method: 'GET',
        path: '/hello/world',
      })

      const anyMethodResponse = await fetch(`${baseUrl}/anything/goes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      })
      expect(anyMethodResponse.status).toBe(201)
      await expect(anyMethodResponse.json()).resolves.toMatchObject({
        kind: 'root',
        method: 'POST',
        path: '/anything/goes',
        input: { ok: true },
      })

      const openapiResponse = await fetch(`${baseUrl}/openapi.json`)
      const openapi = await openapiResponse.json()
      expect(openapi.paths['/hello']).toBeDefined()
      expect(openapi.paths['/*']).toBeUndefined()
      expect(openapi.paths['/hello/*']).toBeUndefined()
    } finally {
      await server.close()
    }
  })
})
