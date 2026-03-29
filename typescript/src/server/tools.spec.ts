/**
 * Tests for Tool Definition Generation
 * Validates AI tool definitions for Claude, OpenAI, etc.
 */

import { z } from 'zod'
import {
  createToolDefinition,
  buildInputSchemaFromOpenAPIOperation,
  buildResponseSchemaFromOpenAPIOperation,
  toolDefinitionFromOpenAPIOperation,
  toAnthropicFormat,
  toOpenAIFormat,
  toSchemaFormat,
  formatTool,
  zodToJsonSchema,
} from './tools'
import type { ToolDefinition } from '../types/tools'

describe('Tool Definitions', () => {
  describe('zodToJsonSchema', () => {
    it('should return an object with type property', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
      })

      const jsonSchema = zodToJsonSchema(schema)

      expect(jsonSchema).toBeDefined()
      expect(jsonSchema.type).toBe('object')
    })

    it('should have properties for each field', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
        age: z.number(),
      })

      const jsonSchema = zodToJsonSchema(schema)

      expect(jsonSchema.properties).toBeDefined()
      expect(typeof jsonSchema.properties).toBe('object')
    })

    it('should handle optional fields in required array', () => {
      const schema = z.object({
        id: z.string(),
        optional: z.string().optional(),
      })

      const jsonSchema = zodToJsonSchema(schema)

      if (jsonSchema.required) {
        expect(Array.isArray(jsonSchema.required)).toBe(true)
      }
    })

    it('should return empty object schema for null input', () => {
      const jsonSchema = zodToJsonSchema(null as any)

      expect(jsonSchema.type).toBe('object')
      expect(jsonSchema.properties).toBeDefined()
    })

    it('should handle various Zod types', () => {
      const schemas = [
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.string()),
        z.enum(['a', 'b']),
      ]

      for (const schema of schemas) {
        const jsonSchema = zodToJsonSchema(schema)
        expect(jsonSchema).toBeDefined()
      }
    })
  })

  describe('createToolDefinition', () => {
    it('should create a basic tool definition', () => {
      const tool = createToolDefinition(
        'getUser',
        'GET',
        '/getUser',
        'Fetch a user by ID'
      )

      expect(tool.name).toBe('getUser')
      expect(tool.method).toBe('GET')
      expect(tool.path).toBe('/getUser')
      expect(tool.description).toBe('Fetch a user by ID')
      expect(tool.input_schema.type).toBe('object')
    })

    it('should handle input schema', () => {
      const inputSchema = z.object({
        id: z.string(),
        includeDetails: z.boolean().optional(),
      })

      const tool = createToolDefinition(
        'getUser',
        'GET',
        '/getUser',
        'Get user',
        inputSchema
      )

      expect(tool.input_schema).toBeDefined()
      expect(tool.input_schema.type).toBe('object')
      expect(tool.input_schema.properties).toBeDefined()
    })

    it('should include controller tag', () => {
      const tool = createToolDefinition(
        'getUser',
        'GET',
        '/getUser',
        'Get user',
        undefined,
        undefined,
        'users'
      )

      expect(tool.controller).toBe('users')
    })

    it('should use default description if not provided', () => {
      const tool = createToolDefinition(
        'getUser',
        'GET',
        '/getUser',
        ''  // Empty description - will use default
      )

      expect(tool.description).toBe('GET /getUser')
    })

    it('should support richer metadata fields', () => {
      const tool = createToolDefinition({
        name: 'importCatalog',
        summary: 'Import a catalog',
        description: 'Import catalog data from a source',
        method: 'POST',
        path: '/importCatalog',
        controller: 'catalog',
        tags: ['catalog', 'imports'],
        hidden: true,
        safe: false,
        idempotent: false,
        longRunning: true,
        examples: [{ source: 's3://bucket/catalog.csv' }],
        input_schema: {
          type: 'object',
          properties: { source: { type: 'string' } },
          required: ['source'],
        },
      })

      expect(tool.summary).toBe('Import a catalog')
      expect(tool.tags).toEqual(['catalog', 'imports'])
      expect(tool.hidden).toBe(true)
      expect(tool.longRunning).toBe(true)
      expect(tool.examples).toEqual([{ source: 's3://bucket/catalog.csv' }])
    })
  })

  describe('OpenAPI tool extraction helpers', () => {
    it('should merge parameter and request body fields into one input schema', () => {
      const inputSchema = buildInputSchemaFromOpenAPIOperation({
        parameters: [
          {
            name: 'id',
            required: true,
            description: 'Order ID',
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  qty: { type: 'number' },
                },
                required: ['qty'],
              },
            },
          },
        },
      })

      expect(inputSchema.properties.id).toEqual({
        type: 'string',
        description: 'Order ID',
      })
      expect(inputSchema.properties.qty).toEqual({ type: 'number' })
      expect(inputSchema.required).toEqual(['id', 'qty'])
    })

    it('should extract a response schema from successful responses', () => {
      const responseSchema = buildResponseSchemaFromOpenAPIOperation({
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' } },
                },
              },
            },
          },
        },
      })

      expect(responseSchema).toEqual({
        type: 'object',
        properties: { ok: { type: 'boolean' } },
      })
    })

    it('should build a canonical tool definition from an OpenAPI operation', () => {
      const tool = toolDefinitionFromOpenAPIOperation('/createOrder', 'post', {
        operationId: 'createOrder',
        summary: 'Create an order',
        tags: ['orders'],
        parameters: [
          {
            name: 'dryRun',
            required: false,
            schema: { type: 'boolean' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  itemId: { type: 'string' },
                  qty: { type: 'number' },
                },
                required: ['itemId', 'qty'],
              },
            },
          },
        },
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { orderId: { type: 'string' } },
                },
              },
            },
          },
        },
      })

      expect(tool).toMatchObject({
        name: 'createOrder',
        summary: 'Create an order',
        description: 'Create an order',
        method: 'POST',
        path: '/createOrder',
        controller: 'orders',
        tags: ['orders'],
      })
      expect(tool?.input_schema.required).toEqual(['itemId', 'qty'])
      expect(tool?.response_schema).toEqual({
        type: 'object',
        properties: { orderId: { type: 'string' } },
      })
    })
  })

  describe('Format Converters', () => {
    let toolDef: ToolDefinition

    beforeEach(() => {
      toolDef = createToolDefinition(
        'getUser',
        'GET',
        '/getUser',
        'Get a user'
      )
    })

    describe('toAnthropicFormat', () => {
      it('should convert to Anthropic tool format', () => {
        const anthropic = toAnthropicFormat(toolDef)

        expect(anthropic.name).toBe('getUser')
        expect(anthropic.description).toBe('Get a user')
        expect(anthropic.input_schema).toBeDefined()
        expect(anthropic.input_schema.type).toBe('object')
      })

      it('should be compatible with Claude SDK', () => {
        const anthropic = toAnthropicFormat(toolDef)

        // Verify it has required Claude fields
        expect(anthropic).toHaveProperty('name')
        expect(anthropic).toHaveProperty('description')
        expect(anthropic).toHaveProperty('input_schema')
        expect(anthropic.input_schema).toHaveProperty('type')
        expect(anthropic.input_schema).toHaveProperty('properties')
      })
    })

    describe('toOpenAIFormat', () => {
      it('should convert to OpenAI tool format', () => {
        const openai = toOpenAIFormat(toolDef)

        expect(openai.type).toBe('function')
        expect(openai.function.name).toBe('getUser')
        expect(openai.function.description).toBe('Get a user')
        expect(openai.function.parameters).toBeDefined()
        expect(openai.function.parameters.type).toBe('object')
      })

      it('should be compatible with OpenAI function calling', () => {
        const openai = toOpenAIFormat(toolDef)

        expect(openai.type).toBe('function')
        expect(openai.function).toHaveProperty('name')
        expect(openai.function).toHaveProperty('description')
        expect(openai.function).toHaveProperty('parameters')
      })
    })

    describe('toSchemaFormat', () => {
      it('should return the tool definition as-is', () => {
        const schema = toSchemaFormat(toolDef)

        expect(schema).toEqual(toolDef)
      })
    })

    describe('formatTool', () => {
      it('should format to Claude/Anthropic by default', () => {
        const result = formatTool(toolDef, 'claude')

        expect(result.name).toBe('getUser')
        expect(result.input_schema).toBeDefined()
        expect(result.type).toBeUndefined() // Not present in Anthropic format
      })

      it('should format to OpenAI when specified', () => {
        const result = formatTool(toolDef, 'openai')

        expect(result.type).toBe('function')
        expect(result.function).toBeDefined()
        expect(result.function.name).toBe('getUser')
      })

      it('should format to schema when specified', () => {
        const result = formatTool(toolDef, 'schema')

        expect(result).toEqual(toolDef)
      })
    })
  })

  describe('Integration', () => {
    it('should create tool definitions for multiple methods', () => {
      const tools = [
        createToolDefinition('getUser', 'GET', '/getUser', 'Get a user'),
        createToolDefinition('listUsers', 'GET', '/listUsers', 'List all users'),
        createToolDefinition('createUser', 'POST', '/createUser', 'Create a new user'),
        createToolDefinition('updateUser', 'PUT', '/updateUser', 'Update a user'),
        createToolDefinition('deleteUser', 'DELETE', '/deleteUser', 'Delete a user'),
      ]

      expect(tools).toHaveLength(5)
      expect(tools.map(t => t.name)).toEqual([
        'getUser',
        'listUsers',
        'createUser',
        'updateUser',
        'deleteUser',
      ])
    })

    it('should support filtering tools by controller', () => {
      const tools = [
        createToolDefinition('getUser', 'GET', '/getUser', 'Get user', undefined, undefined, 'users'),
        createToolDefinition('listUsers', 'GET', '/listUsers', 'List users', undefined, undefined, 'users'),
        createToolDefinition('getProduct', 'GET', '/getProduct', 'Get product', undefined, undefined, 'products'),
      ]

      const userTools = tools.filter(t => t.controller === 'users')
      expect(userTools).toHaveLength(2)

      const productTools = tools.filter(t => t.controller === 'products')
      expect(productTools).toHaveLength(1)
    })
  })
})
