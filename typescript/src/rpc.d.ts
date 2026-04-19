export interface PLATRPCRequest {
    jsonrpc: '2.0';
    id: string;
    operationId?: string;
    method: string;
    path: string;
    headers?: Record<string, string>;
    input?: unknown;
    cancel?: boolean;
}
export type PLATRPCEventKind = 'progress' | 'log' | 'chunk' | 'message';
export interface PLATRPCErrorBody {
    status?: number;
    message: string;
    data?: unknown;
}
export interface PLATRPCSuccessResponse {
    jsonrpc: '2.0';
    id: string;
    ok: true;
    result: unknown;
}
export interface PLATRPCErrorResponse {
    jsonrpc: '2.0';
    id: string;
    ok: false;
    error: PLATRPCErrorBody;
}
export interface PLATRPCEventMessage {
    jsonrpc: '2.0';
    id: string;
    ok: true;
    event: PLATRPCEventKind;
    data?: unknown;
}
export type PLATRPCResponse = PLATRPCSuccessResponse | PLATRPCErrorResponse;
export type PLATRPCMessage = PLATRPCResponse | PLATRPCEventMessage;
export declare const DEFAULT_RPC_PATH = "/rpc";
//# sourceMappingURL=rpc.d.ts.map