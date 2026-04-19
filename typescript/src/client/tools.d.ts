/**
 * AI tool integration for plat clients
 *
 * - extractToolsFromOpenAPI: convert OpenAPI spec → tool definitions
 * - handleAnthropicToolUse: execute tool calls from Claude responses
 * - handleOpenAIToolUse: execute tool calls from OpenAI responses
 */
import type { ToolDefinition } from '../types/tools';
export type { ToolDefinition };
export interface AnthropicToolResult {
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
}
export interface OpenAIToolResult {
    role: 'tool';
    tool_call_id: string;
    content: string;
}
/**
 * Execute all tool_use blocks from an Anthropic/Claude response.
 *
 * Returns an array of tool_result objects ready to append as a user message:
 *
 * ```typescript
 * const results = await handleAnthropicToolUse(api, response)
 * messages.push({ role: 'assistant', content: response.content })
 * messages.push({ role: 'user', content: results })
 * ```
 */
export declare function handleAnthropicToolUse(api: Record<string, (input: any) => Promise<any>>, response: {
    content: Array<{
        type: string;
        id?: string;
        name?: string;
        input?: any;
    }>;
}): Promise<AnthropicToolResult[]>;
/**
 * Execute all tool calls from an OpenAI chat completion response.
 *
 * Returns an array of tool-role messages ready to append:
 *
 * ```typescript
 * const results = await handleOpenAIToolUse(api, response)
 * messages.push(response.choices[0].message)
 * messages.push(...results)
 * ```
 */
export declare function handleOpenAIToolUse(api: Record<string, (input: any) => Promise<any>>, response: {
    choices: Array<{
        message: {
            tool_calls?: Array<{
                id: string;
                type: string;
                function: {
                    name: string;
                    arguments: string;
                };
            }>;
        };
    }>;
}): Promise<OpenAIToolResult[]>;
/**
 * Extract tool definitions from an OpenAPI 3.x spec (Anthropic/Claude format)
 */
export declare function extractToolsFromOpenAPI(spec: any): ToolDefinition[];
//# sourceMappingURL=tools.d.ts.map