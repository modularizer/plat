const post = jest.fn(async () => ({ ok: true }))

jest.mock('../client/openapi-client', () => ({
    OpenAPIClient: jest.fn().mockImplementation(() => ({ post })),
}))
jest.mock('../client-side-server/mqtt-webrtc', () => ({
    createClientSideServerMQTTWebRTCTransportPlugin: jest.fn(),
}))

import { runCli } from './runtime'

const spec = {
    servers: [{ url: 'http://localhost:1' }],
    paths: {
        '/runCloneFeed': {
            post: {
                operationId: 'runCloneFeed',
                requestBody: { content: { 'application/json': { schema: { properties: { name: {} } } } } },
            },
        },
    },
}

describe('runCli command names', () => {
    beforeEach(() => {
        post.mockClear()
        jest.spyOn(console, 'log').mockImplementation(() => undefined)
    })

    it.each([
        [['runCloneFeed']],
        [['run-clone-feed']],
        [['run_clone_feed']],
        [['run', 'clone', 'feed']],
    ])('calls the same operation for %j', async (words) => {
        await runCli(spec, [...words, '--name=x'])
        expect(post).toHaveBeenCalledWith('/runCloneFeed', { name: 'x' })
    })

    it('exits on an unknown command', async () => {
        const exit = jest.spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('exit')
        }) as never)
        jest.spyOn(console, 'error').mockImplementation(() => undefined)
        await expect(runCli(spec, ['run', 'nothing'])).rejects.toThrow('exit')
        expect(exit).toHaveBeenCalledWith(1)
    })
})
