import { ClientError, ServerError } from '../types/errors'
import { ResponseFormats, RequestFormats, type ClientCallOptions, type ResponseFormat, type RequestFormat } from '../types/client'
import { HttpMethods, type HttpMethod, type HeaderValue, type TypedHeaders, type WellKnownHeaders, ProxyProps, ParamLocations, ContentTypes } from '../types/http'
import type { OpenAPISpec } from '../types/openapi'
import {
  DEFAULT_RPC_PATH,
  type PLATRPCEventKind,
  type PLATRPCMessage,
  type PLATRPCRequest,
  type PLATRPCResponse,
} from '../rpc'
import { extractToolsFromOpenAPI, type ToolDefinition } from './tools'
import type { DeferredCallOptions } from '../types/client'
import type { OpenAPIClientTransportPlugin } from './transport-plugin'
import { createHttpTransportPlugin } from './http-transport-plugin'
import { createRpcTransportPlugin } from './rpc-transport-plugin'
import { createFileTransportPlugin } from './file-transport-plugin'
import { executeClientTransportPlugin, type OpenAPIClientTransportRequest } from './transport-plugin'
import { createClientSideServerMQTTWebRTCTransportPlugin } from '../client-side-server/mqtt-webrtc'

export type HeadersInit<TCustom extends Record<string, HeaderValue | undefined> = {}> =
  | TypedHeaders<TCustom>
  | Headers
  | Array<[string, string]>

export interface RetryContext {
  attempt: number
  maxAttempts: number
  status?: number
  error?: Error
}

export interface RequestContext<M extends HttpMethod = HttpMethod> {
  method: M
  path: string
  url: string
  headers: Record<string, HeaderValue | undefined>
}

export interface OpenAPIClientHooks {
  /**
   * Called before the request is made
   */
  onPreRequest?: (context: RequestContext) => void | Promise<void>

  /**
   * Called after a successful response
   */
  onPostRequest?: (context: RequestContext, response: Response) => void | Promise<void>

  /**
   * Called when building headers
   */
  buildHeaders?: (
    defaults: Record<string, HeaderValue | undefined>,
    context: RequestContext,
  ) => Record<string, HeaderValue | undefined> | Promise<Record<string, HeaderValue | undefined>>

  /**
   * Called when an error occurs
   */
  onError?: (
    error: ClientError | ServerError,
    context: RetryContext,
  ) => void | Promise<void>

  /**
   * Determine if a request should be retried
   */
  shouldRetry?: (
    statusCode: number,
    context: RetryContext,
  ) => boolean
}

export interface OpenAPIClientConfig<THeaders extends Record<string, HeaderValue | undefined> = {}> {
  headers?: HeadersInit<THeaders>
  fetchInit?: Omit<RequestInit, 'method' | 'headers' | 'body' | 'signal'>
  timeoutMs?: number
  retry?: {
    maxAttempts?: number
    delayMs?: number
    backoffMultiplier?: number
  }
  transport?: 'auto' | 'http' | 'rpc' | 'file' | 'css'
  rpcPath?: string
  callsPath?: string
  hooks?: OpenAPIClientHooks
  transportPlugins?: OpenAPIClientTransportPlugin[]
}

export interface OpenAPIClientOptions<THeaders extends Record<string, HeaderValue | undefined> = {}> extends OpenAPIClientConfig<THeaders> {
  baseUrl: string
}

// ── OpenAPI spec → TypeScript type inference ───────────────

/** Flatten an intersection into a plain object type for readability */
export type Simplify<T> = { [K in keyof T]: T[K] } & {}

/** Convert (A | B | C) into (A & B & C) */
type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never

/** Map a JSON Schema type keyword to its TypeScript type */
export type JsonSchemaType<S> =
  S extends { readonly type: 'string'; readonly enum: readonly (infer E)[] } ? E :
  S extends { readonly type: 'string' } ? string :
  S extends { readonly type: 'integer' } ? number :
  S extends { readonly type: 'number' } ? number :
  S extends { readonly type: 'boolean' } ? boolean :
  S extends { readonly type: 'array'; readonly items: infer I } ? JsonSchemaType<I>[] :
  S extends {
    readonly type: 'object'
    readonly properties: infer P extends Record<string, any>
    readonly required: readonly (infer R extends string)[]
  } ? Simplify<
        { [K in keyof P & R & string]: JsonSchemaType<P[K]> } &
        { [K in Exclude<keyof P & string, R>]?: JsonSchemaType<P[K]> }
      > :
  S extends { readonly type: 'object'; readonly properties: infer P extends Record<string, any> }
    ? { [K in keyof P & string]?: JsonSchemaType<P[K]> }
    : any

/** All path strings in the spec that have the given HTTP method */
export type PathsFor<TSpec, M extends string> =
  TSpec extends { readonly paths?: infer P extends Record<string, any> }
    ? { [K in keyof P & string]: Lowercase<M> extends keyof P[K] ? K : never }[keyof P & string]
    : never

/** The raw operation object at a given path + method */
export type OperationAt<TSpec, P extends string, M extends string> =
  TSpec extends { readonly paths?: infer Paths extends Record<string, any> }
    ? P extends keyof Paths
      ? Lowercase<M> extends keyof Paths[P]
        ? Paths[P][Lowercase<M>]
        : never
      : never
    : any

/** Build a typed object from an operation's `parameters` array */
type ExtractParams<Op> =
  Op extends { readonly parameters: readonly (infer Param)[] }
    ? UnionToIntersection<
        Param extends { readonly name: infer N extends string; readonly required: true; readonly schema: infer S }
          ? { [K in N]: JsonSchemaType<S> }
          : Param extends { readonly name: infer N extends string; readonly schema: infer S }
            ? { [K in N]?: JsonSchemaType<S> }
            : {}
      >
    : {}

/** Build a typed object from an operation's `requestBody` schema */
type ExtractBody<Op> =
  Op extends { readonly requestBody: { readonly content: { readonly 'application/json': { readonly schema: infer S } } } }
    ? JsonSchemaType<S> extends infer T ? (unknown extends T ? {} : T) : {}
    : {}

/** Inferred input params for a path + method (parameters + requestBody merged) */
export type InferParams<TSpec, P extends string, M extends string> =
  Simplify<ExtractParams<OperationAt<TSpec, P, M>> & ExtractBody<OperationAt<TSpec, P, M>>> extends infer R
    ? [keyof R] extends [never] ? Record<string, any> : R
    : Record<string, any>

