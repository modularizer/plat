import { normalizeParameters } from '../server/param-aliases'
import { PLATServerCore, type RegisteredStaticFolder } from '../server/core'
import { PLATOperationRegistry } from '../server/operation-registry'
import { isFileResponse, type FileResponse } from '../static/file-response'
import {
  HttpError,
  type AuthMode,
  type CacheController,
  type RateLimitConfigs,
  type RateLimitController,
  type ResolvedRateLimitEntry,
  type ResolvedTokenLimitEntry,
  type RouteContext,
  type TokenLimitConfigs,
  type TokenLimitController,
  type ToolDefinition,
} from '../types'
import type { OpenAPIInfo } from '../types/openapi'
import type { PLATServerResolvedOperation } from '../server/transports'
import { defaultLogger, type Logger } from '../logging'
import {
  applyCacheCheck,
  applyCacheStore,
  createInMemoryCache,
} from '../server/cache'
import {
  applyRateLimitCheck,
  applyRateLimitRefund,
  createInMemoryRateLimit,
} from '../server/rate-limit'
import {
  applyTokenLimitCheck,
  applyTokenLimitFailure,
  applyTokenLimitResponse,
  createInMemoryTokenLimit,
} from '../server/token-limit'
import type { PLATAuthorityServerOptions } from '../server/authority-server'
import { createAuthorityServerController } from '../server/authority-server'
import type { ClientSideServerChannel } from './channel'
import type {
  ClientSideServerInstanceInfo,
  ClientSideServerMessage,
  ClientSideServerRequest,
} from './protocol'
import {
  createClientSideServerMQTTWebRTCServer,
  type ClientSideServerMQTTWebRTCOptions,
  type ClientSideServerMQTTWebRTCServer,
  type ClientSideServerWorkerInfo,
} from './mqtt-webrtc'

export interface ClientSideServerOptions {
  /**
   * Server identifier used as the css:// namespace / MQTT topic suffix when
   * the server is started with `.listen()`. Mirrors the role of `host`+`port`
   * on the Node-side `createServer()` — no network binding happens in-browser,
   * but every deployed server still needs a stable name.
   */
  name?: string
  /**
   * Accepted for cross-runtime signature parity with `PLATServerOptions`.
   * Ignored in-browser — there is no port to bind.
   */
  port?: number
  host?: string
  cors?: unknown
  protocol?: string
  /**
   * MQTT / STUN / WebRTC transport configuration, used when `.listen()` is
   * invoked. Anything settable on `runClientSideServer(...)` is accepted here.
   */
  transport?: ClientSideServerMQTTWebRTCOptions
  /** Optional worker pool metadata forwarded to the MQTT signaler. */
  workerInfo?: ClientSideServerWorkerInfo
  /** Optional callback fired once the signaler has started. */
  onStart?: (info: { name: string; connectionUrl: string }) => void | Promise<void>
  /** Optional callback fired after `.close()` completes. */
  onStop?: () => void | Promise<void>
  undecoratedMode?: 'GET' | 'POST' | 'private'
  errorExposure?: 'none' | 'message' | 'full'
  allowedMethodPrefixes?: '*' | string[]
  disAllowedMethodPrefixes?: string[]
  paramCoercions?: Record<string, string>
  disAllowedParams?: string[]
  serializers?: Record<string, (value: any) => unknown>
  openapiInfo?: OpenAPIInfo
  auth?: {
    verify(mode: AuthMode, req: any, ctx: RouteContext): Promise<any> | any
  }
  defaultAuth?: AuthMode
  rateLimit?: {
    controller?: RateLimitController
    configs?: RateLimitConfigs
  }
  tokenLimit?: {
    controller?: TokenLimitController
    configs?: TokenLimitConfigs
  }
  cache?: {
    controller?: CacheController
  }
  authorityServer?: false | PLATAuthorityServerOptions
  logger?: Logger
  onRequest?: (request: ClientSideServerRequest, ctx: RouteContext) => void | Promise<void>
  onResponse?: (request: ClientSideServerRequest, ctx: RouteContext, result: unknown) => void | Promise<void>
  onError?: (request: ClientSideServerRequest, ctx: RouteContext, error: Error) => void | Promise<void>
  onChannelOpen?: (channel: ClientSideServerChannel) => void | Promise<void>
  onChannelClose?: (channel: ClientSideServerChannel) => void | Promise<void>
  middleware?: ClientSideServerMiddleware[]
  /**
   * Static metadata published via the `/server-info` endpoint and MQTT announces.
   * `openapiHash` and `serverStartedAt` are auto-computed if not provided.
   */
  instanceInfo?: ClientSideServerInstanceInfo
}

