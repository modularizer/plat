import { runCliCore, type CliOptions } from './core'

const spec = {
    info: { title: 'Demo' },
    paths: {
        '/runSql': { post: { operationId: 'runSql', requestBody: { content: { 'application/json': { schema: { properties: { datasource: {}, query: {} }, required: ['query'] } } } } } },
        '/listViews': { post: { operationId: 'listViews' } },
    },
}

function harness(extra: Partial<CliOptions> = {}) {
    const out: string[] = []
    const err: string[] = []
    const calls: Array<[string, Record<string, any>]> = []
    const options: CliOptions = {
        spec,
        call: async (command, input) => {
            calls.push([command.name, input])
            return { rows: [{ n: 1 }] }
        },
        io: {
            log: (t) => out.push(t),
            error: (t) => err.push(t),
            exit: ((code: number) => {
                out.push(`exit ${code}`)
                return undefined as never
            }),
        },
        ...extra,
    }
    return { out, err, calls, run: (...argv: string[]) => runCliCore(options, argv) }
}

describe('runCliCore extension points', () => {
    it('fills positional params from bare words', async () => {
        const h = harness({ positional: { runSql: ['datasource', 'query'] } })
        await h.run('run', 'sql', 'shop', 'select 1')
        expect(h.calls).toEqual([['runSql', { datasource: 'shop', query: 'select 1' }]])
    })

    it('explicit flags beat positional words', async () => {
        const h = harness({ positional: { runSql: ['datasource', 'query'] } })
        await h.run('run-sql', '--datasource=a', 'b', 'q')
        expect(h.calls[0]![1]).toEqual({ datasource: 'a', query: 'q' })
    })

    it('runs CLI-only commands before spec methods, including multi-word keys', async () => {
        const seen: string[] = []
        const h = harness({
            commands: {
                host: (ctx) => { seen.push(...ctx.argv) },
                listViews: () => 'shadowed',
            },
        })
        await h.run('host', 'add', 'prod')
        await h.run('list', 'views')
        expect(seen).toEqual(['add', 'prod'])
        expect(h.calls).toEqual([])
        expect(h.out).toEqual(['"shadowed"'])
    })

    it('prints a custom command return value in the chosen format', async () => {
        const h = harness({ commands: { who: () => ({ a: 1 }) } })
        await h.run('who', '--format=yaml')
        expect(h.out).toEqual(['a: 1'])
    })

    it('lets an override wrap the normal call', async () => {
        const h = harness({
            overrides: { runSql: async (ctx, next) => ({ wrapped: await next({ ...ctx.input, query: 'select 2' }) }) },
        })
        await h.run('runSql', '--query=select 1')
        expect(h.calls).toEqual([['runSql', { query: 'select 2' }]])
        expect(JSON.parse(h.out[0]!)).toEqual({ wrapped: { rows: [{ n: 1 }] } })
    })

    it('lets an override replace the call entirely', async () => {
        const h = harness({ overrides: { listViews: () => 'local only' } })
        await h.run('listViews')
        expect(h.calls).toEqual([])
        expect(h.out).toEqual(['"local only"'])
    })

    it('runs beforeCall and afterCall', async () => {
        const h = harness({
            beforeCall: (ctx) => { ctx.input.limit = 10 },
            afterCall: (result: any) => result.rows,
        })
        await h.run('listViews')
        expect(h.calls).toEqual([['listViews', { limit: 10 }]])
        expect(JSON.parse(h.out[0]!)).toEqual([{ n: 1 }])
    })

    it('accepts an async spec source (server discovery)', async () => {
        const h = harness({ spec: async () => spec })
        await h.run('listViews')
        expect(h.calls).toHaveLength(1)
    })

    it('hands unknown commands to onUnknown and stops if handled', async () => {
        let seen: unknown
        const h = harness({ onUnknown: (info) => { seen = info.reason; return true } })
        await h.run('nope')
        expect(seen).toBe('unknown')
        expect(h.err).toEqual([])
    })

    it('reports unknown commands when onUnknown declines', async () => {
        const h = harness({ onUnknown: () => false })
        await h.run('nope')
        expect(h.err[0]).toMatch(/Unknown command: nope/)
        expect(h.out).toContain('exit 1')
    })

    it('routes errors through onError', async () => {
        const caught: string[] = []
        const h = harness({
            call: async () => { throw new Error('boom') },
            onError: (e) => { caught.push((e as Error).message) },
        })
        await h.run('listViews')
        expect(caught).toEqual(['boom'])
    })

    it('supports custom formatters and a default format', async () => {
        const h = harness({ formatters: { rows: (d: any) => `${d.rows.length} rows` }, defaultFormat: 'rows' })
        await h.run('listViews')
        expect(h.out).toEqual(['1 rows'])
    })

    it('replaces help', async () => {
        const h = harness({ help: (commands) => `custom: ${commands.map((c) => c.name).join(',')}` })
        await h.run('--help')
        expect(h.out[0]).toBe('custom: runSql,listViews')
    })

    it('default help lists custom commands and spec methods', async () => {
        const h = harness({ commands: { host: () => undefined } })
        await h.run('help')
        expect(h.out[0]).toMatch(/Demo CLI[\s\S]*host[\s\S]*runSql/)
    })

    it('lets parseArgs and resolveName be replaced', async () => {
        const h = harness({
            parseArgs: () => ({ input: { fixed: true }, format: '', words: [] }),
            resolveName: () => ({ ok: true, name: 'listViews', consumed: 1 }),
        })
        await h.run('anything', '--x=1')
        expect(h.calls).toEqual([['listViews', { fixed: true }]])
    })

    it('never loads the spec for a CLI-only command', async () => {
        const spec = jest.fn(async () => { throw new Error('server down') })
        const h = harness({ spec, commands: { host: () => 'ok' } })
        await h.run('host', 'ls')
        expect(spec).not.toHaveBeenCalled()
        expect(h.out).toEqual(['"ok"'])
    })

    it('does not let a stitched spec method steal a custom command', async () => {
        const h = harness({
            spec: { paths: { '/describeRelation': { post: { operationId: 'describeRelation' } } } },
            commands: { describe: (ctx) => ctx.argv.join(' ') },
        })
        await h.run('describe', 'relation', 'x')
        expect(h.calls).toEqual([])
        expect(h.out).toEqual(['"relation x"'])
    })

    it('wraps every spec call with around', async () => {
        const order: string[] = []
        const h = harness({
            around: async (ctx, next) => { order.push(`in:${ctx.name}`); const r = await next({ ...ctx.input, safe: true }); order.push('out'); return r },
            overrides: { listViews: async (_ctx, next) => { order.push('override'); return next() } },
        })
        await h.run('listViews')
        expect(order).toEqual(['in:listViews', 'override', 'out'])
        expect(h.calls).toEqual([['listViews', { safe: true }]])
    })

    it('lets a custom help command take over help, --help and -h', async () => {
        const seen: string[][] = []
        const h = harness({ commands: { help: (ctx) => { seen.push([...ctx.argv]) } } })
        await h.run('help', 'listViews')
        await h.run('--help')
        await h.run('-h')
        await h.run()
        expect(seen).toEqual([['listViews'], [], [], []])
    })
})