/** Inferred response type for a path + method (from 200 or 201 response) */
export type InferResponse<TSpec, P extends string, M extends string> =
  OperationAt<TSpec, P, M> extends infer Op
    ? Op extends { readonly responses: infer R extends Record<string, any> }
      ? '200' extends keyof R
        ? R['200'] extends { readonly content: { readonly 'application/json': { readonly schema: infer S } } }
          ? JsonSchemaType<S>
          : any
        : '201' extends keyof R
          ? R['201'] extends { readonly content: { readonly 'application/json': { readonly schema: infer S } } }
            ? JsonSchemaType<S>
            : any
          : any
      : any
    : any

// ── internal types ─────────────────────────────────────────

type RouteOp<TSpec, M extends HttpMethod = HttpMethod> = {
  method: M
  path: PathsFor<TSpec, M>
  operation: Record<string, unknown>
}

type AnyRouteOp<TSpec> = {
  [M in HttpMethod]: RouteOp<TSpec, M>
}[HttpMethod]

interface RouteNode<TSpec> {
  methods: Map<HttpMethod, AnyRouteOp<TSpec>>
  children: Map<string, RouteNode<TSpec>>
}

type SpecPaths<TSpec> =
  TSpec extends { readonly paths?: infer P extends Record<string, any> }
    ? P
    : {}

type SpecPath<TSpec> = keyof SpecPaths<TSpec> & string

type PathSegments<P extends string> =
  P extends `/${infer Rest}` ? PathSegments<Rest> :
  P extends `${infer Head}/${infer Tail}` ? [Head, ...PathSegments<Tail>] :
  P extends '' ? [] :
  [P]

type MethodsForPath<TSpec, P extends string> = {
  [M in HttpMethod]: OperationAt<TSpec, P, M> extends never ? never : M
}[HttpMethod]

type IsUnion<T, U = T> =
  [T] extends [never] ? false :
  T extends any ? ([U] extends [T] ? false : true) : false

export interface DeferredCallSnapshot<TResult = unknown> {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  statusCode?: number
  result?: TResult
  error?: { message: string; statusCode?: number; data?: unknown }
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface DeferredCallEvent {
  seq: number
  at: string
  event: 'progress' | 'log' | 'chunk' | 'message'
  data?: unknown
}

export interface DeferredCallHandle<TResult = unknown> {
  id: string
  status(): Promise<DeferredCallSnapshot<TResult>>
  events(args?: { since?: number; event?: DeferredCallEvent['event'] }): Promise<DeferredCallEvent[]>
  logs(since?: number): Promise<DeferredCallEvent[]>
  result(): Promise<TResult>
  wait(args?: { pollIntervalMs?: number; signal?: AbortSignal }): Promise<TResult>
  cancel(): Promise<boolean>
}

type CallReturn<TResult, O> = O extends DeferredCallOptions ? DeferredCallHandle<TResult> : TResult

type RouteMethodFn<TSpec, P extends string, M extends HttpMethod> = <O extends ClientCallOptions | undefined = undefined>(
  params: InferParams<TSpec, P, M>,
  options?: O,
) => Promise<CallReturn<InferResponse<TSpec, P, M>, NonNullable<O>>>

type OpenAPIClientInstance<
  TSpec extends OpenAPISpec = OpenAPISpec,
  THeaders extends Record<string, HeaderValue | undefined> = WellKnownHeaders,
> = OpenAPIClientImpl<TSpec, THeaders> & DynamicProxyProps<TSpec, THeaders>

type RouteProxyBase<TSpec extends OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined>> = {
  [ProxyProps.ROOT]: OpenAPIClientInstance<TSpec, THeaders>
  [ProxyProps.CLIENT]: OpenAPIClientInstance<TSpec, THeaders>
  [ProxyProps.ROUTES]: string[]
  [ProxyProps.CHILDREN]: Record<string, unknown>
  [ProxyProps.SPEC]: Record<string, unknown>
}

type DirectCallForPath<TSpec, P extends string> =
  MethodsForPath<TSpec, P> extends infer M extends HttpMethod
    ? [M] extends [never]
      ? {}
      : IsUnion<M> extends true
        ? {}
        : (
            <O extends ClientCallOptions | undefined = undefined>(
            params: InferParams<TSpec, P, M>,
            options?: O,
          ) => Promise<CallReturn<InferResponse<TSpec, P, M>, NonNullable<O>>>
        )
    : {}

type RouteMethodPropsForPath<TSpec, P extends string> = {
  [M in MethodsForPath<TSpec, P> as Lowercase<M>]: RouteMethodFn<TSpec, P, M>
}

type RouteProxyForPath<
  TSpec extends OpenAPISpec,
  THeaders extends Record<string, HeaderValue | undefined>,
  P extends SpecPath<TSpec>,
> =
  RouteProxyBase<TSpec, THeaders> &
  RouteMethodPropsForPath<TSpec, P> &
  DirectCallForPath<TSpec, P>

type RouteProxyForOperation<
  TSpec extends OpenAPISpec,
  THeaders extends Record<string, HeaderValue | undefined>,
  P extends SpecPath<TSpec>,
  M extends HttpMethod,
> =
  RouteProxyBase<TSpec, THeaders> &
  { [K in Lowercase<M>]: RouteMethodFn<TSpec, P, M> } &
  (<O extends ClientCallOptions | undefined = undefined>(
    params: InferParams<TSpec, P, M>,
    options?: O,
  ) => Promise<CallReturn<InferResponse<TSpec, P, M>, NonNullable<O>>>)

type SegmentProxyObject<
  TSpec extends OpenAPISpec,
  THeaders extends Record<string, HeaderValue | undefined>,
  P extends SpecPath<TSpec>,
  Segments extends string[] = PathSegments<P>,
> =
  Segments extends [infer Head extends string, ...infer Rest extends string[]]
    ? {
        [K in Head]:
          Rest extends []
            ? RouteProxyForPath<TSpec, THeaders, P>
            : SegmentProxyObject<TSpec, THeaders, P, Rest>
      }
    : {}

type RootSegmentProps<
  TSpec extends OpenAPISpec,
  THeaders extends Record<string, HeaderValue | undefined>,
> =
  UnionToIntersection<
    SpecPath<TSpec> extends infer P extends SpecPath<TSpec>
      ? SegmentProxyObject<TSpec, THeaders, P>
      : never
  >

type OperationIdProps<
  TSpec extends OpenAPISpec,
  THeaders extends Record<string, HeaderValue | undefined>,
> =
  UnionToIntersection<
    SpecPath<TSpec> extends infer P extends SpecPath<TSpec>
      ? {
          [M in HttpMethod]:
            OperationAt<TSpec, P, M> extends { readonly operationId: infer O extends string }
              ? { [K in O]: RouteProxyForOperation<TSpec, THeaders, P, M> }
              : {}
        }[HttpMethod]
      : never
  >

type DynamicProxyProps<
  TSpec extends OpenAPISpec,
  THeaders extends Record<string, HeaderValue | undefined>,
> =
  RootSegmentProps<TSpec, THeaders> &
  OperationIdProps<TSpec, THeaders>

export type OpenAPIClient<
  TSpec extends OpenAPISpec = OpenAPISpec,
  THeaders extends Record<string, HeaderValue | undefined> = WellKnownHeaders,
> = OpenAPIClientInstance<TSpec, THeaders>

class OpenAPIClientImpl<TSpec extends OpenAPISpec = OpenAPISpec, THeaders extends Record<string, HeaderValue | undefined> = WellKnownHeaders> {
  private baseUrl: string
  private headers: Record<string, HeaderValue | undefined>
  private fetchInit?: Omit<RequestInit, 'method' | 'headers' | 'body' | 'signal'>
  private timeoutMs: number
  private retryConfig: { maxAttempts: number; delayMs: number; backoffMultiplier: number }
  private transportMode: 'http' | 'rpc' | 'file' | 'css'
  private rpcPath: string
  private callsPath: string
  private hooks?: OpenAPIClientHooks
  private transportPlugins: OpenAPIClientTransportPlugin[]
  private openapi: TSpec
  private cachedTools?: ToolDefinition[]
  private rpcSocket?: WebSocket
  private rpcSocketPromise?: Promise<WebSocket>
  private nodeFileRuntimePromise?: Promise<{
    mkdir: (path: string) => Promise<void>
    writeFile: (path: string, content: string) => Promise<void>
    readFile: (path: string) => Promise<string>
    join: (...parts: string[]) => string
  }>
  private rpcPending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    onEvent?: (event: { id: string; event: PLATRPCEventKind; data?: unknown }) => void | Promise<void>
  }>()
  private rpcCounter = 0