export interface ClientSideServerMiddlewareContext {
  request: ClientSideServerRequest
  operation: PLATServerResolvedOperation
  ctx: RouteContext
  input: Record<string, any>
  logger: Logger
}

export type ClientSideServerMiddleware = (
  context: ClientSideServerMiddlewareContext,
  next: () => Promise<unknown>,
) => Promise<unknown> | unknown

export class PLATClientSideServer {
  private routes: Array<{ method: string; path: string; methodName?: string }> = []
  private toolsStore = new Map<string, ToolDefinition>()
  private operationRegistry = new PLATOperationRegistry()
  private registeredMethodNames = new Set<string>()
  private registeredControllerNames = new Set<string>()
  private staticFolders: RegisteredStaticFolder[] = []
  private core: PLATServerCore
  private openapiCache?: Record<string, any>
  private logger: Logger
  private middleware: ClientSideServerMiddleware[]
  private readonly serverCreatedAt = Date.now()
  private openapiHashComputed = false
  private openapiHashValue?: string
  private signaler?: ClientSideServerMQTTWebRTCServer
  private connectionUrlCached?: string

  constructor(
    private options: ClientSideServerOptions = {},
    ...ControllerClasses: (new () => any)[]
  ) {
    this.logger = options.logger ?? defaultLogger
    this.middleware = [...(options.middleware ?? [])]
    if (this.options.rateLimit && !this.options.rateLimit.controller) {
      this.options.rateLimit.controller = createInMemoryRateLimit()
    }
    if (this.options.tokenLimit && !this.options.tokenLimit.controller) {
      this.options.tokenLimit.controller = createInMemoryTokenLimit()
    }
    if (this.options.cache && !this.options.cache.controller) {
      this.options.cache.controller = createInMemoryCache()
    }
    this.core = new PLATServerCore({
      undecoratedMode: options.undecoratedMode,
      allowedMethodPrefixes: options.allowedMethodPrefixes,
      disAllowedMethodPrefixes: options.disAllowedMethodPrefixes,
    }, {
      routes: this.routes,
      tools: this.toolsStore,
      operationRegistry: this.operationRegistry,
      registeredMethodNames: this.registeredMethodNames,
      registeredControllerNames: this.registeredControllerNames,
      staticFolders: this.staticFolders,
    })

    if (ControllerClasses.length > 0) {
      this.register(...ControllerClasses)
    }
    if (this.options.authorityServer) {
      this.register(createAuthorityServerController(this.options.authorityServer))
    }
  }

  register(...ControllerClasses: (new () => any)[]): this {
    this.core.registerControllers(...ControllerClasses)
    this.openapiCache = undefined
    this.openapiHashComputed = false
    this.openapiHashValue = undefined
    return this
  }

  use(middleware: ClientSideServerMiddleware): this {
    this.middleware.push(middleware)
    return this
  }

