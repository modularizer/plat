import { z } from "zod";
import { HttpMethod } from "./http";
import { RateLimitMeta, TokenLimitMeta, CacheMeta, RateLimitContext, TokenLimitContext, CacheContext } from "./plugins";
export type AuthMode = string;
export interface EndpointDef {
    controller: Function;
    controllerName: string;
    methodName: string;
    httpMethod: HttpMethod;
    basePath: string;
    routePath: string;
    fullPath: string;
    summary?: string;
    description?: string;
    tag?: string;
    inputSchema: z.ZodTypeAny | Record<string, any>;
    outputSchema: z.ZodTypeAny | Record<string, any>;
}
export interface RouteMeta {
    name: string;
    method?: HttpMethod;
    path?: string;
    auth?: AuthMode;
    rateLimit?: RateLimitMeta;
    tokenLimit?: TokenLimitMeta;
    cache?: CacheMeta;
    inputSchema?: z.ZodTypeAny | Record<string, any>;
    outputSchema?: z.ZodTypeAny | Record<string, any>;
    summary?: string;
    description?: string;
    opts?: Record<string, any>;
}
export interface ControllerMeta {
    basePath: string;
    tag?: string;
    auth?: AuthMode;
    rateLimit?: RateLimitMeta;
    tokenLimit?: TokenLimitMeta;
    cache?: CacheMeta;
    routes: Map<string | symbol, RouteMeta>;
}
export interface RouteContext {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[]>;
    auth?: {
        mode: AuthMode;
        user?: any;
    };
    rateLimit?: RateLimitContext;
    tokenLimit?: TokenLimitContext;
    cache?: CacheContext;
    opts?: Record<string, any>;
    call?: {
        id?: string;
        mode: 'rpc' | 'deferred';
        emit: (event: 'progress' | 'log' | 'chunk' | 'message', data?: unknown) => Promise<void> | void;
        progress: (data?: unknown) => Promise<void> | void;
        log: (data?: unknown) => Promise<void> | void;
        chunk: (data?: unknown) => Promise<void> | void;
        cancelled: () => boolean;
        signal?: AbortSignal;
    };
    rpc?: {
        id?: string;
        emit: (event: 'progress' | 'log' | 'chunk' | 'message', data?: unknown) => Promise<void> | void;
        progress: (data?: unknown) => Promise<void> | void;
        log: (data?: unknown) => Promise<void> | void;
        chunk: (data?: unknown) => Promise<void> | void;
        cancelled: () => boolean;
        signal?: AbortSignal;
    };
    request?: unknown;
    response?: unknown;
}
//# sourceMappingURL=endpoints.d.ts.map