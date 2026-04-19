import type { HttpMethod, HeaderValue } from '../types/http';
import type { PLATRPCEventKind } from '../rpc';
import type { RequestContext } from './openapi-client';
import type { ResponseFormat } from '../types/client';
export interface OpenAPIClientTransportRequest {
    id: string;
    baseUrl: string;
    transportMode: string;
    method: HttpMethod;
    path: string;
    url?: string;
    operationId?: string;
    params: unknown;
    headers: Record<string, HeaderValue | undefined>;
    body?: BodyInit;
    timeoutMs?: number;
    responseFormat?: ResponseFormat;
    responseContentTypes?: string[];
    execution?: 'immediate' | 'deferred';
    requestContext: RequestContext;
    signal?: AbortSignal;
    options?: unknown;
    onEvent?: (event: {
        id?: string;
        event: PLATRPCEventKind;
        data?: unknown;
    }) => void | Promise<void>;
}
export interface OpenAPIClientTransportUpdate {
    id: string;
    event: PLATRPCEventKind | string;
    data?: unknown;
}
export interface OpenAPIClientTransportResult {
    id: string;
    ok: true;
    result: unknown;
}
export interface OpenAPIClientTransportFailure {
    id: string;
    ok: false;
    error: Error;
}
export type OpenAPIClientTransportOutcome = OpenAPIClientTransportResult | OpenAPIClientTransportFailure;
export interface OpenAPIClientTransportPlugin<TConnection = unknown> {
    name: string;
    canHandle(request: {
        baseUrl: string;
        transportMode: string;
    }): boolean;
    connect?(request: OpenAPIClientTransportRequest): Promise<TConnection> | TConnection;
    onConnect?(connection: TConnection, request: OpenAPIClientTransportRequest): Promise<void> | void;
    sendRequest(connection: TConnection, request: OpenAPIClientTransportRequest): Promise<void> | void;
    getUpdate?(connection: TConnection, request: OpenAPIClientTransportRequest): Promise<OpenAPIClientTransportUpdate | null | undefined> | OpenAPIClientTransportUpdate | null | undefined;
    onUpdate?(connection: TConnection, update: OpenAPIClientTransportUpdate, request: OpenAPIClientTransportRequest): Promise<void> | void;
    getResult(connection: TConnection, request: OpenAPIClientTransportRequest): Promise<OpenAPIClientTransportOutcome> | OpenAPIClientTransportOutcome;
    onResult?(connection: TConnection, result: OpenAPIClientTransportOutcome, request: OpenAPIClientTransportRequest): Promise<void> | void;
    disconnect?(connection: TConnection, request: OpenAPIClientTransportRequest): Promise<void> | void;
    onDisconnect?(connection: TConnection, request: OpenAPIClientTransportRequest): Promise<void> | void;
}
export declare function executeClientTransportPlugin<TConnection>(plugin: OpenAPIClientTransportPlugin<TConnection>, request: OpenAPIClientTransportRequest): Promise<unknown>;
//# sourceMappingURL=transport-plugin.d.ts.map