  /**
   * Start the MQTT/STUN/WebRTC signaler so this server is reachable over
   * css://. Mirrors `PLATServer.listen(port, host, cb)` — the `port` and
   * `host` positional args are accepted for signature parity with the Node
   * server and are ignored in-browser.
   *
   * The server `name` is read from `this.options.name`. Transport-level
   * knobs (mqttBroker, iceServers, etc.) come from `this.options.transport`.
   *
   * Returns `this` so calls can chain like the Node server, but resolves
   * asynchronously since the underlying signaler performs network setup.
   */
  async listen(
    portOrCallback?: number | (() => void),
    hostOrCallback?: string | (() => void),
    callbackIfHost?: () => void,
  ): Promise<this> {
    let userCallback: (() => void) | undefined
    if (typeof portOrCallback === 'function') userCallback = portOrCallback
    else if (typeof hostOrCallback === 'function') userCallback = hostOrCallback
    else if (typeof callbackIfHost === 'function') userCallback = callbackIfHost

    if (this.signaler) {
      userCallback?.()
      return this
    }

    const name = this.options.name
    if (!name) {
      throw new Error('PLATClientSideServer.listen(): `options.name` is required so the css:// server has a stable identifier.')
    }

    const transport = this.options.transport ?? {}
    this.signaler = createClientSideServerMQTTWebRTCServer({
      ...transport,
      server: this,
      serverName: name,
      workerInfo: this.options.workerInfo,
      instanceInfo: this.options.instanceInfo,
    })

    await this.signaler.start()
    this.connectionUrlCached = this.signaler.connectionUrl

    void this.options.onStart?.({ name, connectionUrl: this.connectionUrlCached })
    userCallback?.()
    return this
  }

  /** Stop the signaler if `.listen()` has been called. Safe to call twice. */
  async close(): Promise<void> {
    if (!this.signaler) return
    const signaler = this.signaler
    this.signaler = undefined
    this.connectionUrlCached = undefined
    await signaler.stop()
    void this.options.onStop?.()
  }

  /** The css:// URL the server is reachable at, once `.listen()` has resolved. */
  get connectionUrl(): string | undefined {
    return this.connectionUrlCached
  }

  get tools(): ToolDefinition[] {
    return Array.from(this.toolsStore.values())
  }

  get openapi(): Record<string, any> {
    if (!this.openapiCache) {
      this.openapiCache = this.generateOpenAPISpec()
    }
    return this.openapiCache
  }

  /**
   * Returns the server's self-identification metadata.
   * `openapiHash` is computed (and cached) from the current openapi spec.
   * `serverStartedAt` is set to the time this PLATClientSideServer was constructed.
   * User-supplied fields (`version`, `versionHash`, `updatedAt`) come from options.
   */
  async getServerInfo(): Promise<ClientSideServerInstanceInfo> {
    return {
      ...this.options.instanceInfo,
      openapiHash: await this.getOrComputeOpenapiHash(),
      serverStartedAt: this.options.instanceInfo?.serverStartedAt ?? this.serverCreatedAt,
    }
  }

  private async getOrComputeOpenapiHash(): Promise<string | undefined> {
    if (this.openapiHashComputed) return this.openapiHashValue
    this.openapiHashComputed = true
    try {
      const subtle = globalThis.crypto?.subtle
      if (!subtle) return undefined
      const text = cssStableStringify(this.openapi)
      const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
      this.openapiHashValue = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    } catch {
      this.openapiHashValue = undefined
    }
    return this.openapiHashValue
  }

