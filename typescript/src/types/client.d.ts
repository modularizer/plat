import type { ClientRouteLike } from './client-route';
import { ClientError, ServerError } from "./errors";
import type { PLATRPCEventKind } from "../rpc";
export type ApiClass<T> = abstract new (...args: any[]) => T;
export interface BuiltRequest {
    url: string;
    headers: HeadersInit;
    body?: string;
}
export interface RetryContext {
    attempt: number;
    maxAttempts: number;
    error?: unknown;
    response?: Response;
    route: ClientRouteLike;
}
export interface ClientProxyConfig {
    baseUrl: string;
    fetch?: typeof globalThis.fetch;
    headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
    timeoutMs?: number;
    retry?: false | {
        maxAttempts?: number;
        retryDelayMs?: number | ((ctx: RetryContext) => number);
        shouldRetry?: (ctx: RetryContext) => boolean;
    };
    onUnauthorized?: (error: ClientError) => void | Promise<void>;
    onForbidden?: (error: ClientError) => void | Promise<void>;
    onRateLimited?: (error: ClientError) => void | Promise<void>;
    onServerError?: (error: ServerError) => void | Promise<void>;
}
export type Clientified<T> = {
    [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: T[K] extends (input: infer I, ctx: any) => Promise<infer O> ? (input: I, opts?: ClientCallOptions) => Promise<O> : never;
};
export declare const ResponseFormats: {
    readonly JSON: "json";
    readonly TEXT: "text";
    readonly BLOB: "blob";
    readonly ARRAY_BUFFER: "arrayBuffer";
    readonly RAW: "raw";
};
export type ResponseFormat = typeof ResponseFormats[keyof typeof ResponseFormats];
export declare const RequestFormats: {
    readonly JSON: "json";
    readonly FORM: "form";
    readonly MULTIPART: "multipart";
    readonly RAW: "raw";
};
export type RequestFormat = typeof RequestFormats[keyof typeof RequestFormats];
export interface ClientCallOptions {
    headers?: HeadersInit;
    signal?: AbortSignal;
    timeoutMs?: number;
    execution?: 'immediate' | 'deferred';
    pollIntervalMs?: number;
    retry?: false | Partial<NonNullable<Exclude<ClientProxyConfig['retry'], false>>>;
    /** Controls how the response body is parsed. Defaults to 'json'. */
    responseFormat?: ResponseFormat;
    /** Controls how the request body is serialized. Defaults to 'json'.
     *  - 'json': JSON.stringify, sets Content-Type: application/json
     *  - 'form': URL-encoded, sets Content-Type: application/x-www-form-urlencoded
     *  - 'multipart': FormData (supports File/Blob), Content-Type set by browser
     *  - 'raw': body passed through as-is (string, ArrayBuffer, ReadableStream, etc.)
     */
    requestFormat?: RequestFormat;
    /** Raw body to send when requestFormat is 'raw'. Bypasses param serialization. */
    body?: BodyInit;
    /** Receives intermediate per-call RPC stream events before the final result. */
    onRpcEvent?: (event: {
        id?: string;
        event: PLATRPCEventKind;
        data?: unknown;
    }) => void | Promise<void>;
}
export interface ImmediateCallOptions extends ClientCallOptions {
    execution?: 'immediate';
}
export interface DeferredCallOptions extends ClientCallOptions {
    execution: 'deferred';
}
//# sourceMappingURL=client.d.ts.map