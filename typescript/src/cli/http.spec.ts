import { httpCall, runHttpCli } from './http'

const spec = {
    paths: {
        '/items/{id}': { get: { operationId: 'getItem' } },
        '/addItem': { post: { operationId: 'addItem' } },
    },
}

function fakeFetch(seen: Array<{ url: string; init?: RequestInit }>): typeof fetch {
    return (async (url: any, init?: RequestInit) => {
        seen.push({ url: String(url), init })
        if (String(url).endsWith('/openapi.json')) return new Response(JSON.stringify(spec))
        return new Response(JSON.stringify({ ok: true }))
    }) as typeof fetch
}

describe('httpCall', () => {
    it('substitutes path params and sends the rest as a query string for GET', async () => {
        const seen: any[] = []
        const call = httpCall({ baseUrl: 'http://h', fetch: fakeFetch(seen) })
        await call({ name: 'getItem', method: 'GET', path: '/items/{id}', params: [] }, { id: 'a b', limit: 2 }, {} as any)
        expect(seen[0].url).toBe('http://h/items/a%20b?limit=2')
    })

    it('sends JSON for POST with headers', async () => {
        const seen: any[] = []
        const call = httpCall({ baseUrl: 'http://h', headers: { authorization: 'Bearer t' }, fetch: fakeFetch(seen) })
        await call({ name: 'addItem', method: 'POST', path: '/addItem', params: [] }, { n: 1 }, {} as any)
        expect(seen[0].init.body).toBe('{"n":1}')
        expect(seen[0].init.headers.authorization).toBe('Bearer t')
    })

    it('surfaces HTTP errors', async () => {
        const call = httpCall({ baseUrl: 'http://h', fetch: (async () => new Response('nope', { status: 500 })) as typeof fetch })
        await expect(call({ name: 'x', method: 'POST', path: '/x', params: [] }, {}, {} as any)).rejects.toThrow('HTTP 500 nope')
    })
})

describe('runHttpCli', () => {
    it('loads /openapi.json and resolves any spelling', async () => {
        const seen: any[] = []
        const out: string[] = []
        await runHttpCli(
            { baseUrl: 'http://h', fetch: fakeFetch(seen), io: { log: (t) => out.push(t) } },
            ['add', 'item', '--n=1'],
        )
        expect(seen.map((s) => s.url)).toEqual(['http://h/openapi.json', 'http://h/addItem'])
        expect(JSON.parse(out[0]!)).toEqual({ ok: true })
    })
})