  async handleMessage(
    message: ClientSideServerMessage,
    channel: ClientSideServerChannel,
  ): Promise<void> {
    if (!isRequestMessage(message) || message.cancel) {
      return
    }

    if (message.method.toUpperCase() === 'GET' && message.path === '/openapi.json') {
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: true,
        result: this.openapi,
      })
      return
    }

    if (message.method.toUpperCase() === 'GET' && message.path === '/tools') {
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: true,
        result: this.tools,
      })
      return
    }

    if (message.method.toUpperCase() === 'GET' && message.path === '/server-info') {
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: true,
        result: await this.getServerInfo(),
      })
      return
    }

    if (message.method.toUpperCase() === 'GET' && message.path === '/__plat/static-manifest') {
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: true,
        result: await this.buildStaticManifest(),
      })
      return
    }

    // Try static folder resolution before operation lookup
    if (message.method.toUpperCase() === 'GET') {
      const staticResult = await this.resolveStaticFolder(message.path)
      if (staticResult !== undefined) {
        if (staticResult === null) {
          await channel.send({ jsonrpc: '2.0', id: message.id, ok: false, error: { status: 404, message: 'Not found' } })
        } else {
          await channel.send({ jsonrpc: '2.0', id: message.id, ok: true, result: await this.serializeFileResponse(staticResult, message.headers) })
        }
        return
      }
    }

    const operation = this.operationRegistry.resolve({
      operationId: message.operationId,
      method: message.method,
      path: message.path,
    })

    if (!operation) {
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: false,
        error: {
          status: 404,
          message: `Client-side server operation not found for ${message.method} ${message.path}`,
        },
      })
      return
    }

    try {
      const result = await this.executeOperation(operation, message, channel)
      if (isFileResponse(result)) {
        await channel.send({
          jsonrpc: '2.0',
          id: message.id,
          ok: true,
          result: await this.serializeFileResponse(result, message.headers),
        })
      } else {
        await channel.send({
          jsonrpc: '2.0',
          id: message.id,
          ok: true,
          result: this.serializeValue(result),
        })
      }
    } catch (error: any) {
      this.logger.error(`[ClientSideServer Error] ${error?.message ?? 'Internal client-side server error'}`, error)
      const status = error instanceof HttpError ? error.statusCode : 500
      const exposedError = this.buildErrorPayload(error)
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: false,
        error: { status, ...exposedError },
      })
    }
  }

  serveChannel(channel: ClientSideServerChannel): () => void {
    void this.options.onChannelOpen?.(channel)
    const unsubscribe = channel.subscribe((message) => void this.handleMessage(message, channel))
    return () => {
      unsubscribe()
      void this.options.onChannelClose?.(channel)
    }
  }

  private async executeOperation(
    operation: PLATServerResolvedOperation,
    request: ClientSideServerRequest,
    channel: ClientSideServerChannel,
  ): Promise<unknown> {
    const normalizedInput = normalizeParameters(
      typeof request.input === 'object' && request.input !== null
        ? request.input as Record<string, any>
        : {},
      this.options.paramCoercions,
      this.options.disAllowedParams,
    )

    const ctx: RouteContext = {
      method: operation.method,
      url: operation.path,
      headers: request.headers ?? {},
      opts: operation.routeMeta?.opts,
    }

    ctx.call = {
      id: request.id,
      mode: 'rpc',
      emit: async (event, data) => {
        await channel.send({
          jsonrpc: '2.0',
          id: request.id,
          ok: true,
          event,
          data: this.serializeValue(data),
        })
      },
      progress: async (data) => await ctx.call?.emit('progress', data),
      log: async (data) => await ctx.call?.emit('log', data),
      chunk: async (data) => await ctx.call?.emit('chunk', data),
      cancelled: () => false,
    }
    ctx.rpc = ctx.call
    await this.options.onRequest?.(request, ctx)
    const middlewareContext: ClientSideServerMiddlewareContext = {
      request,
      operation,
      ctx,
      input: normalizedInput,
      logger: this.logger,
    }

    try {
      const result = await this.executeOperationWithPolicies(operation, request, ctx, normalizedInput, middlewareContext)
      await this.options.onResponse?.(request, ctx, result)
      return result
    } catch (error: any) {
      await this.options.onError?.(request, ctx, error)
      throw error
    }
  }

  private async executeOperationWithPolicies(
    operation: PLATServerResolvedOperation,
    request: ClientSideServerRequest,
    ctx: RouteContext,
    input: Record<string, any>,
    middlewareContext: ClientSideServerMiddlewareContext,
  ): Promise<unknown> {
    const routeMeta = operation.routeMeta
    const controllerMeta = operation.controllerMeta
    const methodName = operation.methodName
    const controllerTag = operation.controllerTag
    const authMode = routeMeta?.auth ?? controllerMeta?.auth ?? this.options.defaultAuth ?? 'public'
    let rateLimitEntries: ResolvedRateLimitEntry[] = []
    let tokenLimitEntries: ResolvedTokenLimitEntry[] = []
    const tokenStartMs = Date.now()
    let handlerWasCalled = false

    if (authMode !== 'public' && this.options.auth) {
      const user = await this.options.auth.verify(authMode, { headers: request.headers ?? {} }, ctx)
      ctx.auth = { mode: authMode, user }
    } else if (authMode !== 'public' && !this.options.auth) {
      throw new HttpError(500, 'Authentication handler not configured')
    }

    const rateLimitMeta = routeMeta?.rateLimit ?? controllerMeta?.rateLimit
    if (rateLimitMeta && this.options.rateLimit?.controller) {
      const result = await applyRateLimitCheck(
        rateLimitMeta,
        this.options.rateLimit.controller,
        this.options.rateLimit.configs || {},
        methodName,
        controllerTag,
        ctx.auth?.user,
      )
      rateLimitEntries = result.entries
      ctx.rateLimit = { entries: result.entries, remainingBalances: result.remainingBalances }
    }

    const tokenLimitMeta = routeMeta?.tokenLimit ?? controllerMeta?.tokenLimit
    if (tokenLimitMeta && this.options.tokenLimit?.controller) {
      const result = await applyTokenLimitCheck(
        tokenLimitMeta,
        this.options.tokenLimit.controller,
        this.options.tokenLimit.configs || {},
        methodName,
        controllerTag,
        input,
        ctx,
        ctx.auth?.user,
      )
      tokenLimitEntries = result.entries
      ctx.tokenLimit = { entries: result.entries, remainingBalances: result.remainingBalances }
    }

    const cacheMeta = routeMeta?.cache ?? controllerMeta?.cache
    let cacheKey: string | null = null
    let cachedValue: unknown
    let cachedEntry: any
    let cacheHit = false
    if (cacheMeta && this.options.cache?.controller) {
      const cacheResult = await applyCacheCheck(
        cacheMeta,
        this.options.cache.controller,
        input,
        request.method,
        methodName,
        controllerTag,
        ctx.auth?.user,
      )
      cacheKey = cacheResult.cacheKey
      cacheHit = cacheResult.hit
      cachedValue = cacheResult.cachedValue
      cachedEntry = cacheResult.entry
      ctx.cache = { key: cacheKey, hit: cacheHit, stored: false }
    }

    try {
      let result: unknown
      if (cacheHit) {
        result = cachedValue
      } else {
        result = await this.runMiddlewareChain(
          middlewareContext,
          async () => await operation.boundMethod(input, ctx),
        )
        handlerWasCalled = true
        if (cacheMeta && cacheKey && cachedEntry && this.options.cache?.controller) {
          await applyCacheStore(cacheKey, cachedEntry, this.options.cache.controller, result)
          if (ctx.cache) {
            ctx.cache.stored = true
          }
        }
      }

      if (tokenLimitEntries.length > 0 && this.options.tokenLimit?.controller && handlerWasCalled) {
        const timing = {
          startMs: tokenStartMs,
          endMs: Date.now(),
          durationMs: Date.now() - tokenStartMs,
        }
        const responseCosts = await applyTokenLimitResponse(
          tokenLimitEntries,
          this.options.tokenLimit.controller,
          result,
          timing,
          input,
          200,
        )
        if (ctx.tokenLimit) {
          ctx.tokenLimit.timing = timing
          ctx.tokenLimit.responseCosts = responseCosts
        }
      }

      if (rateLimitEntries.length > 0 && this.options.rateLimit?.controller) {
        await applyRateLimitRefund(rateLimitEntries, this.options.rateLimit.controller, 200)
      }

      return result
    } catch (error: any) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500
      if (tokenLimitEntries.length > 0 && this.options.tokenLimit?.controller && handlerWasCalled) {
        const timing = {
          startMs: tokenStartMs,
          endMs: Date.now(),
          durationMs: Date.now() - tokenStartMs,
        }
        const failureCosts = await applyTokenLimitFailure(
          tokenLimitEntries,
          this.options.tokenLimit.controller,
          error,
          timing,
          input,
          statusCode,
        )
        if (ctx.tokenLimit) {
          ctx.tokenLimit.timing = timing
          ctx.tokenLimit.failureCosts = failureCosts
        }
      }

      if (rateLimitEntries.length > 0 && this.options.rateLimit?.controller) {
        await applyRateLimitRefund(rateLimitEntries, this.options.rateLimit.controller, statusCode)
      }
      throw error
    }
  }

  private buildErrorPayload(error: any): { message: string; data?: unknown; stack?: unknown } {
    const exposure = this.options.errorExposure ?? 'message'
    if (exposure === 'none') {
      return { message: 'Internal server error' }
    }
    if (exposure === 'message') {
      return {
        message: error?.message ?? 'Internal client-side server error',
        data: error instanceof HttpError ? error.data : undefined,
      }
    }
    return {
      message: error?.message ?? 'Internal client-side server error',
      data: error instanceof HttpError ? error.data : undefined,
      stack: error?.stack,
    }
  }

  private async runMiddlewareChain(
    context: ClientSideServerMiddlewareContext,
    finalHandler: () => Promise<unknown>,
  ): Promise<unknown> {
    let index = -1
    const dispatch = async (nextIndex: number): Promise<unknown> => {
      if (nextIndex <= index) {
        throw new Error('Client-side server middleware called next() multiple times')
      }
      index = nextIndex
      const middleware = this.middleware[nextIndex]
      if (!middleware) {
        return await finalHandler()
      }
      return await middleware(context, () => dispatch(nextIndex + 1))
    }
    return await dispatch(0)
  }

  private serializeValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map((item) => this.serializeValue(item))
    if (value && typeof value === 'object') {
      for (const [typeName, serializer] of Object.entries(this.options.serializers ?? {})) {
        if ((value as any).constructor?.name === typeName) {
          return this.serializeValue(serializer(value))
        }
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.serializeValue(item)]),
      )
    }
    return value
  }

  /**
   * Build a manifest of all file paths available from registered static folders.
   * Returns paths prefixed with their folder mount point (e.g. /assets/logo.png, /index.html).
   */
  private async buildStaticManifest(): Promise<{ folders: { name: string; paths: string[] }[]; allPaths: string[] }> {
    const folders: { name: string; paths: string[] }[] = []
    const allPaths: string[] = []
    for (const sf of this.staticFolders) {
      let filePaths: string[]
      try {
        filePaths = await sf.folder.listAllFiles()
      } catch {
        filePaths = []
      }
      const prefixed = sf.name === 'root'
        ? filePaths.map(p => '/' + p)
        : filePaths.map(p => '/' + sf.name + '/' + p)
      folders.push({ name: sf.name, paths: prefixed })
      allPaths.push(...prefixed)
    }
    return { folders, allPaths }
  }

  /**
   * Try to resolve a request path against registered static folders.
   * Returns FileResponse if matched, null if matched but file not found, undefined if no folder matched.
   */
  private async resolveStaticFolder(path: string): Promise<FileResponse | null | undefined> {
    const normalized = path.replace(/^\//, '')

    // Check named folders first (e.g. /assets/...)
    for (const sf of this.staticFolders) {
      if (sf.name === 'root') continue
      const prefix = sf.name + '/'
      if (normalized === sf.name || normalized.startsWith(prefix)) {
        const subPath = normalized === sf.name ? '' : normalized.slice(prefix.length)
        const result = await sf.folder.resolve(subPath)
        return result // FileResponse or null
      }
    }

    // Check root folder last (lowest priority)
    for (const sf of this.staticFolders) {
      if (sf.name !== 'root') continue
      const result = await sf.folder.resolve(normalized)
      if (result) return result
    }

    return undefined // No static folder matched this path
  }

  private async serializeFileResponse(
    fileResponse: FileResponse,
    requestHeaders?: Record<string, string>,
  ): Promise<Record<string, any>> {
    const content = await fileResponse.getContent()
    const bytes: Uint8Array = typeof content === 'string' ? new TextEncoder().encode(content) : content

    const etag = await computeFileEtag(bytes)
    const headers: Record<string, string> = { ...fileResponse.headers, etag }
    if (fileResponse.maxAge !== undefined) {
      headers['cache-control'] = `public, max-age=${fileResponse.maxAge}`
    }

    const ifNoneMatch = readHeader(requestHeaders, 'if-none-match')
    if (ifNoneMatch && etagMatches(ifNoneMatch, etag)) {
      return {
        _type: 'file-not-modified',
        filename: fileResponse.filename,
        contentType: fileResponse.contentType,
        headers,
      }
    }

    return {
      _type: 'file',
      filename: fileResponse.filename,
      contentType: fileResponse.contentType,
      content: bytes,
      contentEncoding: 'binary',
      headers,
    }
  }

  private generateOpenAPISpec(): Record<string, any> {
    const paths: Record<string, any> = {}

    for (const tool of this.toolsStore.values()) {
      if ((tool as any).hidden) continue
      const method = tool.method.toLowerCase()
      const path = tool.path
      const operation: Record<string, any> = {
        operationId: tool.name,
        summary: tool.summary || tool.description,
        tags: tool.tags,
        responses: {
          '200': {
            description: 'Successful response',
            ...(tool.response_schema ? {
              content: { 'application/json': { schema: tool.response_schema } },
            } : {}),
          },
        },
      }

      const inputSchema = tool.input_schema
      if (inputSchema && Object.keys(inputSchema.properties ?? {}).length > 0) {
        if (method === 'get' || method === 'head' || method === 'delete') {
          operation.parameters = Object.entries(inputSchema.properties as Record<string, any>).map(
            ([name, schema]: [string, any]) => ({
              name,
              in: 'query',
              required: (inputSchema.required as string[] ?? []).includes(name),
              schema,
            }),
          )
        } else {
          operation.requestBody = {
            required: true,
            content: {
              'application/json': { schema: inputSchema },
            },
          }
        }
      }

      paths[path] = { ...(paths[path] ?? {}), [method]: operation }
    }

    return {
      openapi: '3.1.0',
      info: this.options.openapiInfo ?? {
        title: 'plat client-side server',
        version: '0.13.0',
      },
      paths,
    }
  }
}