  /** Typed accessor for spec paths, handling the optional field. */
  private get _paths(): Readonly<Record<string, Record<string, unknown>>> {
    return (this.openapi.paths ?? {}) as Record<string, Record<string, unknown>>
  }
  private _opIndex?: Map<string, AnyRouteOp<TSpec>[]>
  private _segTree?: RouteNode<TSpec>
  private _rootProxy?: any

  constructor(
    private openAPISpec: TSpec,
    options: OpenAPIClientOptions<THeaders>,
  ) {
    this.baseUrl = options.baseUrl
    this.headers = this.normalizeHeaders(options.headers)
    this.fetchInit = options.fetchInit
    this.timeoutMs = options.timeoutMs ?? 30000
    this.retryConfig = {
      maxAttempts: options.retry?.maxAttempts ?? 3,
      delayMs: options.retry?.delayMs ?? 1000,
      backoffMultiplier: options.retry?.backoffMultiplier ?? 2,
    }
    this.transportMode = this.resolveTransportMode(options.transport)
    this.rpcPath = options.rpcPath ?? DEFAULT_RPC_PATH
    this.callsPath = options.callsPath ?? '/platCall'
    this.hooks = options.hooks
    const defaultTransportPlugins = this.baseUrl.startsWith('css://')
      ? [createClientSideServerMQTTWebRTCTransportPlugin()]
      : []
    this.transportPlugins = [
      ...(options.transportPlugins ?? []),
      ...defaultTransportPlugins,
      createHttpTransportPlugin(this.createBuiltInTransportRuntime()),
      createRpcTransportPlugin(this.createBuiltInTransportRuntime()),
      createFileTransportPlugin(this.createBuiltInTransportRuntime()),
    ]
    this.openapi = openAPISpec

    // Return a Proxy that enables dot-notation route access:
    //   client.listProducts({ limit: 10 })
    //   client.products.listProducts({ limit: 10 })
    //   client.listProducts.get({ limit: 10 })
    //   client.routes → ['listProducts', 'products', ...]
    //   client.children → { listProducts: proxy, products: proxy, ... }
    const rootProxy = new Proxy(this, {
      get: (target, prop, receiver) => {
        if (typeof prop === 'symbol' || Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver)
        }
        const p = String(prop)

        if (p === ProxyProps.ROOT) return rootProxy
        if (p === ProxyProps.CLIENT) return target
        if (p === ProxyProps.ROUTES) return target._rootRouteNames()
        if (p === ProxyProps.CHILDREN) return target._rootChildren()

        return target._resolveRoute(p)
      },
    })
    this._rootProxy = rootProxy
    return rootProxy as unknown as OpenAPIClientInstance<TSpec, THeaders>
  }

  private normalizeHeaders(headers?: HeadersInit): Record<string, HeaderValue | undefined> {
    if (!headers) return {}
    if (headers instanceof Headers) {
      const result: Record<string, string> = {}
      headers.forEach((value, key) => {
        result[key] = value
      })
      return result
    }
    if (Array.isArray(headers)) {
      return Object.fromEntries(headers)
    }
    return headers as Record<string, HeaderValue | undefined>
  }

  /** Coerce all header values to strings for the fetch API. */
  private stringifyHeaders(headers: Record<string, HeaderValue | undefined>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined) out[k] = String(v)
    }
    return out
  }

  async buildHeaders(): Promise<Record<string, HeaderValue | undefined>> {
      return {}
  }

  private resolveTransportMode(mode?: 'auto' | 'http' | 'rpc' | 'file' | 'css'): 'http' | 'rpc' | 'file' | 'css' {
    if (mode && mode !== 'auto') return mode
    if (/^file:\/\//i.test(this.baseUrl)) return 'file'
    if (/^css:\/\//i.test(this.baseUrl)) return 'css'
    return /^wss?:\/\//i.test(this.baseUrl) ? 'rpc' : 'http'
  }

  private resolveTransportPlugin(): OpenAPIClientTransportPlugin | undefined {
    return this.transportPlugins.find((plugin) =>
      plugin.canHandle({ baseUrl: this.baseUrl, transportMode: this.transportMode }),
    )
  }

  private createBuiltInTransportRuntime() {
    return {
      baseUrl: this.baseUrl,
      callsPath: this.callsPath,
      delay: (ms: number) => this.delay(ms),
      nextRequestId: (prefix: string) => `${prefix}-${this.nextRpcId()}`,
      stringifyHeaders: (headers: Record<string, HeaderValue | undefined>) => this.stringifyHeaders(headers),
      parseJson: (text: string) => this.tryParseJson(text),
      resolveRpcUrl: () => this.resolveRpcUrl(),
      ensureRpcSocket: () => this.ensureRpcSocket(),
      sendRpcCancel: (id: string) => this.sendRpcCancel(id),
      createDeferredHandle: <TResult>(id: string, options?: unknown) =>
        this.createDeferredHandle<TResult>(id, options as ClientCallOptions | undefined),
      fetchHttp: async (request: {
        method: HttpMethod
        url: string
        headers: Record<string, HeaderValue | undefined>
        body?: BodyInit
        signal?: AbortSignal
        timeoutMs: number
        fetchInit?: RequestInit
      }) => {
        return await Promise.race([
          fetch(request.url, {
            ...(request.fetchInit ?? this.fetchInit),
            method: request.method,
            headers: this.stringifyHeaders(request.headers),
            body: request.body ?? undefined,
            signal: request.signal,
          }),
          this.createTimeoutPromise(request.timeoutMs),
        ]) as Response
      },
      parseResponse: <T>(response: Response, format: ResponseFormat) => this._parseResponse<T>(response, format),
      detectResponseFormat: (response: Response, specContentTypes: string[]) => this._detectResponseFormat(response, specContentTypes),
      fetchInit: this.fetchInit,
      timeoutMs: this.timeoutMs,
      fileQueue: {
        resolvePaths: () => this.resolveFileQueuePaths(),
        pollIntervalMs: 100,
        mkdir: async (path: string) => {
          const runtime = await this.getNodeFileRuntime()
          await runtime.mkdir(path)
        },
        write: async (path: string, content: string) => {
          const runtime = await this.getNodeFileRuntime()
          await runtime.writeFile(path, content)
        },
        read: async (path: string) => {
          const runtime = await this.getNodeFileRuntime()
          return await runtime.readFile(path)
        },
      },
    }
  }

  /**
   * Get tool definitions for AI integrations (Claude, OpenAI, etc)
   * Tools are extracted from the OpenAPI spec and cached
   */
  get tools(): ToolDefinition[] {
    if (!this.cachedTools) {
      this.cachedTools = extractToolsFromOpenAPI(this.openAPISpec)
    }
    return this.cachedTools
  }

  async get<P extends PathsFor<TSpec, typeof HttpMethods.GET>, O extends ClientCallOptions | undefined = undefined>(
    path: P, params: InferParams<TSpec, P, typeof HttpMethods.GET>, options?: O,
  ): Promise<CallReturn<InferResponse<TSpec, P, typeof HttpMethods.GET>, NonNullable<O>>> {
    return this.call<typeof HttpMethods.GET, P, O>(HttpMethods.GET, path, params, options)
  }

  async post<P extends PathsFor<TSpec, typeof HttpMethods.POST>, O extends ClientCallOptions | undefined = undefined>(
    path: P, params: InferParams<TSpec, P, typeof HttpMethods.POST>, options?: O,
  ): Promise<CallReturn<InferResponse<TSpec, P, typeof HttpMethods.POST>, NonNullable<O>>> {
    return this.call<typeof HttpMethods.POST, P, O>(HttpMethods.POST, path, params, options)
  }

  async put<P extends PathsFor<TSpec, typeof HttpMethods.PUT>, O extends ClientCallOptions | undefined = undefined>(
    path: P, params: InferParams<TSpec, P, typeof HttpMethods.PUT>, options?: O,
  ): Promise<CallReturn<InferResponse<TSpec, P, typeof HttpMethods.PUT>, NonNullable<O>>> {
    return this.call<typeof HttpMethods.PUT, P, O>(HttpMethods.PUT, path, params, options)
  }

  async patch<P extends PathsFor<TSpec, typeof HttpMethods.PATCH>, O extends ClientCallOptions | undefined = undefined>(
    path: P, params: InferParams<TSpec, P, typeof HttpMethods.PATCH>, options?: O,
  ): Promise<CallReturn<InferResponse<TSpec, P, typeof HttpMethods.PATCH>, NonNullable<O>>> {
    return this.call<typeof HttpMethods.PATCH, P, O>(HttpMethods.PATCH, path, params, options)
  }

  async delete<P extends PathsFor<TSpec, typeof HttpMethods.DELETE>, O extends ClientCallOptions | undefined = undefined>(
    path: P, params: InferParams<TSpec, P, typeof HttpMethods.DELETE>, options?: O,
  ): Promise<CallReturn<InferResponse<TSpec, P, typeof HttpMethods.DELETE>, NonNullable<O>>> {
    return this.call<typeof HttpMethods.DELETE, P, O>(HttpMethods.DELETE, path, params, options)
  }

  private async call<
    M extends HttpMethod = HttpMethod,
    P extends PathsFor<TSpec, M> = PathsFor<TSpec, M>,
    O extends ClientCallOptions | undefined = undefined,
  >(
    method: M,
    path: P,
    params: InferParams<TSpec, P, M>,
    options?: O,
  ): Promise<CallReturn<InferResponse<TSpec, P, M>, NonNullable<O>>> {
    // Find the operation in the OpenAPI spec by method and path
    const operation = this.findOperationByPath(method, path as string)
    if (!operation) {
      throw new Error(`Operation ${method} ${path} not found in OpenAPI spec`)
    }

    const { pathParams, queryParams, headerParams, requestBody, requestContentTypes, responseContentTypes } = operation

    // Cast params to a plain record for runtime property access
    const p = params as Record<string, unknown>

    // Replace path parameters
    let url = path as string
    pathParams.forEach((param) => {
      const value = p[param]
      if (!value) {
        throw new Error(`Missing required path parameter: ${param}`)
      }
      url = url.replace(`{${param}}`, String(value))
    })

    // Add query parameters
    const queryString = new URLSearchParams()
    queryParams.forEach((param) => {
      if (param in p && p[param] !== undefined) {
        queryString.append(param, String(p[param]))
      }
    })

    if (queryString.toString()) {
      url += `?${queryString.toString()}`
    }

    const fullUrl = `${this.baseUrl}${url}`

    // Prepare request
    let headers: Record<string, HeaderValue | undefined> = {
      'Content-Type': ContentTypes.JSON,
      ...this.headers,
      ...(await this.buildHeaders()),
    }
    if (options?.headers) {
      const optionHeaders = this.normalizeHeaders(options.headers)
      Object.assign(headers, optionHeaders)
    }

    // Set header params from the params object (declared via `in: 'header'` in the spec)
    for (const name of headerParams) {
      if (name in p && p[name] !== undefined) {
        headers[name] = String(p[name])
      }
    }

    // Call buildHeaders hook
    const requestContext: RequestContext = { method, path: url, url: fullUrl, headers }
    if (this.hooks?.buildHeaders) {
      headers = await this.hooks.buildHeaders(headers, requestContext)
    }

    if (options?.execution === 'deferred') {
      headers['X-PLAT-Execution'] = 'deferred'
    }

    // Resolve timeout and retry config with per-call overrides
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs

    // Handle retry disabled case
    const retryDisabled = options?.retry === false
    const optionsRetry = options?.retry && typeof options.retry === 'object' ? options.retry : null
    const retryConfig = {
      maxAttempts: retryDisabled
        ? 1
        : optionsRetry?.maxAttempts ?? this.retryConfig.maxAttempts,
      delayMs: retryDisabled
        ? 0
        : optionsRetry?.retryDelayMs && typeof optionsRetry.retryDelayMs === 'number'
          ? optionsRetry.retryDelayMs
          : this.retryConfig.delayMs,
    }

    // Serialize request body based on format
    let body: BodyInit | undefined

    if (options?.body) {
      // Raw body passthrough
      body = options.body
    } else if (requestBody && p._body) {
      const payload = p._body as Record<string, unknown>
      const reqFormat = options?.requestFormat
        ?? this._detectRequestFormat(payload, requestContentTypes)

      if (reqFormat === RequestFormats.FORM) {
        const form = new URLSearchParams()
        for (const [k, v] of Object.entries(payload)) {
          if (v !== undefined) form.append(k, String(v))
        }
        body = form.toString()
        headers['Content-Type'] = ContentTypes.FORM
      } else if (reqFormat === RequestFormats.MULTIPART) {
        const form = new FormData()
        for (const [k, v] of Object.entries(payload)) {
          if (v instanceof Blob || typeof v === 'string') {
            form.append(k, v)
          } else if (v !== undefined) {
            form.append(k, String(v))
          }
        }
        body = form
        // Let the runtime set Content-Type with boundary
        delete headers['Content-Type']
      } else if (reqFormat === RequestFormats.RAW) {
        body = payload as unknown as BodyInit
      } else {
        body = JSON.stringify(payload)
      }
    }

    const customTransport = this.resolveTransportPlugin()
    if (customTransport) {
      return await executeClientTransportPlugin(customTransport, {
        id: customTransport.name === 'file' ? `file-${this.nextRpcId()}` : this.nextRpcId(),
        baseUrl: this.baseUrl,
        transportMode: this.transportMode,
        method,
        path: url,
        url: fullUrl,
        operationId: operation.operationId,
        params,
        headers,
        body,
        timeoutMs,
        execution: options?.execution,
        requestContext,
        signal: options?.signal,
        options,
        onEvent: options?.onRpcEvent,
        responseFormat: options?.responseFormat,
        responseContentTypes,
      } satisfies OpenAPIClientTransportRequest) as CallReturn<InferResponse<TSpec, P, M>, NonNullable<O>>
    }

    // Make request with retries
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        // Call pre-request hook
        if (this.hooks?.onPreRequest) {
          await this.hooks.onPreRequest(requestContext)
        }

        const response = await Promise.race([
          fetch(fullUrl, {
            ...this.fetchInit,
            method,
            headers: this.stringifyHeaders(headers),
            body: body ?? undefined,
            signal: options?.signal,
          }),
          this.createTimeoutPromise(timeoutMs),
        ]) as Response

        // Call post-request hook
        if (this.hooks?.onPostRequest) {
          await this.hooks.onPostRequest(requestContext, response)
        }

        if (response.ok) {
          if (options?.execution === 'deferred' && response.status === 202) {
            const payload = await response.json() as { id: string }
            return this.createDeferredHandle<InferResponse<TSpec, P, M>>(payload.id, options) as CallReturn<InferResponse<TSpec, P, M>, NonNullable<O>>
          }
          return this._parseResponse<InferResponse<TSpec, P, M>>(response, options?.responseFormat
            ?? this._detectResponseFormat(response, responseContentTypes)) as CallReturn<InferResponse<TSpec, P, M>, NonNullable<O>>
        }

        const bodyText = await response.text()
        const bodyJson = this.tryParseJson(bodyText)

        const error =
          response.status >= 400 && response.status < 500
            ? new ClientError({

                url: fullUrl,
                method,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                bodyText,
                bodyJson,
              })
            : new ServerError({

                url: fullUrl,
                method,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                bodyText,
                bodyJson,
              })

        const retryContext: RetryContext = {
          attempt,
          maxAttempts: retryConfig.maxAttempts,
          status: response.status,
          error,
        }

        // Call onError hook
        if (this.hooks?.onError) {
          await this.hooks.onError(error, retryContext)
        }

        // Determine if we should retry using hook or default logic
        const shouldRetryRequest =
          this.hooks?.shouldRetry?.(response.status, retryContext) ??
          response.status >= 500

        if (!shouldRetryRequest || attempt === retryConfig.maxAttempts) {
          throw error
        }

        lastError = error

        // Delay before retry with exponential backoff
        await this.delay(
          retryConfig.delayMs * Math.pow(2, attempt - 1),
        )
      } catch (error) {
        if (error instanceof ClientError || error instanceof ServerError) {
          const retryContext: RetryContext = {
            attempt,
            maxAttempts: retryConfig.maxAttempts,
            error,
          }

          // Call onError hook for client/server errors
          if (this.hooks?.onError) {
            await this.hooks.onError(error, retryContext)
          }

          throw error
        }

        lastError = error as Error

        if (attempt < retryConfig.maxAttempts) {
          await this.delay(
            retryConfig.delayMs * Math.pow(2, attempt - 1),
          )
        }
      }
    }

    throw lastError || new Error('Request failed after retries')
  }

  private findOperationByPath(
    method: HttpMethod,
    path: string,
  ): {
    operationId?: string
    pathParams: string[]
    queryParams: string[]
    headerParams: string[]
    requestBody: boolean
    requestContentTypes: string[]
    responseContentTypes: string[]
  } | null {
    const pathItem = this._paths[path]
    if (!pathItem) {
      return null
    }

    const op = pathItem[method.toLowerCase()] as Record<string, unknown> | undefined
    if (!op) {
      return null
    }

    const pathParams = this.extractPathParams(path)
    const queryParams = this.extractQueryParams(op)
    const headerParams = this.extractHeaderParams(op)

    const reqBody = op.requestBody as Record<string, unknown> | undefined
    const requestBody = !!reqBody
    const reqBodyContent = reqBody?.content as Record<string, unknown> | undefined
    const requestContentTypes = reqBodyContent ? Object.keys(reqBodyContent) : []

    // Collect response content types from the success response (200 or 201)
    const responses = op.responses as Record<string, Record<string, unknown>> | undefined
    const successResponse = responses?.['200'] ?? responses?.['201']
    const respContent = successResponse?.content as Record<string, unknown> | undefined
    const responseContentTypes = respContent ? Object.keys(respContent) : []

    return {
      operationId: typeof op.operationId === 'string' ? op.operationId : undefined,
      pathParams,
      queryParams,
      headerParams,
      requestBody,
      requestContentTypes,
      responseContentTypes,
    }
  }

  private nextRpcId(): string {
    this.rpcCounter += 1
    return `rpc-${this.rpcCounter}`
  }

  private resolveRpcUrl(): string {
    const url = new URL(this.baseUrl)
    if (!/^wss?:$/i.test(url.protocol)) {
      throw new Error(`RPC transport requires ws:// or wss:// baseUrl, got ${this.baseUrl}`)
    }
    if (!url.pathname || url.pathname === '/' || url.pathname === '') {
      url.pathname = this.rpcPath
    }
    return url.toString()
  }

  private async sendRpcCancel(id: string): Promise<void> {
    try {
      const socket = await this.ensureRpcSocket()
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'CANCEL',
        path: '',
        cancel: true,
      } satisfies PLATRPCRequest))
    } catch {
      // Best effort; cancellation should still reject locally even if the socket is unavailable.
    }
  }

  private async ensureRpcSocket(): Promise<WebSocket> {
    if (this.rpcSocket && this.rpcSocket.readyState === WebSocket.OPEN) {
      return this.rpcSocket
    }
    if (this.rpcSocketPromise) return this.rpcSocketPromise

    this.rpcSocketPromise = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.resolveRpcUrl())

      socket.addEventListener('open', () => {
        this.rpcSocket = socket
        resolve(socket)
      }, { once: true })

      socket.addEventListener('message', (event) => {
        const payload = this.tryParseJson(String(event.data)) as PLATRPCMessage
        if (!payload || typeof payload !== 'object' || !('id' in payload)) return
        const pending = this.rpcPending.get(String(payload.id))
        if (!pending) return
        if ('event' in payload && typeof payload.event === 'string') {
          void pending.onEvent?.({
            id: String(payload.id),
            event: payload.event,
            data: payload.data,
          })
          return
        }
        this.rpcPending.delete(String(payload.id))
        pending.resolve(payload as PLATRPCResponse)
      })

      socket.addEventListener('close', () => {
        this.rpcSocket = undefined
        this.rpcSocketPromise = undefined
        for (const [id, pending] of Array.from(this.rpcPending.entries())) {
          this.rpcPending.delete(id)
          pending.reject(new Error('RPC socket closed'))
        }
      }, { once: true })

      socket.addEventListener('error', () => {
        reject(new Error(`Failed to connect to RPC socket at ${this.resolveRpcUrl()}`))
      }, { once: true })
    })

    return this.rpcSocketPromise
  }

  private async getNodeFileRuntime(): Promise<{
    mkdir: (path: string) => Promise<void>
    writeFile: (path: string, content: string) => Promise<void>
    readFile: (path: string) => Promise<string>
    join: (...parts: string[]) => string
  }> {
    if (!this.nodeFileRuntimePromise) {
      const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>
      this.nodeFileRuntimePromise = Promise.all([
        dynamicImport('node:fs/promises'),
        dynamicImport('node:path'),
      ]).then(([fs, path]: [any, any]) => ({
        mkdir: async (targetPath: string) => { await fs.mkdir(targetPath, { recursive: true }) },
        writeFile: async (targetPath: string, content: string) => { await fs.writeFile(targetPath, content) },
        readFile: async (targetPath: string) => await fs.readFile(targetPath, 'utf8'),
        join: (...parts: string[]) => path.join(...parts),
      }))
    }

    return this.nodeFileRuntimePromise
  }

  private async resolveFileQueuePaths(): Promise<{ inbox: string; outbox: string }> {
    const url = new URL(this.baseUrl)
    if (url.protocol !== 'file:') {
      throw new Error(`File transport requires file:// baseUrl, got ${this.baseUrl}`)
    }
    const root = decodeURIComponent(url.pathname)
    const { join } = await this.getNodeFileRuntime()
    return {
      inbox: join(root, 'inbox'),
      outbox: join(root, 'outbox'),
    }
  }

  createDeferredHandle<TResult>(
    id: string,
    options?: ClientCallOptions,
  ): DeferredCallHandle<TResult> {
    return {
      id,
      status: async () => {
        return await this.fetchDeferredJson<DeferredCallSnapshot<TResult>>(
          `${this.callsPath}Status?id=${encodeURIComponent(id)}`,
          options,
        )
      },
      events: async (args) => {
        const search = new URLSearchParams()
        search.set('id', id)
        if (args?.since) search.set('since', String(args.since))
        if (args?.event) search.set('event', args.event)
        const payload = await this.fetchDeferredJson<{ events: DeferredCallEvent[] }>(
          `${this.callsPath}Events?${search.toString()}`,
          options,
        )
        return payload.events
      },
      logs: async (since) => {
        const search = new URLSearchParams()
        search.set('id', id)
        if (since) search.set('since', String(since))
        search.set('event', 'log')
        const payload = await this.fetchDeferredJson<{ events: DeferredCallEvent[] }>(
          `${this.callsPath}Events?${search.toString()}`,
          options,
        )
        return payload.events
      },
      result: async () => {
        const payload = await this.fetchDeferredJson<DeferredCallSnapshot<TResult>>(
          `${this.callsPath}Result?id=${encodeURIComponent(id)}`,
          options,
        )
        if (payload.status === 'completed') {
          return payload.result as TResult
        }
        if (payload.status === 'failed') {
          throw new Error(payload.error?.message || 'Deferred call failed')
        }
        if (payload.status === 'cancelled') {
          throw new DOMException('Deferred call was cancelled', 'AbortError')
        }
        throw new Error(`Deferred call ${id} is still ${payload.status}`)
      },
      wait: async (args) => {
        const pollIntervalMs = args?.pollIntervalMs ?? options?.pollIntervalMs ?? 1000
        while (true) {
          if (args?.signal?.aborted) {
            throw new DOMException('Deferred wait aborted', 'AbortError')
          }
          const snapshot = await this.fetchDeferredJson<DeferredCallSnapshot<TResult>>(
            `${this.callsPath}Result?id=${encodeURIComponent(id)}`,
            options,
          )
          if (snapshot.status === 'completed') {
            return snapshot.result as TResult
          }
          if (snapshot.status === 'failed') {
            throw new Error(snapshot.error?.message || 'Deferred call failed')
          }
          if (snapshot.status === 'cancelled') {
            throw new DOMException('Deferred call was cancelled', 'AbortError')
          }
          await this.delay(pollIntervalMs)
        }
      },
      cancel: async () => {
        const payload = await this.fetchDeferredJson<{ cancelled: boolean }>(
          `${this.callsPath}Cancel`,
          options,
          'POST',
          { id },
        )
        return payload.cancelled
      },
    }
  }

  async fetchDeferredJson<T>(
    path: string,
    options?: ClientCallOptions,
    method = 'GET',
    bodyPayload?: unknown,
  ): Promise<T> {
    const headers = {
      ...this.stringifyHeaders({
        ...this.headers,
        ...(await this.buildHeaders()),
      }),
      ...(options?.headers ? this.stringifyHeaders(this.normalizeHeaders(options.headers)) : {}),
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...this.fetchInit,
      method,
      headers: bodyPayload === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: bodyPayload === undefined ? undefined : JSON.stringify(bodyPayload),
      signal: options?.signal,
    })
    const payload = await response.json()
    if (!response.ok) {
      throw new Error((payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string')
        ? payload.error
        : `Deferred call request failed with ${response.status}`)
    }
    return payload as T
  }


  private extractPathParams(path: string): string[] {
    const matches = path.match(/{(\w+)}/g) || []
    return matches.map((m) => m.slice(1, -1))
  }

  private extractQueryParams(operation: Record<string, unknown>): string[] {
    const params = (operation.parameters ?? []) as Array<Record<string, unknown>>
    return params
      .filter((p) => p.in === ParamLocations.QUERY)
      .map((p) => p.name as string)
  }

  private extractHeaderParams(operation: Record<string, unknown>): string[] {
    const params = (operation.parameters ?? []) as Array<Record<string, unknown>>
    return params
      .filter((p) => p.in === ParamLocations.HEADER)
      .map((p) => p.name as string)
  }

  async _parseResponse<T>(response: Response, format: ResponseFormat): Promise<T> {
    switch (format) {
      case ResponseFormats.RAW: return response as unknown as T
      case ResponseFormats.TEXT: return await response.text() as unknown as T
      case ResponseFormats.BLOB: return await response.blob() as unknown as T
      case ResponseFormats.ARRAY_BUFFER: return await response.arrayBuffer() as unknown as T
      default: return await response.json() as T
    }
  }

  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Request timeout')),
        timeoutMs,
      ),
    )
  }

  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  tryParseJson(text: string): unknown {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  /**
   * Detect request format from body values and OpenAPI spec content types.
   * Priority: Blob/File in values → spec declares multipart → spec declares form → json
   */
  private _detectRequestFormat(payload: Record<string, unknown>, specContentTypes: string[]): RequestFormat {
    // If any value is a Blob or File, it must be multipart
    for (const v of Object.values(payload)) {
      if (v instanceof Blob) return RequestFormats.MULTIPART
    }
    // Check what the OpenAPI spec declares
    for (const ct of specContentTypes) {
      if (ct.includes('multipart')) return RequestFormats.MULTIPART
      if (ct.includes('x-www-form-urlencoded')) return RequestFormats.FORM
    }
    return RequestFormats.JSON
  }

  /** Detect the best response format from the OpenAPI spec and response headers. */
  _detectResponseFormat(response: Response, specContentTypes: string[]): ResponseFormat {
    // Check spec-declared content types first (known at build time)
    if (specContentTypes.length > 0) {
      const detected = this._contentTypeToFormat(specContentTypes[0]!)
      if (detected) return detected
    }
    // Fall back to the actual response Content-Type header
    const ct = response.headers.get('content-type')
    if (ct) {
      const detected = this._contentTypeToFormat(ct)
      if (detected) return detected
    }
    return ResponseFormats.JSON
  }

  /** Map a MIME content type string to a ResponseFormat. */
  private _contentTypeToFormat(ct: string): ResponseFormat | null {
    if (ct.includes('json')) return ResponseFormats.JSON
    if (ct.startsWith('text/')) return ResponseFormats.TEXT
    if (ct.includes('image/') || ct.includes('audio/') || ct.includes('video/') || ct.includes('octet-stream')) {
      return ResponseFormats.BLOB
    }
    return null
  }

  // ── Route proxy ────────────────────────────────────────────

  private _ensureIndexes(): void {
    if (this._opIndex) return
    this._opIndex = new Map()
    this._segTree = { methods: new Map(), children: new Map() }

    for (const [urlPath, pathItem] of Object.entries(this._paths)) {
      const segments = urlPath.split('/').filter(Boolean)

      // Walk/create segment tree nodes
      let node = this._segTree
      for (const seg of segments) {
        if (!node.children.has(seg)) {
          node.children.set(seg, { methods: new Map(), children: new Map() })
        }
        node = node.children.get(seg)!
      }

      // Register each HTTP method at this path
      for (const [httpMethod, op] of Object.entries(pathItem)) {
        const method = httpMethod.toUpperCase() as HttpMethod
        const operation = op as Record<string, unknown>
        const routeOp = {
          method,
          path: urlPath as PathsFor<TSpec, typeof method>,
          operation,
        } as RouteOp<TSpec, typeof method>
        node.methods.set(method, routeOp)

        const opId = operation.operationId as string | undefined
        if (opId) {
          if (!this._opIndex.has(opId)) this._opIndex.set(opId, [])
          this._opIndex.get(opId)!.push(routeOp)
        }
      }
    }
  }

  /** All unique route names accessible from the root (operationIds + top-level segments). */
  private _rootRouteNames(): string[] {
    this._ensureIndexes()
    const names = new Set<string>()
    this._opIndex!.forEach((_, name) => names.add(name))
    this._segTree!.children.forEach((_, name) => names.add(name))
    return Array.from(names)
  }

  /** Object mapping each root route name → its route proxy. */
  private _rootChildren(): Record<string, any> {
    const out: Record<string, any> = {}
    for (const name of this._rootRouteNames()) {
      out[name] = this._resolveRoute(name)
    }
    return out
  }

  /**
   * Resolve a property name to a callable route proxy.
   * Checks operationId first, then path segment children.
   */
  private _resolveRoute(name: string): any {
    this._ensureIndexes()

    const ops = this._opIndex!.get(name) ?? []
    const segChild = this._segTree!.children.get(name)

    if (ops.length === 0 && !segChild) return undefined
    return this._createCallableNode(ops, segChild ?? null)
  }

  /**
   * Create a callable Proxy node for a route.
   *
   * The node is a function that can be called directly (if exactly one
   * HTTP method is registered) and also supports:
   *   .get(params)   .post(params)   etc. — explicit HTTP method
   *   .child         — nested path segment navigation
   */
  private _createCallableNode(
    ops: AnyRouteOp<TSpec>[],
    segNode: RouteNode<TSpec> | null,
  ): any {
    // Merge methods from operationId matches and segment node
    const methods = new Map<HttpMethod, AnyRouteOp<TSpec>>()
    for (const op of ops) methods.set(op.method, op)
    if (segNode) {
      segNode.methods.forEach((routeOp, method) => {
        if (!methods.has(method)) methods.set(method, routeOp)
      })
    }

    // Build the .spec object — raw OpenAPI operation(s) with path/method added
    const specObj = this._buildSpec(methods)

    const client = this

    // Direct-call function: works when exactly one HTTP method
    const fn = function <TResponse = any, TParams extends Record<string, any> = Record<string, any>>(
      params?: TParams, options?: ClientCallOptions,
    ): Promise<TResponse> {
      if (methods.size === 0) {
        throw new Error('No HTTP methods at this route — use a child segment')
      }
      if (methods.size > 1) {
        const available = Array.from(methods.keys()).join(', ')
        throw new Error(
          `Ambiguous: multiple methods (${available}). Use .get(), .post(), etc.`,
        )
      }
      const [, routeOp] = Array.from(methods.entries())[0]!
      return client._callRoute(routeOp!, params ?? {}, options)
    }

    return new Proxy(fn, {
      get: (_target, prop) => {
        if (typeof prop === 'symbol') return Reflect.get(fn, prop)
        const p = String(prop)

        if (p === ProxyProps.THEN) return undefined
        if (p === ProxyProps.ROOT) return client._rootProxy
        if (p === ProxyProps.CLIENT) return client
        if (p === ProxyProps.SPEC) return specObj

        if (p === ProxyProps.ROUTES) {
          return segNode ? Array.from(segNode.children.keys()) : []
        }

        if (p === ProxyProps.CHILDREN) {
          const out: Record<string, any> = {}
          if (segNode) {
            segNode.children.forEach((child, name) => {
              out[name] = client._createCallableNode([], child)
            })
          }
          return out
        }

        // HTTP method accessor: .get(), .post(), .put(), .patch(), .delete()
        const upper = p.toUpperCase()
        if (upper in HttpMethods) {
          const httpMethod = upper as HttpMethod
          const routeOp = methods.get(httpMethod)
          if (routeOp) {
            return <TResponse = any, TParams extends Record<string, any> = Record<string, any>>(
              params?: TParams, options?: ClientCallOptions,
            ): Promise<TResponse> =>
              client._callRoute(routeOp, params ?? {}, options)
          }
        }

        // Child segment navigation
        if (segNode) {
          const child = segNode.children.get(p)
          if (child) return client._createCallableNode([], child)
        }

        // Fall through to native function properties (bind, call, apply, etc.)
        return Reflect.get(fn, prop)
      },
      apply: (_target, _thisArg, args) => {
        return fn(args[0] as Record<string, unknown> | undefined, args[1] as ClientCallOptions | undefined)
      },
    })
  }

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
  private _callRoute<M extends HttpMethod>(
    routeOp: RouteOp<TSpec, M>,
    params: InferParams<TSpec, RouteOp<TSpec, M>['path'], M> | Record<string, any>,
    options?: ClientCallOptions,
  ): Promise<InferResponse<TSpec, RouteOp<TSpec, M>['path'], M>> {
    return this.call<M, RouteOp<TSpec, M>['path'], ClientCallOptions | undefined>(
      routeOp.method,
      routeOp.path,
      params as InferParams<TSpec, RouteOp<TSpec, M>['path'], M>,
      options,
    ) as Promise<InferResponse<TSpec, RouteOp<TSpec, M>['path'], M>>
  }

  private _buildSpec(methods: Map<HttpMethod, AnyRouteOp<TSpec>>): Record<string, unknown> {
    const buildOne = (httpMethod: HttpMethod, routeOp: AnyRouteOp<TSpec>) => {
      const op = routeOp.operation
      return {
        method: httpMethod,
        path: routeOp.path,
        operationId: op.operationId,
        summary: op.summary,
        description: op.description,
        tags: op.tags,
        parameters: op.parameters,
        requestBody: op.requestBody,
        responses: op.responses,
      }
    }

    if (methods.size === 1) {
      const [method, routeOp] = Array.from(methods.entries())[0]!
      return buildOne(method!, routeOp!)
    }

    const spec: Record<string, unknown> = {}
    methods.forEach((routeOp, method) => {
      spec[method] = buildOne(method, routeOp)
    })
    return spec
  }
}

interface OpenAPIClientConstructor {
  new <
    TSpec extends OpenAPISpec = OpenAPISpec,
    THeaders extends Record<string, HeaderValue | undefined> = WellKnownHeaders,
  >(
    openAPISpec: TSpec,
    options: OpenAPIClientOptions<THeaders>,
  ): OpenAPIClientInstance<TSpec, THeaders>
  prototype: OpenAPIClientImpl<any, any>
}

export const OpenAPIClient = OpenAPIClientImpl as unknown as OpenAPIClientConstructor
