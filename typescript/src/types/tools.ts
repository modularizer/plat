export type ToolFormat = 'claude' | 'openai' | 'schema'

/**
 * Claude/Anthropic tool format
 */
export interface AnthropicTool {
    name: string
    description: string
    input_schema: {
        type: 'object'
        properties: Record<string, any>
        required: string[]
    }
}

/**
 * OpenAI tool format
 */
export interface OpenAITool {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: {
            type: 'object'
            properties: Record<string, any>
            required: string[]
        }
    }
}

/**
 * Generic tool metadata
 */
export interface ToolDefinition {
    name: string
    summary?: string
    description: string
    method: string
    path: string
    controller?: string  // Controller name/tag for namespace filtering
    tags?: string[]
    examples?: unknown[]
    hidden?: boolean
    safe?: boolean
    idempotent?: boolean
    longRunning?: boolean
    input_schema: {
        type: 'object'
        properties: Record<string, any>
        required: string[]
    }
    response_schema?: Record<string, any>
}
