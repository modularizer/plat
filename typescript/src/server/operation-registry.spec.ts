import { PLATOperationRegistry } from './operation-registry'
import type { PLATServerResolvedOperation } from './transports'

function op(partial: Partial<PLATServerResolvedOperation> & Pick<PLATServerResolvedOperation, 'method' | 'path' | 'methodName'>): PLATServerResolvedOperation {
  return {
    boundMethod: async () => undefined,
    controllerTag: 'TestController',
    routeMeta: {},
    controllerMeta: {},
    ...partial,
  }
}

describe('PLATOperationRegistry wildcard resolution', () => {
  it('prefers exact routes over wildcard matches', () => {
    const registry = new PLATOperationRegistry()
    const wildcard = op({ method: '*', path: '/hello', methodName: 'hello$', isWildcard: true })
    const exact = op({ method: 'GET', path: '/hello', methodName: 'hello' })

    registry.register(wildcard)
    registry.register(exact)

    expect(registry.resolve({ method: 'GET', path: '/hello' })?.methodName).toBe('hello')
    expect(registry.resolve({ method: 'GET', path: '/hello/world' })?.methodName).toBe('hello$')
  })

  it('prefers the longest wildcard prefix', () => {
    const registry = new PLATOperationRegistry()
    registry.register(op({ method: '*', path: '/api', methodName: 'api$', isWildcard: true }))
    registry.register(op({ method: '*', path: '/api/admin', methodName: 'apiAdmin$', isWildcard: true }))

    expect(registry.resolve({ method: 'POST', path: '/api/admin/users' })?.methodName).toBe('apiAdmin$')
    expect(registry.resolve({ method: 'POST', path: '/api/public' })?.methodName).toBe('api$')
  })

  it('respects method-specific wildcards and operationId lookup', () => {
    const registry = new PLATOperationRegistry()
    registry.register(op({ method: 'GET', path: '/docs', methodName: 'docs$', isWildcard: true }))

    expect(registry.resolve({ method: 'GET', path: '/docs/guide' })?.methodName).toBe('docs$')
    expect(registry.resolve({ method: 'POST', path: '/docs/guide' })).toBeUndefined()
    expect(registry.resolve({ operationId: 'docs$', method: 'POST', path: '/nope' })?.methodName).toBe('docs$')
  })
})
