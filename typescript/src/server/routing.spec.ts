/**
 * Tests for Route Variant Generation
 * Validates case-insensitive and flexible HTTP method handling
 */

import { getCaseVariants, getFlexibleMethods, generateRouteVariants } from './routing'

describe('Route Variants', () => {
  describe('getCaseVariants', () => {
    it('should generate camelCase variant', () => {
      const variants = getCaseVariants('getUser')

      expect(variants).toContain('getUser') // Original
    })

    it('should generate snake_case variant', () => {
      const variants = getCaseVariants('getUser')

      expect(variants).toContain('get_user')
    })

    it('should generate kebab-case variant', () => {
      const variants = getCaseVariants('getUser')

      expect(variants).toContain('get-user')
    })

    it('should handle single word method names', () => {
      const variants = getCaseVariants('search')

      expect(variants).toContain('search')
      expect(variants.length).toBeGreaterThan(0)
    })

    it('should handle multiple camelCase words', () => {
      const variants = getCaseVariants('getUserOrderHistory')

      expect(variants).toContain('getUserOrderHistory')
      expect(variants).toContain('get_user_order_history')
      expect(variants).toContain('get-user-order-history')
    })
  })

  describe('getFlexibleMethods', () => {
    it('should allow GET to also accept POST', () => {
      const methods = getFlexibleMethods('GET')

      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
    })

    it('should allow POST to also accept GET', () => {
      const methods = getFlexibleMethods('POST')

      expect(methods).toContain('POST')
      expect(methods).toContain('GET')
    })

    it('should allow PUT to also accept PATCH', () => {
      const methods = getFlexibleMethods('PUT')

      expect(methods).toContain('PUT')
      expect(methods).toContain('PATCH')
    })

    it('should handle PATCH method', () => {
      const methods = getFlexibleMethods('PATCH')

      expect(methods).toContain('PATCH')
      // PATCH flexibility may vary by implementation
      expect(methods.length).toBeGreaterThan(0)
    })

    it('should return array with only the method for non-flexible methods', () => {
      const methods = getFlexibleMethods('DELETE')

      expect(methods).toContain('DELETE')
      // DELETE doesn't have a flexible alternative
    })

    it('should return method in uppercase', () => {
      const methods = getFlexibleMethods('get')

      expect(methods.every(m => m === m.toUpperCase())).toBe(true)
    })
  })

  describe('generateRouteVariants', () => {
    it('should generate variants combining case and methods', () => {
      const variants = generateRouteVariants('getUser', 'GET')

      expect(variants.length).toBeGreaterThan(1)
      expect(variants).toContainEqual({ path: '/getUser', method: 'GET' })
    })

    it('should include snake_case variants', () => {
      const variants = generateRouteVariants('getUser', 'GET')

      const snakeCase = variants.find(v => v.path === '/get_user')
      expect(snakeCase).toBeDefined()
    })

    it('should include kebab-case variants', () => {
      const variants = generateRouteVariants('getUser', 'GET')

      const kebabCase = variants.find(v => v.path === '/get-user')
      expect(kebabCase).toBeDefined()
    })

    it('should include flexible HTTP methods', () => {
      const variants = generateRouteVariants('getUser', 'GET')

      const post = variants.find(v => v.method === 'POST')
      expect(post).toBeDefined() // GET is flexible with POST
    })

    it('should include all combinations', () => {
      const variants = generateRouteVariants('getUser', 'GET')

      // Should have at least 3 path variants × 2 methods = 6 combinations
      expect(variants.length).toBeGreaterThanOrEqual(6)

      // Verify diversity
      const pathCount = new Set(variants.map(v => v.path)).size
      const methodCount = new Set(variants.map(v => v.method)).size

      expect(pathCount).toBeGreaterThan(1)
      expect(methodCount).toBeGreaterThan(1)
    })

    it('should not include canonical route twice', () => {
      const variants = generateRouteVariants('getUser', 'GET')

      const canonical = variants.filter(v => v.path === '/getUser' && v.method === 'GET')
      expect(canonical.length).toBe(1)
    })

    it('should handle DELETE method (non-flexible)', () => {
      const variants = generateRouteVariants('deleteItem', 'DELETE')

      const allDelete = variants.every(v => v.method === 'DELETE' || v.method === 'POST')
      expect(allDelete).toBe(true)
    })

    it('should handle PUT method (flexible with PATCH)', () => {
      const variants = generateRouteVariants('updateItem', 'PUT')

      const hasPatch = variants.some(v => v.method === 'PATCH')
      expect(hasPatch).toBe(true)
    })
  })

  describe('Silent Resilience', () => {
    it('should provide case-insensitive routing silently', () => {
      const variants = generateRouteVariants('getUser', 'GET')

      // Client can use any case variant and get the same result
      const camelCase = variants.find(v => v.path === '/getUser')
      const snakeCase = variants.find(v => v.path === '/get_user')
      const kebabCase = variants.find(v => v.path === '/get-user')

      expect(camelCase).toBeDefined()
      expect(snakeCase).toBeDefined()
      expect(kebabCase).toBeDefined()
    })

    it('should allow HTTP method flexibility silently', () => {
      const variants = generateRouteVariants('getUser', 'GET')

      // Client can use POST instead of GET and still works
      const getMethod = variants.find(v => v.path === '/getUser' && v.method === 'GET')
      const postMethod = variants.find(v => v.path === '/getUser' && v.method === 'POST')

      expect(getMethod).toBeDefined()
      expect(postMethod).toBeDefined()
    })
  })
})
