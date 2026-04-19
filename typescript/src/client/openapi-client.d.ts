import { ClientError, ServerError } from '../types/errors';
import { type ClientCallOptions, type ResponseFormat } from '../types/client';
import { HttpMethods, type HttpMethod, type HeaderValue, type TypedHeaders, type WellKnownHeaders, ProxyProps } from '../types/http';
import type { OpenAPISpec } from '../types/openapi';
import { type ToolDefinition } from './tools';
import type { DeferredCallOptions } from '../types/client';
import type { OpenAPIClientTransportPlugin } from './transport-plugin';
export type HeadersInit<TCustom extends Record<string, HeaderValue | undefined> = {}> = TypedHeaders<TCustom> | Headers | Array<[string, string]>;
export interface RetryContext {
    attempt: number;
    maxAttempts: number;
    status?: number;
    error?: Error;
}
export interface RequestContext<M extends HttpMethod = HttpMethod> {
    method: M;
    path: string;
    url: string;
    headers: Record<string, HeaderValue | undefined>;
}
export interface OpenAPIClientHooks {
    /**
     * Called before the request is made
     */
    onPreRequest?: (context: RequestContext) => void | Promise<void>;
    /**
     * Called after a successful response
     */
    onPostRequest?: (context: RequestContext, response: Response) => void | Promise<void>;
    /**
     * Called when building headers
     */
    buildHeaders?: (defaults: Record<string, HeaderValue | undefined>, context: RequestContext) => Record<string, HeaderValue | undefined> | Promise<Record<string, HeaderValue | undefined>>;
    /**
     * Called when an error occurs
     */
    onError?: (error: ClientError | ServerError, context: RetryContext) => void | Promise<void>;
    /**
     * Determine if a request should be retried
     */
    shouldRetry?: (statusCode: number, context: RetryContext) => boolean;
}
export interface OpenAPIClientConfig<THeaders extends Record<string, HeaderValue | undefined> = {}> {
    headers?: HeadersInit<THeaders>;
    fetchInit?: Omit<RequestInit, 'method' | 'headers' | 'body' | 'signal'>;
    timeoutMs?: number;
    retry?: {
        maxAttempts?: number;
        delayMs?: number;
        backoffMultiplier?: number;
    };
    transport?: 'auto' | 'http' | 'rpc' | 'file' | 'css';
    rpcPath?: string;
    callsPath?: string;
    hooks?: OpenAPIClientHooks;
    transportPlugins?: OpenAPIClientTransportPlugin[];
}
export interface OpenAPIClientOptions<THeaders extends Record<string, HeaderValue | undefined> = {}> extends OpenAPIClientConfig<THeaders> {
    baseUrl: string;
}
/** Flatten an intersection into a plain object type for readability */
export type Simplify<T> = {
    [K in keyof T]: T[K];
} & {};
/** Convert (A | B | C) into (A & B & C) */
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
/** Map a JSON Schema type keyword to its TypeScript type */
export type JsonSchemaType<S> = S extends {
    readonly type: 'string';
    readonly enum: readonly (infer E)[];
} ? E : S extends {
    readonly type: 'string';
} ? string : S extends {
    readonly type: 'integer';
} ? number : S extends {
    readonly type: 'number';
} ? number : S extends {
    readonly type: 'boolean';
} ? boolean : S extends {
    readonly type: 'array';
    readonly items: infer I;
} ? JsonSchemaType<I>[] : S extends {
    readonly type: 'object';
    readonly properties: infer P extends Record<string, any>;
    readonly required: readonly (infer R extends string)[];
} ? Simplify<{
    [K in keyof P & R & string]: JsonSchemaType<P[K]>;
} & {
    [K in Exclude<keyof P & string, R>]?: JsonSchemaType<P[K]>;
}> : S extends {
    readonly type: 'object';
    readonly properties: infer P extends Record<string, any>;
} ? {
    [K in keyof P & string]?: JsonSchemaType<P[K]>;
} : any;
/** All path strings in the spec that have the given HTTP method */
export type PathsFor<TSpec, M extends string> = TSpec extends {
    readonly paths?: infer P extends Record<string, any>;
} ? {
    [K in keyof P & string]: Lowercase<M> extends keyof P[K] ? K : never;
}[keyof P & string] : never;
/** The raw operation object at a given path + method */
export type OperationAt<TSpec, P extends string, M extends string> = TSpec extends {
    readonly paths?: infer Paths extends Record<string, any>;
} ? P extends keyof Paths ? Lowercase<M> extends keyof Paths[P] ? Paths[P][Lowercase<M>] : never : never : any;
/** Build a typed object from an operation's `parameters` array */
type ExtractParams<Op> = Op extends {
    readonly parameters: readonly (infer Param)[];
} ? UnionToIntersection<Param extends {
    readonly name: infer N extends string;
    readonly required: true;
    readonly schema: infer S;
} ? {
    [K in N]: JsonSchemaType<S>;
} : Param extends {
    readonly name: infer N extends string;
    readonly schema: infer S;
} ? {
    [K in N]?: JsonSchemaType<S>;
} : {}> : {};
/** Build a typed object from an operation's `requestBody` schema */
type ExtractBody<Op> = Op extends {
    readonly requestBody: {
        readonly content: {
            readonly 'application/json': {
                readonly schema: infer S;
            };
        };
    };
} ? JsonSchemaType<S> extends infer T ? (unknown extends T ? {} : T) : {} : {};
/** Inferred input params for a path + method (parameters + requestBody merged) */
export type InferParams<TSpec, P extends string, M extends string> = Simplify<ExtractParams<OperationAt<TSpec, P, M>> & ExtractBody<OperationAt<TSpec, P, M>>> extends infer R ? [keyof R] extends [never] ? Record<string, any> : R : Record<string, any>;
/** Inferred response type for a path + method (from 200 or 201 response) */
export type InferResponse<TSpec, P extends string, M extends string> = OperationAt<TSpec, P, M> extends infer Op ? Op extends {
    readonly responses: infer R extends Record<string, any>;
} ? '200' extends keyof R ? R['200'] extends {
    readonly content: {
        readonly 'application/json': {
            readonly schema: infer S;
        };
    };
} ? JsonSchemaType<S> : any : '201' extends keyof R ? R['201'] extends {
    readonly content: {
        readonly 'application/json': {
            readonly schema: infer S;
        };
    };
} ? JsonSchemaType<S> : any : any : any : any;
type SpecPaths<TSpec> = TSpec extends {
    readonly paths?: infer P extends Record<string, any>;
} ? P : {};
type SpecPath<TSpec> = keyof SpecPaths<TSpec> & string;
type PathSegments<P extends string> = P extends `/${infer Rest}` ? PathSegments<Rest> : P extends `${infer Head}/${infer Tail}` ? [Head, ...PathSegments<Tail>] : P extends '' ? [] : [
    P
];
type MethodsForPath<TSpec, P extends string> = {
    [M in HttpMethod]: OperationAt<TSpec, P, M> extends never ? never : M;
}[HttpMethod];
type IsUnion<T, U = T> = [
    T
] extends [never] ? false : T extends any ? ([U] extends [T] ? false : true) : false;
export interface DeferredCallSnapshot<TResult = unknown> {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    statusCode?: number;
    result?: TResult;
    error?: {
        message: string;
        statusCode?: number;
        data?: unknown;
    };
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
}
export interface DeferredCallEvent {
    seq: number;
    at: string;
    event: 'progress' | 'log' | 'chunk' | 'message';
    data?: unknown;
}
export interface DeferredCallHandle<TResult = unknown> {
    id: string;
    status(): Promise<DeferredCallSnapshot<TResult>>;
    events(args?: {
        since?: number;
        event?: DeferredCallEvent['event'];
    }): Promise<DeferredCallEvent[]>;
    logs(since?: number): Promise<DeferredCallEvent[]>;
    result(): Promise<TResult>;
    wait(args?: {
        pollIntervalMs?: number;
        signal?: AbortSignal;
    }): Promise<TResult>;
    cancel(): Promise<boolean>;
}
type CallReturn<TResult, O> = O extends DeferredCallOptions ? DeferredCallHandle<TResult> : TResult;
type RouteMethodFn<TSpec, P extends string, M extends HttpMethod> = <O extends ClientCallOptions | undefined = undefined>(params: InferParams<TSpec, P, M>, options?: O) => Promise<CallReturn<InferResponse<TSpec, P, M>, NonNullable<O>>>;
type OpenAPIClientInstance<TSpec extends OpenAPISpec = OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined> = WellKnownHeaders> = OpenAPIClientImpl<TSpec, THeaders> & DynamicProxyProps<TSpec, THeaders>;
type RouteProxyBase<TSpec extends OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined>> = {
    [ProxyProps.ROOT]: OpenAPIClientInstance<TSpec, THeaders>;
    [ProxyProps.CLIENT]: OpenAPIClientInstance<TSpec, THeaders>;
    [ProxyProps.ROUTES]: string[];
    [ProxyProps.CHILDREN]: Record<string, unknown>;
    [ProxyProps.SPEC]: Record<string, unknown>;
};
type DirectCallForPath<TSpec, P extends string> = MethodsForPath<TSpec, P> extends infer M extends HttpMethod ? [M] extends [never] ? {} : IsUnion<M> extends true ? {} : (<O extends ClientCallOptions | undefined = undefined>(params: InferParams<TSpec, P, M>, options?: O) => Promise<CallReturn<InferResponse<TSpec, P, M>, NonNullable<O>>>) : {};
type RouteMethodPropsForPath<TSpec, P extends string> = {
    [M in MethodsForPath<TSpec, P> as Lowercase<M>]: RouteMethodFn<TSpec, P, M>;
};
type RouteProxyForPath<TSpec extends OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined>, P extends SpecPath<TSpec>> = RouteProxyBase<TSpec, THeaders> & RouteMethodPropsForPath<TSpec, P> & DirectCallForPath<TSpec, P>;
type RouteProxyForOperation<TSpec extends OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined>, P extends SpecPath<TSpec>, M extends HttpMethod> = RouteProxyBase<TSpec, THeaders> & {
    [K in Lowercase<M>]: RouteMethodFn<TSpec, P, M>;
} & (<O extends ClientCallOptions | undefined = undefined>(params: InferParams<TSpec, P, M>, options?: O) => Promise<CallReturn<InferResponse<TSpec, P, M>, NonNullable<O>>>);
type SegmentProxyObject<TSpec extends OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined>, P extends SpecPath<TSpec>, Segments extends string[] = PathSegments<P>> = Segments extends [infer Head extends string, ...infer Rest extends string[]] ? {
    [K in Head]: Rest extends [] ? RouteProxyForPath<TSpec, THeaders, P> : SegmentProxyObject<TSpec, THeaders, P, Rest>;
} : {};
type RootSegmentProps<TSpec extends OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined>> = UnionToIntersection<SpecPath<TSpec> extends infer P extends SpecPath<TSpec> ? SegmentProxyObject<TSpec, THeaders, P> : never>;
type OperationIdProps<TSpec extends OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined>> = UnionToIntersection<SpecPath<TSpec> extends infer P extends SpecPath<TSpec> ? {
    [M in HttpMethod]: OperationAt<TSpec, P, M> extends {
        readonly operationId: infer O extends string;
    } ? {
        [K in O]: RouteProxyForOperation<TSpec, THeaders, P, M>;
    } : {};
}[HttpMethod] : never>;
type DynamicProxyProps<TSpec extends OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined>> = RootSegmentProps<TSpec, THeaders> & OperationIdProps<TSpec, THeaders>;
export type OpenAPIClient<TSpec extends OpenAPISpec = OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined> = WellKnownHeaders> = OpenAPIClientInstance<TSpec, THeaders>;
declare class OpenAPIClientImpl<TSpec extends OpenAPISpec = OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined> = WellKnownHeaders> {
    private openAPISpec;
    private baseUrl;
    private headers;
    private fetchInit?;
    private timeoutMs;
    private retryConfig;
    private transportMode;
    private rpcPath;
    private callsPath;
    private hooks?;
    private transportPlugins;
    private openapi;
    private cachedTools?;
    private rpcSocket?;
    private rpcSocketPromise?;
    private rpcPending;
    private rpcCounter;
    /** Typed accessor for spec paths, handling the optional field. */
    private get _paths();
    private _opIndex?;
    private _segTree?;
    private _rootProxy?;
    constructor(openAPISpec: TSpec, options: OpenAPIClientOptions<THeaders>);
    private normalizeHeaders;
    /** Coerce all header values to strings for the fetch API. */
    private stringifyHeaders;
    buildHeaders(): Promise<Record<string, HeaderValue | undefined>>;
    private resolveTransportMode;
    private resolveTransportPlugin;
    private createBuiltInTransportRuntime;
    /**
     * Get tool definitions for AI integrations (Claude, OpenAI, etc)
     * Tools are extracted from the OpenAPI spec and cached
     */
    get tools(): ToolDefinition[];
    get<P extends PathsFor<TSpec, typeof HttpMethods.GET>, O extends ClientCallOptions | undefined = undefined>(path: P, params: InferParams<TSpec, P, typeof HttpMethods.GET>, options?: O): Promise<CallReturn<InferResponse<TSpec, P, typeof HttpMethods.GET>, NonNullable<O>>>;
    post<P extends PathsFor<TSpec, typeof HttpMethods.POST>, O extends ClientCallOptions | undefined = undefined>(path: P, params: InferParams<TSpec, P, typeof HttpMethods.POST>, options?: O): Promise<CallReturn<InferResponse<TSpec, P, typeof HttpMethods.POST>, NonNullable<O>>>;
    put<P extends PathsFor<TSpec, typeof HttpMethods.PUT>, O extends ClientCallOptions | undefined = undefined>(path: P, params: InferParams<TSpec, P, typeof HttpMethods.PUT>, options?: O): Promise<CallReturn<InferResponse<TSpec, P, typeof HttpMethods.PUT>, NonNullable<O>>>;
    patch<P extends PathsFor<TSpec, typeof HttpMethods.PATCH>, O extends ClientCallOptions | undefined = undefined>(path: P, params: InferParams<TSpec, P, typeof HttpMethods.PATCH>, options?: O): Promise<CallReturn<InferResponse<TSpec, P, typeof HttpMethods.PATCH>, NonNullable<O>>>;
    delete<P extends PathsFor<TSpec, typeof HttpMethods.DELETE>, O extends ClientCallOptions | undefined = undefined>(path: P, params: InferParams<TSpec, P, typeof HttpMethods.DELETE>, options?: O): Promise<CallReturn<InferResponse<TSpec, P, typeof HttpMethods.DELETE>, NonNullable<O>>>;
    private call;
    private findOperationByPath;
    private nextRpcId;
    private resolveRpcUrl;
    private sendRpcCancel;
    private ensureRpcSocket;
    createDeferredHandle<TResult>(id: string, options?: ClientCallOptions): DeferredCallHandle<TResult>;
    fetchDeferredJson<T>(path: string, options?: ClientCallOptions, method?: string, bodyPayload?: unknown): Promise<T>;
    private extractPathParams;
    private extractQueryParams;
    private extractHeaderParams;
    _parseResponse<T>(response: Response, format: ResponseFormat): Promise<T>;
    private createTimeoutPromise;
    delay(ms: number): Promise<void>;
    tryParseJson(text: string): unknown;
    /**
     * Detect request format from body values and OpenAPI spec content types.
     * Priority: Blob/File in values → spec declares multipart → spec declares form → json
     */
    private _detectRequestFormat;
    /** Detect the best response format from the OpenAPI spec and response headers. */
    _detectResponseFormat(response: Response, specContentTypes: string[]): ResponseFormat;
    /** Map a MIME content type string to a ResponseFormat. */
    private _contentTypeToFormat;
    private _ensureIndexes;
    /** All unique route names accessible from the root (operationIds + top-level segments). */
    private _rootRouteNames;
    /** Object mapping each root route name → its route proxy. */
    private _rootChildren;
    /**
     * Resolve a property name to a callable route proxy.
     * Checks operationId first, then path segment children.
     */
    private _resolveRoute;
    /**
     * Create a callable Proxy node for a route.
     *
     * The node is a function that can be called directly (if exactly one
     * HTTP method is registered) and also supports:
     *   .get(params)   .post(params)   etc. — explicit HTTP method
     *   .child         — nested path segment navigation
     */
    private _createCallableNode;
    /**
     * Build a .spec object from the route's registered methods.
     *
     * Uses standard OpenAPI field names:
     *   operationId, summary, description, parameters,
     *   requestBody, responses
     *
     * Single-method routes return the operation directly.
     * Multi-method routes return { GET: {...}, POST: {...} }.
     */
    private _callRoute;
    private _buildSpec;
}
/**
 * Fetches the OpenAPI spec from the given baseUrl and returns a new OpenAPIClient instance.
 * @param baseUrl The base URL of the API server
 * @param options Optional OpenAPIClient options
 */
export declare function createClient<THeaders extends Record<string, HeaderValue | undefined> = WellKnownHeaders>(baseUrl: string, options?: Partial<OpenAPIClientOptions<THeaders>>): Promise<OpenAPIClientInstance<any, THeaders>>;
interface OpenAPIClientConstructor {
    new <TSpec extends OpenAPISpec = OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined> = WellKnownHeaders>(openAPISpec: TSpec, options: OpenAPIClientOptions<THeaders>): OpenAPIClientInstance<TSpec, THeaders>;
    prototype: OpenAPIClientImpl<any, any>;
}
export declare const OpenAPIClient: OpenAPIClientConstructor;
export {};
//# sourceMappingURL=openapi-client.d.ts.map