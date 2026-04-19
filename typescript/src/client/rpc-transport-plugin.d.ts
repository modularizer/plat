import type { PLATRPCResponse } from '../rpc';
import type { OpenAPIClientTransportPlugin } from './transport-plugin';
interface RpcTransportRuntime {
    nextRequestId(prefix: string): string;
    stringifyHeaders(headers: Record<string, string | number | boolean | undefined>): Record<string, string>;
    parseJson(text: string): unknown;
    resolveRpcUrl(): string;
    ensureRpcSocket(): Promise<WebSocket>;
    sendRpcCancel(id: string): Promise<void>;
}
interface RpcConnection {
    socket: WebSocket;
    result?: PLATRPCResponse;
}
export declare function createRpcTransportPlugin(runtime: RpcTransportRuntime): OpenAPIClientTransportPlugin<RpcConnection>;
export {};
//# sourceMappingURL=rpc-transport-plugin.d.ts.map