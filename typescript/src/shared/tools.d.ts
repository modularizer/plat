import type { ToolDefinition } from '../types/tools';
export interface ToolDefinitionInit {
    name: string;
    summary?: string;
    description?: string;
    method: string;
    path: string;
    controller?: string;
    tags?: string[];
    examples?: unknown[];
    hidden?: boolean;
    safe?: boolean;
    idempotent?: boolean;
    longRunning?: boolean;
    input_schema?: ToolDefinition['input_schema'];
    response_schema?: ToolDefinition['response_schema'];
}
export declare function emptyInputSchema(): ToolDefinition['input_schema'];
export declare function normalizeInputSchema(schema?: Partial<ToolDefinition['input_schema']> | null): ToolDefinition['input_schema'];
export declare function createToolDefinition(init: ToolDefinitionInit): ToolDefinition;
export declare function buildInputSchemaFromOpenAPIOperation(operation: any): ToolDefinition['input_schema'];
export declare function buildResponseSchemaFromOpenAPIOperation(operation: any): ToolDefinition['response_schema'] | undefined;
export declare function toolDefinitionFromOpenAPIOperation(path: string, method: string, operation: any): ToolDefinition | null;
//# sourceMappingURL=tools.d.ts.map