function isRequestMessage(message: ClientSideServerMessage): message is ClientSideServerRequest {
  return 'method' in message && 'path' in message
}

export function createClientSideServer(
  options?: ClientSideServerOptions,
  ...ControllerClasses: (new () => any)[]
): PLATClientSideServer {
  return new PLATClientSideServer(options, ...ControllerClasses)
}

/**
 * Server-style alias for client-side server creation.
 * Mirrors `createServer(...)` naming from the Node server API.
 */
export const createServer = createClientSideServer

/** Stable JSON stringify with sorted keys — ensures same spec always produces same hash. */
function cssStableStringify(value: unknown): string {
  return JSON.stringify(cssSortValue(value))
}

function cssSortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cssSortValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, cssSortValue(v)]),
    )
  }
  return value
}


// ---------------------------------------------------------------------------
// File caching helpers
// ---------------------------------------------------------------------------

async function computeFileEtag(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle
  if (!subtle) {
    // Fallback: weak ETag from byte length only. Should not happen on Node 20+
    // or in any browser; included so this never throws in odd environments.
    return `W/"len-${bytes.byteLength}"`
  }
  const buffer = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new Uint8Array(bytes).buffer
  const digest = await subtle.digest("SHA-256", buffer)
  const view = new Uint8Array(digest)
  let hex = ""
  for (let i = 0; i < view.length; i += 1) hex += view[i]!.toString(16).padStart(2, "0")
  return `"${hex}"`
}

function readHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key]
  }
  return undefined
}

function etagMatches(ifNoneMatch: string, etag: string): boolean {
  // Honor `*` wildcard and comma-separated lists. Treat weak prefix (W/) as
  // equivalent for this comparison since we only emit strong tags.
  const candidates = ifNoneMatch.split(",").map((s) => s.trim()).filter(Boolean)
  if (candidates.includes("*")) return true
  return candidates.some((c) => c.replace(/^W\//, "") === etag.replace(/^W\//, ""))
}
