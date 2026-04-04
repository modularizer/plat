import type { ToolDefinition } from '../types/tools'

export interface ToolDefinitionInit {
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

export function emptyInputSchema(): ToolDefinition['input_schema'] {
    return { type: 'object', properties: {}, required: [] }
}

export function normalizeInputSchema(schema?: Partial<ToolDefinition['input_schema']> | null): ToolDefinition['input_schema'] {
    return {
        type: 'object',
        properties: schema?.properties ?? {},
        required: schema?.required ?? [],
    }
}

export function createToolDefinition(init: ToolDefinitionInit): ToolDefinition {
    return {
        name: init.name,
        summary: init.summary,
        description: init.description || `${init.method.toUpperCase()} ${init.path}`,
        method: init.method.toUpperCase(),
        path: init.path,
        controller: init.controller,
        tags: init.tags,
        examples: init.examples,
        hidden: init.hidden,
        safe: init.safe,
        idempotent: init.idempotent,
        longRunning: init.longRunning,
        input_schema: normalizeInputSchema(init.input_schema),
        response_schema: init.response_schema,
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
