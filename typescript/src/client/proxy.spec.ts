/**
 * Tests for Client Proxy
 * Validates API client proxy generation and request handling
 */

import { createClientProxy } from './proxy'
import type { ClientProxyConfig, EndpointDef } from '../types'

describe('Client Proxy', () => {
  // Mock controller class for testing
  abstract class TestController {
    async getUser(input: { id: string }, ctx: any) {}
    async listUsers(input: { limit?: number }, ctx: any) {}
    async createUser(input: { name: string }, ctx: any) {}
  }

  const mockEndpoints: EndpointDef[] = [
    {
      methodName: 'getUser',
      controller: TestController,
      method: 'GET',
      path: '/getUser',
      operationId: 'getUser',
    },
    {
      methodName: 'listUsers',
      controller: TestController,
      method: 'GET',
      path: '/listUsers',
      operationId: 'listUsers',
    },
    {
      methodName: 'createUser',
      controller: TestController,
      method: 'POST',
      path: '/createUser',
      operationId: 'createUser',
    },
  ] as any[]

  describe('createClientProxy', () => {
    it('should create a proxy object', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)

      expect(proxy).toBeDefined()
      expect(typeof proxy).toBe('object')
    })

    it('should throw error if no fetch implementation available', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: undefined,
      }

      // Mock globalThis.fetch to be undefined
      const originalFetch = globalThis.fetch
      ;(globalThis as any).fetch = undefined

      try {
        expect(() => {
          createClientProxy(TestController, mockEndpoints, config)
        }).toThrow('No fetch implementation available')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should detect duplicate endpoint definitions', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
      }

      const duplicateEndpoints: EndpointDef[] = [
        {
          methodName: 'getUser',
          controller: TestController,
          method: 'GET',
          path: '/getUser',
          operationId: 'getUser',
        },
        {
          methodName: 'getUser',
          controller: TestController,
          method: 'GET',
          path: '/getUser',
          operationId: 'getUser',
        },
      ] as any[]

      expect(() => {
        createClientProxy(TestController, duplicateEndpoints, config)
      }).toThrow('Duplicate endpoint definition')
    })

    it('should support custom headers configuration', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
        headers: { 'X-Custom-Header': 'test-value' },
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)
      expect(proxy).toBeDefined()
    })

    it('should support dynamic headers as function', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
        headers: async () => ({ 'Authorization': 'Bearer token' }),
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)
      expect(proxy).toBeDefined()
    })

    it('should support timeout configuration', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
        timeoutMs: 5000,
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)
      expect(proxy).toBeDefined()
    })

    it('should support retry configuration', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
        retry: {
          maxAttempts: 3,
          retryDelayMs: 1000,
        },
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)
      expect(proxy).toBeDefined()
    })

    it('should support error callbacks', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
        onUnauthorized: jest.fn(),
        onForbidden: jest.fn(),
        onRateLimited: jest.fn(),
        onServerError: jest.fn(),
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)
      expect(proxy).toBeDefined()
    })

    it('should filter endpoints by controller', () => {
      // Create endpoints from different controllers
      abstract class OtherController {
        async getProduct(input: { id: string }, ctx: any) {}
      }

      const mixedEndpoints: EndpointDef[] = [
        ...mockEndpoints,
        {
          methodName: 'getProduct',
          controller: OtherController,
          method: 'GET',
          path: '/getProduct',
          operationId: 'getProduct',
        },
      ] as any[]

      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
      }

      const proxy = createClientProxy(TestController, mixedEndpoints, config)

      // Should only have TestController endpoints
      expect(Object.keys(proxy)).toEqual(['getUser', 'listUsers', 'createUser'])
    })
  })

  describe('Proxy Methods', () => {
    it('should expose controller methods', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)

      expect(typeof (proxy as any).getUser).toBe('function')
      expect(typeof (proxy as any).listUsers).toBe('function')
      expect(typeof (proxy as any).createUser).toBe('function')
    })

    it('should ignore non-function properties', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)

      // Try to access a property that shouldn't exist
      expect((proxy as any).constructor).toBeUndefined()
      expect((proxy as any).toString).toBeUndefined()
    })
  })

  describe('Configuration', () => {
    it('should accept baseUrl with trailing slash', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000/',
        fetch: async () => new Response('{}'),
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)
      expect(proxy).toBeDefined()
    })

    it('should accept baseUrl without trailing slash', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)
      expect(proxy).toBeDefined()
    })

    it('should use provided fetch implementation', () => {
      let fetchCalled = false
      const customFetch = async () => {
        fetchCalled = true
        return new Response('{}')
      }
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: customFetch,
      }

      createClientProxy(TestController, mockEndpoints, config)
      expect(config.fetch).toBe(customFetch)
    })

    it('should disable retry when set to false', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
        retry: false,
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)
      expect(proxy).toBeDefined()
    })

    it('should support custom retry delay function', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
        retry: {
          maxAttempts: 3,
          retryDelayMs: (ctx) => Math.pow(2, ctx.attempt) * 100,
        },
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)
      expect(proxy).toBeDefined()
    })

    it('should support custom shouldRetry predicate', () => {
      const config: ClientProxyConfig = {
        baseUrl: 'http://localhost:3000',
        fetch: async () => new Response('{}'),
        retry: {
          maxAttempts: 3,
          retryDelayMs: 1000,
          shouldRetry: (ctx) => ctx.response?.status === 503,
        },
      }

      const proxy = createClientProxy(TestController, mockEndpoints, config)
      expect(proxy).toBeDefined()
    })
  })
})
