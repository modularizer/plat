/**
 * AI tool integration for plat clients
 *
 * - extractToolsFromOpenAPI: convert OpenAPI spec → tool definitions
 * - handleAnthropicToolUse: execute tool calls from Claude responses
 * - handleOpenAIToolUse: execute tool calls from OpenAI responses
 */
import { toolDefinitionFromOpenAPIOperation } from '../shared/tools';
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
export async function handleAnthropicToolUse(api, response) {
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use');
    if (toolBlocks.length === 0)
        return [];
    return Promise.all(toolBlocks.map(async (block) => {
        const fn = api[block.name];
        if (!fn) {
            return {
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ error: `Unknown tool: ${block.name}` }),
                is_error: true,
            };
        }
        try {
            const result = await fn(block.input);
            return {
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result),
            };
        }
        catch (err) {
            return {
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify({ error: err.message ?? String(err) }),
                is_error: true,
            };
        }
    }));
}
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
export async function handleOpenAIToolUse(api, response) {
    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0)
        return [];
    return Promise.all(toolCalls.map(async (call) => {
        const fn = api[call.function.name];
        if (!fn) {
            return {
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify({ error: `Unknown tool: ${call.function.name}` }),
            };
        }
        try {
            const input = JSON.parse(call.function.arguments);
            const result = await fn(input);
            return {
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result),
            };
        }
        catch (err) {
            return {
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify({ error: err.message ?? String(err) }),
            };
        }
    }));
}
// ============================================================================
// TOOL EXTRACTION FROM OPENAPI
// ============================================================================
/**
 * Extract tool definitions from an OpenAPI 3.x spec (Anthropic/Claude format)
 */
export function extractToolsFromOpenAPI(spec) {
    const tools = [];
    if (!spec?.paths)
        return tools;
    for (const [path, pathItem] of Object.entries(spec.paths)) {
        if (typeof pathItem !== 'object' || !pathItem)
            continue;
        for (const [method, operation] of Object.entries(pathItem)) {
            if (!['get', 'post', 'put', 'patch', 'delete'].includes(method))
                continue;
            if (typeof operation !== 'object' || !operation)
                continue;
            const op = operation;
            if (!op.operationId)
                continue;
            const tool = toolDefinitionFromOpenAPIOperation(path, method, op);
            if (tool)
                tools.push(tool);
        }
    }
    return tools;
}
//# sourceMappingURL=tools.js.map