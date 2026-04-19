import type { ClientRouteLike } from './client-route';
export interface ErrorPayload {
    code?: string;
    message?: string;
    details?: unknown;
    [key: string]: unknown;
}
export declare class HttpError extends Error {
    readonly statusCode: number;
    readonly data?: any;
    constructor(statusCode: number, message: string, data?: any);
}
export declare abstract class HttpProxyError extends Error {
    readonly route: ClientRouteLike | undefined;
    readonly url: string;
    readonly method: string;
    readonly status: number | undefined;
    readonly statusText: string | undefined;
    readonly headers: Headers | undefined;
    readonly bodyText: string | undefined;
    readonly bodyJson: unknown;
    readonly cause: unknown;
    protected constructor(args: {
        name: string;
        message: string;
        route?: ClientRouteLike;
        url: string;
        method: string;
        status: number | undefined;
        statusText: string | undefined;
        headers: Headers | undefined;
        bodyText: string | undefined;
        bodyJson: unknown;
        cause: unknown;
    });
}
export declare class ClientError extends HttpProxyError {
    readonly payload: ErrorPayload | undefined;
    constructor(args: {
        route?: ClientRouteLike;
        url: string;
        method: string;
        status: number;
        statusText: string;
        headers: Headers;
        bodyText: string | undefined;
        bodyJson: unknown;
    });
    get isUnauthorized(): boolean;
    get isForbidden(): boolean;
    get isNotFound(): boolean;
    get isConflict(): boolean;
    get isUnprocessable(): boolean;
    get isRateLimited(): boolean;
    get retryAfterMs(): number | undefined;
}
export declare class ServerError extends HttpProxyError {
    readonly payload: ErrorPayload | undefined;
    constructor(args: {
        route?: ClientRouteLike;
        url: string;
        method: string;
        status: number;
        statusText: string;
        headers: Headers;
        bodyText: string | undefined;
        bodyJson: unknown;
    });
}
export declare class NetworkError extends HttpProxyError {
    constructor(args: {
        route?: ClientRouteLike;
        url: string;
        method: string;
        cause: unknown;
    });
}
export declare class TimeoutError extends HttpProxyError {
    constructor(args: {
        route?: ClientRouteLike;
        url: string;
        method: string;
        cause: unknown;
    });
}
//# sourceMappingURL=errors.d.ts.map