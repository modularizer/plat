/**
 * Tests for Request Builder
 * Validates HTTP request construction following plat conventions:
 * - Flat routes: method name IS the route (no path params)
 * - All input as a single object (query for GET/DELETE, body for POST/PUT)
 */

import { buildRequest, getPathParamNames } from './request-builder'
import type { EndpointDef } from '../types'
import { z } from 'zod'

const dummySchema = z.object({})

function makeEndpoint(overrides: Partial<EndpointDef> & Pick<EndpointDef, 'methodName' | 'httpMethod'>): EndpointDef {
  const name = overrides.methodName
  return {
    controller: {} as any,
    controllerName: overrides.controllerName ?? 'Api',
    basePath: '',
    routePath: `/${name}`,
    fullPath: `/${name}`,
    inputSchema: dummySchema,
    outputSchema: dummySchema,
    ...overrides,
  }
}

const BASE_URL = 'http://localhost:3000'

describe('Request Builder', () => {
  describe('getPathParamNames', () => {
    it('should return empty array for flat plat routes', () => {
      expect(getPathParamNames('/getOrder')).toEqual([])
      expect(getPathParamNames('/listProducts')).toEqual([])
      expect(getPathParamNames('/createUser')).toEqual([])
    })

    it('should extract param names if path has them', () => {
      expect(getPathParamNames('/get/:id')).toEqual(['id'])
    })
  })

  describe('buildRequest for GET', () => {
    const endpoint = makeEndpoint({
      methodName: 'getOrder',
      controllerName: 'Orders',
      httpMethod: 'GET',
    })

    it('should build GET with all input as query params', () => {
      const request = buildRequest(endpoint, { id: '123' }, BASE_URL)

      expect(request.url).toBe(`${BASE_URL}/getOrder?id=123`)
      expect((request.headers as Record<string, string>).accept).toBe('application/json')
      expect(request.body).toBeUndefined()
    })

    it('should handle multiple query parameters', () => {
      const request = buildRequest(endpoint, { id: '123', limit: '10', offset: '20' }, BASE_URL)

      expect(request.url).toContain('/getOrder?')
      expect(request.url).toContain('id=123')
      expect(request.url).toContain('limit=10')
      expect(request.url).toContain('offset=20')
    })

    it('should skip undefined values in query parameters', () => {
      const request = buildRequest(endpoint, { id: '123', filter: undefined }, BASE_URL)

      expect(request.url).toContain('id=123')
      expect(request.url).not.toContain('filter')
    })

    it('should encode special characters in query values', () => {
      const request = buildRequest(endpoint, { q: 'hello world' }, BASE_URL)

      expect(request.url).toContain('hello+world')
    })
  })

  describe('buildRequest for POST', () => {
    const endpoint = makeEndpoint({
      methodName: 'createOrder',
      controllerName: 'Orders',
      httpMethod: 'POST',
    })

    it('should build POST with all input as JSON body', () => {
      const input = { userId: 'user1', items: [{ productId: '1', quantity: 2 }] }
      const request = buildRequest(endpoint, input, BASE_URL)

      expect(request.url).toBe(`${BASE_URL}/createOrder`)
      expect(request.body).toBe(JSON.stringify(input))
      expect((request.headers as Record<string, string>)['content-type']).toBe('application/json')
    })

    it('should set correct headers for POST', () => {
      const request = buildRequest(endpoint, { name: 'Widget' }, BASE_URL)
      const headers = request.headers as Record<string, string>

      expect(headers.accept).toBe('application/json')
      expect(headers['content-type']).toBe('application/json')
    })

    it('should handle nested objects in body', () => {
      const input = {
        user: { name: 'Alice', role: 'admin' },
        tags: ['urgent', 'new'],
      }
      const request = buildRequest(endpoint, input, BASE_URL)

      const parsed = JSON.parse(request.body!)
      expect(parsed.user.name).toBe('Alice')
      expect(parsed.tags).toEqual(['urgent', 'new'])
    })

    it('should strip undefined values from body', () => {
      const input = { name: 'Widget', description: undefined }
      const request = buildRequest(endpoint, input, BASE_URL)

      const parsed = JSON.parse(request.body!)
      expect(parsed).toEqual({ name: 'Widget' })
      expect(parsed.description).toBeUndefined()
    })
  })

  describe('buildRequest for PUT', () => {
    const endpoint = makeEndpoint({
      methodName: 'updateOrder',
      controllerName: 'Orders',
      httpMethod: 'PUT',
    })

    it('should build PUT with JSON body', () => {
      const input = { id: '123', status: 'shipped' }
      const request = buildRequest(endpoint, input, BASE_URL)

      expect(request.url).toBe(`${BASE_URL}/updateOrder`)
      expect(JSON.parse(request.body!)).toEqual(input)
    })
  })

  describe('buildRequest for DELETE', () => {
    const endpoint = makeEndpoint({
      methodName: 'deleteOrder',
      controllerName: 'Orders',
      httpMethod: 'DELETE',
    })

    it('should build DELETE with query params', () => {
      const request = buildRequest(endpoint, { id: '123' }, BASE_URL)

      expect(request.url).toBe(`${BASE_URL}/deleteOrder?id=123`)
      expect((request.headers as Record<string, string>).accept).toBe('application/json')
      expect(request.body).toBeUndefined()
    })
  })

  describe('Base URL handling', () => {
    const endpoint = makeEndpoint({
      methodName: 'listOrders',
      controllerName: 'Orders',
      httpMethod: 'GET',
    })

    it('should handle base URL with trailing slash', () => {
      const request = buildRequest(endpoint, {}, `${BASE_URL}/`)
      expect(request.url).toBe(`${BASE_URL}/listOrders`)
    })

    it('should handle base URL without trailing slash', () => {
      const request = buildRequest(endpoint, {}, BASE_URL)
      expect(request.url).toBe(`${BASE_URL}/listOrders`)
    })

    it('should handle https', () => {
      const request = buildRequest(endpoint, {}, BASE_URL)
      expect(request.url).toContain(`${BASE_URL}/listOrders`)
    })
  })

  describe('Edge cases', () => {
    it('should handle null values in POST body', () => {
      const endpoint = makeEndpoint({
        methodName: 'updateUser',
        controllerName: 'Users',
        httpMethod: 'POST',
      })

      const input = { name: 'Alice', nickname: null, email: 'alice@example.com' }
      const request = buildRequest(endpoint, input, BASE_URL)

      const parsed = JSON.parse(request.body!)
      expect(parsed.name).toBe('Alice')
      expect(parsed.nickname).toBeNull()
      expect(parsed.email).toBe('alice@example.com')
    })

    it('should handle empty input for GET', () => {
      const endpoint = makeEndpoint({
        methodName: 'listOrders',
        controllerName: 'Orders',
        httpMethod: 'GET',
      })

      const request = buildRequest(endpoint, {}, BASE_URL)
      expect(request.url).toBe(`${BASE_URL}/listOrders`)
    })
  })
})
