/**
 * Tool Definition Generation for AI Integrations (Claude, OpenAI, etc)
 *
 * Generates standardized tool definitions from controller metadata
 * Supports multiple formats: Anthropic (Claude), OpenAI, generic JSON Schema
 */

import { ZodSchema } from 'zod'
import type { ToolDefinition, ToolFormat, AnthropicTool, OpenAITool } from '../types/tools'
import {
    buildInputSchemaFromOpenAPIOperation,
    buildResponseSchemaFromOpenAPIOperation,
    createToolDefinition as createSharedToolDefinition,
    emptyInputSchema,
    normalizeInputSchema,
    toolDefinitionFromOpenAPIOperation,
    type ToolDefinitionInit,
} from '../shared/tools'


/**
 * Convert a Zod schema to JSON Schema
 */
export function zodToJsonSchema(schema: ZodSchema): any {
    if (!schema) {
        return { type: 'object', properties: {} }
    }

    // Handle different Zod types
    const schemaAny = schema as any

    // For object schemas
    if (schemaAny._def?.shape) {
        const shape = schemaAny._def.shape
        const properties: Record<string, any> = {}
        const required: string[] = []

        for (const [key, field] of Object.entries(shape)) {
            const fieldSchema = field as ZodSchema
            const fieldAny = fieldSchema as any

            // Check if required
            if (fieldAny._def?.innerType === undefined && fieldAny._def?.t !== 'ZodOptional') {
                required.push(key)
            }

            // Get the type
            properties[key] = zodTypeToJsonType(fieldSchema)
        }

        return {
            type: 'object',
            properties,
            required: required.length > 0 ? required : undefined,
        }
    }

    // Fallback
    return { type: 'object', properties: {} }
}

/**
 * Convert a single Zod type to JSON Schema type
 */
function zodTypeToJsonType(schema: ZodSchema): any {
    const schemaAny = schema as any
    const typeName = schemaAny._def?.t

    switch (typeName) {
        case 'ZodString':
            return { type: 'string' }
        case 'ZodNumber':
            return { type: 'number' }
        case 'ZodBoolean':
            return { type: 'boolean' }
        case 'ZodArray': {
            const elementSchema = schemaAny._def?.type
            return {
                type: 'array',
                items: elementSchema ? zodTypeToJsonType(elementSchema) : { type: 'object' },
            }
        }
        case 'ZodObject':
            return zodToJsonSchema(schema)
        case 'ZodOptional':
            return zodTypeToJsonType(schemaAny._def?.innerType)
        case 'ZodEnum':
            return {
                type: 'string',
                enum: schemaAny._def?.values || [],
            }
        case 'ZodUnion':
            return { type: 'string' } // Simplified
        default:
            return { type: 'string' }
    }
}

export {
    buildInputSchemaFromOpenAPIOperation,
    buildResponseSchemaFromOpenAPIOperation,
    emptyInputSchema,
    normalizeInputSchema,
    toolDefinitionFromOpenAPIOperation,
}

export function createToolDefinition(init: ToolDefinitionInit): ToolDefinition
export function createToolDefinition(
    methodName: string,
    httpMethod: string,
    path: string,
    description: string,
    inputSchema?: ZodSchema,
    responseSchema?: ZodSchema,
    controller?: string
): ToolDefinition

/**
 * Create a tool definition from controller method metadata
 */
export function createToolDefinition(
    initOrMethodName: ToolDefinitionInit | string,
    httpMethod?: string,
    path?: string,
    description?: string,
    inputSchema?: ZodSchema,
    responseSchema?: ZodSchema,
    controller?: string
): ToolDefinition {
    if (typeof initOrMethodName === 'object') {
        return createSharedToolDefinition(initOrMethodName)
    }

    const methodName = initOrMethodName
    const normalizedMethod = (httpMethod || 'GET').toUpperCase()
    const normalizedPath = path || `/${methodName}`
    const jsonInputSchema = inputSchema ? zodToJsonSchema(inputSchema) : emptyInputSchema()

    return {
        name: methodName,
        description: description || `${normalizedMethod} ${normalizedPath}`,
        method: normalizedMethod,
        path: normalizedPath,
        controller,
        input_schema: normalizeInputSchema(jsonInputSchema),
        response_schema: responseSchema ? zodToJsonSchema(responseSchema) : undefined,
    }
}

/**
 * Convert tool definition to Claude/Anthropic format
 */
export function toAnthropicFormat(tool: ToolDefinition): AnthropicTool {
    return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
    }
}

/**
 * Convert tool definition to OpenAI format
 */
export function toOpenAIFormat(tool: ToolDefinition): OpenAITool {
    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: 'object',
                properties: tool.input_schema.properties,
                required: tool.input_schema.required,
            },
        },
    }
}

/**
 * Convert tool definition to generic format (with metadata)
 */
export function toSchemaFormat(tool: ToolDefinition): ToolDefinition {
    return tool
}

/**
 * Convert tool definition to requested format
 */
export function formatTool(tool: ToolDefinition, format: ToolFormat): any {
    switch (format) {
        case 'claude':
            return toAnthropicFormat(tool)
        case 'openai':
            return toOpenAIFormat(tool)
        case 'schema':
        default:
            return toSchemaFormat(tool)
    }
}
