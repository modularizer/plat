/**
 * Tests for Parameter Aliasing
 * Validates parameter name normalization and aliasing behavior
 */

import { normalizeParameters, getKnownAliases, isAliasedParameter, getCanonicalName } from './param-aliases'

describe('Parameter Aliases', () => {
  describe('normalizeParameters', () => {
    it('should apply simple aliases from default configuration', () => {
      const params = { id: '123', query: 'search term' }
      const result = normalizeParameters(params)

      expect(result).toEqual({
        id: '123',
        q: 'search term',
      })
    })

    it('should handle custom paramCoercions', () => {
      const params = { userId: 'user1', action: 'delete' }
      const coercions = { userId: 'id', action: 'op' }
      const result = normalizeParameters(params, coercions)

      expect(result).toEqual({
        id: 'user1',
        op: 'delete',
      })
    })

    it('should not override existing canonical parameters', () => {
      const params = { q: 'existing', query: 'new' }
      const result = normalizeParameters(params)

      expect(result).toEqual({
        q: 'existing', // Original q value preserved
      })
    })

    it('should convert page/pageSize to limit/offset', () => {
      const params = { page: 2, pageSize: 50 }
      const result = normalizeParameters(params)

      expect(result).toEqual({
        limit: 50,
        offset: 50, // (2-1)*50
      })
    })

    it('should use default values for page/pageSize conversion', () => {
      const params = { page: 3 }
      const result = normalizeParameters(params)

      expect(result).toEqual({
        limit: 10, // default pageSize
        offset: 20, // (3-1)*10
      })
    })

    it('should respect existing limit/offset and not override them', () => {
      const params = { page: 2, pageSize: 50, limit: 100, offset: 200 }
      const result = normalizeParameters(params)

      expect(result).toEqual({
        limit: 100, // Existing limit preserved
        offset: 200, // Existing offset preserved
      })
    })

    it('should handle multiple aliases', () => {
      const params = { query: 'q1', search: 'q2', format: 'json' }
      const result = normalizeParameters(params)

      // Both query and search map to q, query wins (first in the coercions)
      expect(result.q).toBeDefined()
      expect(result.fmt).toBe('json')
      expect(result.query).toBeUndefined()
      expect(result.search).toBeUndefined()
    })

    it('should throw error for disallowed parameters', () => {
      const params = { id: '123', search: 'forbidden' }
      const disAllowed = ['search', 'filter']

      expect(() => {
        normalizeParameters(params, undefined, disAllowed)
      }).toThrow('disallowed')

      expect(() => {
        normalizeParameters(params, undefined, disAllowed)
      }).toThrow('search')
    })

    it('should check disallowed parameters before aliasing', () => {
      const params = { id: '123', query: 'allowed' }
      const coercions = { query: 'q' }
      const disAllowed = ['query'] // Forbid 'query' but 'q' is fine

      expect(() => {
        normalizeParameters(params, coercions, disAllowed)
      }).toThrow('disallowed')
    })

    it('should handle null/undefined params gracefully', () => {
      expect(normalizeParameters(null as any)).toEqual(null)
      expect(normalizeParameters(undefined as any)).toEqual(undefined)
    })

    it('should not modify params with no aliases', () => {
      const params = { id: '123', name: 'John', age: 30 }
      const result = normalizeParameters(params)

      expect(result).toEqual(params)
    })
  })

  describe('getKnownAliases', () => {
    it('should return mapping of all known aliases', () => {
      const aliases = getKnownAliases()

      expect(aliases).toBeDefined()
      expect(aliases.query).toBe('q')
      expect(aliases.search).toBe('q')
      expect(aliases.format).toBe('fmt')
      expect(aliases.page).toBeDefined()
      expect(aliases.pageSize).toBeDefined()
    })
  })

  describe('isAliasedParameter', () => {
    it('should identify aliased parameters', () => {
      expect(isAliasedParameter('query')).toBe(true)
      expect(isAliasedParameter('search')).toBe(true)
      expect(isAliasedParameter('format')).toBe(true)
      expect(isAliasedParameter('page')).toBe(true)
      expect(isAliasedParameter('pageSize')).toBe(true)
    })

    it('should return false for non-aliased parameters', () => {
      expect(isAliasedParameter('id')).toBe(false)
      expect(isAliasedParameter('name')).toBe(false)
      expect(isAliasedParameter('q')).toBe(false)
    })
  })

  describe('getCanonicalName', () => {
    it('should return canonical name for aliased parameters', () => {
      expect(getCanonicalName('query')).toBe('q')
      expect(getCanonicalName('search')).toBe('q')
      expect(getCanonicalName('format')).toBe('fmt')
      expect(getCanonicalName('page')).toBe('offset')
      expect(getCanonicalName('pageSize')).toBe('limit')
    })

    it('should return null for non-aliased parameters', () => {
      expect(getCanonicalName('id')).toBeNull()
      expect(getCanonicalName('name')).toBeNull()
    })
  })
})
