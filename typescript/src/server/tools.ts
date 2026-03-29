/**
 * Tool Definition Generation for AI Integrations (Claude, OpenAI, etc)
 *
 * Generates standardized tool definitions from controller metadata
 * Supports multiple formats: Anthropic (Claude), OpenAI, generic JSON Schema
 */

import { ZodSchema } from 'zod'
import type { ToolDefinition, ToolFormat, AnthropicTool, OpenAITool } from '../types/tools'

interface ToolDefinitionInit {
    name: string
    summary?: string
    description?: string
    method: string
    path: string
    controller?: string
    tags?: string[]
    examples?: unknown[]
    hidden?: boolean
    safe?: boolean
    idempotent?: boolean
    longRunning?: boolean
    input_schema?: ToolDefinition['input_schema']
    response_schema?: ToolDefinition['response_schema']
}


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

function emptyInputSchema(): ToolDefinition['input_schema'] {
    return { type: 'object', properties: {}, required: [] }
}

function normalizeInputSchema(schema?: Partial<ToolDefinition['input_schema']> | null): ToolDefinition['input_schema'] {
    return {
        type: 'object',
        properties: schema?.properties ?? {},
        required: schema?.required ?? [],
    }
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
        return {
            name: initOrMethodName.name,
            summary: initOrMethodName.summary,
            description: initOrMethodName.description || `${initOrMethodName.method.toUpperCase()} ${initOrMethodName.path}`,
            method: initOrMethodName.method.toUpperCase(),
            path: initOrMethodName.path,
            controller: initOrMethodName.controller,
            tags: initOrMethodName.tags,
            examples: initOrMethodName.examples,
            hidden: initOrMethodName.hidden,
            safe: initOrMethodName.safe,
            idempotent: initOrMethodName.idempotent,
            longRunning: initOrMethodName.longRunning,
            input_schema: normalizeInputSchema(initOrMethodName.input_schema),
            response_schema: initOrMethodName.response_schema,
        }
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

export function buildInputSchemaFromOpenAPIOperation(operation: any): ToolDefinition['input_schema'] {
    const properties: Record<string, any> = {}
    const required = new Set<string>()

    if (Array.isArray(operation?.parameters)) {
        for (const param of operation.parameters) {
            if (!param?.name || !param?.schema) continue
            properties[param.name] = { ...param.schema }
            if (param.description) properties[param.name].description = param.description
            if (param.required) required.add(param.name)
        }
    }

    const bodySchema = operation?.requestBody?.content?.['application/json']?.schema
    if (bodySchema?.type === 'object' && bodySchema.properties) {
        Object.assign(properties, bodySchema.properties)
        for (const name of bodySchema.required ?? []) required.add(name)
    }

    return {
        type: 'object',
        properties,
        required: Array.from(required),
    }
}

export function buildResponseSchemaFromOpenAPIOperation(operation: any): ToolDefinition['response_schema'] | undefined {
    const responses = operation?.responses
    if (!responses || typeof responses !== 'object') return undefined

    for (const status of ['200', '201', '202', 'default']) {
        const schema = responses[status]?.content?.['application/json']?.schema
        if (schema) return schema
    }

    for (const response of Object.values(responses as Record<string, any>)) {
        const schema = response?.content?.['application/json']?.schema
        if (schema) return schema
    }

    return undefined
}

export function toolDefinitionFromOpenAPIOperation(
    path: string,
    method: string,
    operation: any,
): ToolDefinition | null {
    if (!operation?.operationId) return null

    return createToolDefinition({
        name: operation.operationId,
        summary: operation.summary,
        description: operation.description || operation.summary || `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        controller: operation.tags?.[0],
        tags: Array.isArray(operation.tags) ? operation.tags : undefined,
        input_schema: buildInputSchemaFromOpenAPIOperation(operation),
        response_schema: buildResponseSchemaFromOpenAPIOperation(operation),
    })
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
