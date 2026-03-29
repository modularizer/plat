/**
 * Tests for Decorator System
 * Validates @Controller, @GET, @POST, etc. decorators
 */

import { Controller, GET, POST, PUT, DELETE, PATCH } from './decorators'
import { getControllerMeta } from './metadata'
import { z } from 'zod'

describe('Decorators', () => {
  describe('@Controller', () => {
    it('should mark a class as a controller', () => {
      @Controller()
      class TestController {}

      const meta = getControllerMeta(TestController)
      expect(meta).toBeDefined()
    })

    it('should accept a controller name', () => {
      @Controller('users')
      class UserController {}

      const meta = getControllerMeta(UserController)
      expect(meta?.tag).toBe('users')
    })

    it('should accept name and options', () => {
      @Controller('users', { tag: 'users' })
      class UserController {}

      const meta = getControllerMeta(UserController)
      expect(meta?.tag).toBe('users')
    })

    it('should support auth configuration in options', () => {
      @Controller('protected', { auth: 'jwt' })
      class ProtectedController {}

      const meta = getControllerMeta(ProtectedController)
      expect(meta?.auth).toBe('jwt')
    })

    it('should support rateLimit configuration in options', () => {
      @Controller('limited', { rateLimit: { key: 'global', cost: 1 } as any })
      class LimitedController {}

      const meta = getControllerMeta(LimitedController)
      expect(meta?.rateLimit).toBeDefined()
    })
  })

  describe('HTTP Method Decorators', () => {
    it('@GET should mark method as GET endpoint', () => {
      @Controller()
      class TestController {
        @GET()
        async getItem(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(TestController)
      const getItemMeta = meta?.routes.get('getItem')

      expect(getItemMeta?.method).toBe('GET')
    })

    it('@POST should mark method as POST endpoint', () => {
      @Controller()
      class TestController {
        @POST()
        async createItem(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(TestController)
      const createItemMeta = meta?.routes.get('createItem')

      expect(createItemMeta?.method).toBe('POST')
    })

    it('@PUT should mark method as PUT endpoint', () => {
      @Controller()
      class TestController {
        @PUT()
        async updateItem(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(TestController)
      const updateItemMeta = meta?.routes.get('updateItem')

      expect(updateItemMeta?.method).toBe('PUT')
    })

    it('@DELETE should mark method as DELETE endpoint', () => {
      @Controller()
      class TestController {
        @DELETE()
        async deleteItem(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(TestController)
      const deleteItemMeta = meta?.routes.get('deleteItem')

      expect(deleteItemMeta?.method).toBe('DELETE')
    })

    it('@PATCH should mark method as PATCH endpoint', () => {
      @Controller()
      class TestController {
        @PATCH()
        async partialUpdateItem(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(TestController)
      const patchMeta = meta?.routes.get('partialUpdateItem')

      expect(patchMeta?.method).toBe('PATCH')
    })
  })

  describe('Route Options', () => {
    it('should accept auth option on route', () => {
      @Controller()
      class TestController {
        @GET({ auth: 'jwt' })
        async getProtectedItem(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(TestController)
      const routeMeta = meta?.routes.get('getProtectedItem')

      expect(routeMeta?.auth).toBe('jwt')
    })

    it('should accept rateLimit option on route', () => {
      @Controller()
      class TestController {
        @GET({ rateLimit: { key: 'global', cost: 1 } })
        async getLimitedItem(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(TestController)
      const routeMeta = meta?.routes.get('getLimitedItem')

      expect(routeMeta?.rateLimit).toBeDefined()
    })

    it('should accept tokenLimit option on route', () => {
      @Controller()
      class TestController {
        @POST({ tokenLimit: { key: 'llm', callCost: 100 } })
        async summarizeText(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(TestController)
      const routeMeta = meta?.routes.get('summarizeText')

      expect(routeMeta?.tokenLimit).toBeDefined()
    })

    it('should accept cache option on route', () => {
      @Controller()
      class TestController {
        @GET({ cache: { key: ':route', ttl: 300 } })
        async getCachedItem(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(TestController)
      const routeMeta = meta?.routes.get('getCachedItem')

      expect(routeMeta?.cache).toBeDefined()
    })

    it('should combine multiple options on one route', () => {
      @Controller()
      class TestController {
        @GET({
          auth: 'jwt',
          rateLimit: { key: 'global', cost: 1 },
          cache: { key: ':route', ttl: 60 },
        })
        async getSecureItem(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(TestController)
      const routeMeta = meta?.routes.get('getSecureItem')

      expect(routeMeta?.auth).toBe('jwt')
      expect(routeMeta?.rateLimit).toBeDefined()
      expect(routeMeta?.cache).toBeDefined()
    })
  })

  describe('Multiple Routes', () => {
    it('should support multiple endpoints in one controller', () => {
      @Controller()
      class ItemController {
        @GET()
        async getItem(input: any, ctx: any) {}

        @GET()
        async listItems(input: any, ctx: any) {}

        @POST()
        async createItem(input: any, ctx: any) {}

        @PUT()
        async updateItem(input: any, ctx: any) {}

        @DELETE()
        async deleteItem(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(ItemController)

      expect(meta?.routes.size).toBe(5)
      expect(meta?.routes.has('getItem')).toBe(true)
      expect(meta?.routes.has('listItems')).toBe(true)
      expect(meta?.routes.has('createItem')).toBe(true)
      expect(meta?.routes.has('updateItem')).toBe(true)
      expect(meta?.routes.has('deleteItem')).toBe(true)
    })
  })

  describe('Decorator Behavior', () => {
    it('should not wrap decorated methods or break direct method calls', async () => {
      @Controller()
      class OrdersController {
        @GET()
        async getOrder(input: { id: string }, ctx: any) {
          return { id: input.id, status: 'pending' }
        }

        async duplicateOrder(id: string) {
          return this.getOrder({ id }, { method: 'GET', url: '/getOrder' })
        }
      }

      const instance = new OrdersController()
      await expect(instance.duplicateOrder('ord_123')).resolves.toEqual({
        id: 'ord_123',
        status: 'pending',
      })
      expect(instance.getOrder.name).toBe('getOrder')
    })
  })

  describe('plat Philosophy', () => {
    it('should use method names for routing, not path parameters', () => {
      @Controller()
      class TestController {
        @GET()
        async getItem(input: { id: string }, ctx: any) {}
      }

      // In plat, paths are determined by method names, not decorator arguments
      // The method name 'getItem' becomes '/getItem'
      // The id comes from the input object, not the path

      const meta = getControllerMeta(TestController)
      const routeMeta = meta?.routes.get('getItem')

      // In plat, the method name determines the path
      // Decorator arguments (if any) only provide options like auth, rate limiting, etc.
      expect(routeMeta?.path).toBe('/getItem')
    })

    it('should enforce flat routing (no nesting)', () => {
      @Controller()
      class ApiController {
        @GET()
        async getUser(input: any, ctx: any) {}

        @POST()
        async createOrder(input: any, ctx: any) {}

        @DELETE()
        async removeComment(input: any, ctx: any) {}
      }

      const meta = getControllerMeta(ApiController)

      // All methods are at the same level in the controller
      expect(meta?.routes.size).toBe(3)

      // Each method becomes a top-level route: /getUser, /createOrder, /removeComment
      // Not nested under the controller like /users/getUser
    })
  })
})
