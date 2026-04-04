import express, {Express, NextFunction, Request, Response} from "express";
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import {applyRateLimitCheck, applyRateLimitRefund, createInMemoryRateLimit} from "./rate-limit";
import {
    applyTokenLimitCheck,
    applyTokenLimitFailure,
    applyTokenLimitResponse,
    createInMemoryTokenLimit
} from "./token-limit";
import {applyCacheCheck, applyCacheStore, createInMemoryCache} from "./cache";
import {formatTool} from "./tools";
import swaggerUi from "swagger-ui-express";
import redocExpress from "redoc-express";
import {normalizeParameters} from "./param-aliases";
import {HttpError, type ResolvedRateLimitEntry, type ResolvedTokenLimitEntry, type RouteContext, type ToolFormat} from "../types";
import {generateRouteHelp, isHelpRequested} from "./help";
import {CORSOptions, DEFAULT_OPTIONS, defaultLogger, Logger, PLATServerOptions } from "./config";
import { DEFAULT_RPC_PATH } from '../rpc';
import { InMemoryCallSessionController } from "./call-sessions";
import type { PLATServerCallEnvelope, PLATServerResolvedOperation } from './transports'
import type { PLATServerHostContext, PLATServerTransportRuntime } from './protocol-plugin'
import { createRpcProtocolPlugin, type RpcProtocolPluginOptions } from './rpc-protocol-plugin'
import { createFileQueueProtocolPlugin } from './file-queue-protocol-plugin'
import { PLATOperationRegistry } from './operation-registry'
import { PLATServerCore } from './core'

interface OperationExecutionResult {
    kind: 'success' | 'help'
    result: any
    statusCode: number
}


export class PLATServer {
    private app: Express
    private options: PLATServerOptions
    private logger: Logger
    private routes: Array<{ method: string; path: string; methodName?: string }> = []
    private registeredMethodNames = new Set<string>()
    private registeredControllerNames = new Set<string>()
    private tools: Map<string, any> = new Map() // methodName -> ToolDefinition
    private operationRegistry = new PLATOperationRegistry()
    private core: PLATServerCore

    constructor(options: PLATServerOptions = {}, ...ControllerClasses: (new () => any)[]) {
        this.app = express()
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options,
        }
        this.logger = options.logger || defaultLogger
        this.core = new PLATServerCore({
            undecoratedMode: this.options.undecoratedMode,
            allowedMethodPrefixes: this.options.allowedMethodPrefixes,
            disAllowedMethodPrefixes: this.options.disAllowedMethodPrefixes,
            validateRouteOpts: this.options.validateRouteOpts,
        }, {
            routes: this.routes,
            tools: this.tools,
            operationRegistry: this.operationRegistry,
            registeredMethodNames: this.registeredMethodNames,
            registeredControllerNames: this.registeredControllerNames,
        })

        // Filter out identity mappings from paramCoercions (where key === value)
        if (this.options.paramCoercions) {
            const filtered: Record<string, string> = {}
            for (const [key, value] of Object.entries(this.options.paramCoercions)) {
                if (key !== value) {
                    filtered[key] = value
                }
            }
            this.options.paramCoercions = filtered
        }

        // Lazy-init default controllers if plugins are enabled but no controller provided
        if (this.options.rateLimit && !this.options.rateLimit.controller) {
            this.options.rateLimit.controller = createInMemoryRateLimit()
        }
        if (this.options.tokenLimit && !this.options.tokenLimit.controller) {
            this.options.tokenLimit.controller = createInMemoryTokenLimit()
        }
        if (this.options.cache && !this.options.cache.controller) {
            this.options.cache.controller = createInMemoryCache()
        }
        if (this.options.calls && !this.options.calls.controller) {
            this.options.calls.controller = new InMemoryCallSessionController()
        }

        // Setup middleware
        this.setupMiddleware()

        // Auto-register controllers passed to constructor
        for (const ControllerClass of ControllerClasses) {
            this.register(ControllerClass)
        }
    }

    /**
     * Setup Express middleware
     */
    private setupMiddleware(): void {
        // Body parser
        this.app.use(express.json())
        this.app.use(express.urlencoded({ extended: true }))

        // CORS
        if (this.options.cors) {
            this.app.use(this.createCORSMiddleware(this.options.cors))
        }

        // Default headers
        if (this.options.headers && Object.keys(this.options.headers).length > 0) {
            this.app.use((req: Request, res: Response, next: NextFunction) => {
                Object.entries(this.options.headers || {}).forEach(([key, value]) => {
                    res.setHeader(key, value)
                })
                next()
            })
        }

        // Custom response JSON serializer
        this.app.set('json replacer', (key: string, value: any) => {
            // Default Date/DateTime serialization
            if (value instanceof Date) {
                return value.toISOString()
            }

            // Apply custom serializers
            if (this.options.serializers) {
                for (const [typeName, serializer] of Object.entries(this.options.serializers)) {
                    if (value && typeof value === 'object' && value.constructor.name === typeName) {
                        return serializer(value)
                    }
                }
            }

            return value
        })

        // Setup documentation UI
        this.setupDocumentation()
        this.setupCallRoutes()

        // Setup redirects
        if (this.options.redirects) {
            for (const [from, to] of Object.entries(this.options.redirects)) {
                this.app.get(from, (req: Request, res: Response) => {
                    res.redirect(to)
                })
            }
        }
    }

    /**
     * Setup Swagger UI and ReDoc
     */
    private setupDocumentation(): void {
        // Always serve OpenAPI spec (even if empty)
        this.app.get('/openapi.json', (req: Request, res: Response) => {
            if (this.options.openapi) {
                res.json(this.options.openapi)
            } else {
                res.status(404).json({ error: 'OpenAPI spec not available' })
            }
        })

        // List all available endpoints
        this.app.get('/endpoints', (req: Request, res: Response) => {
            const filtered = this.filterRoutes(this.routes, req.query)

            // Format as array of one-line strings
            if (req.query.format === 'json') {
                res.json({
                    count: filtered.length,
                    endpoints: filtered.map(r => ({
                        method: r.method,
                        path: r.path,
                        params: this.extractPathParams(r.path),
                        methodName: r.methodName,
                    })),
                })
            } else {
                // Default: plain text format
                const lines = filtered.map(r => this.formatRoute(r))
                res.type('text/plain').send(lines.join('\n'))
            }
        })

        // JQ-like filtering of OpenAPI spec
        this.app.get('/openapi-jq', (req: Request, res: Response) => {
            if (!this.options.openapi) {
                return res.status(404).json({ error: 'OpenAPI spec not available' })
            }

            const filter = req.query.filter as string | undefined
            const result = filter ? this.applyJsonFilter(this.options.openapi, filter) : this.options.openapi

            res.json(result)
        })

        // Quick route listing by HTTP method
        const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
        for (const method of httpMethods) {
            this.app.get(`/routes/${method}`, (req: Request, res: Response) => {
                const methodUpper = method.toUpperCase()
                const filtered = this.routes.filter(r => r.method === methodUpper)
                const paths = filtered.map(r => r.path)
                res.type('text/plain').send(paths.join('\n'))
            })
        }

        // General help endpoint
        this.app.get('/help', (req: Request, res: Response) => {
            const help = {
                endpoints: {
                    'GET /endpoints': 'List all available API endpoints with descriptions',
                    'GET /endpoints?method=POST': 'Filter endpoints by HTTP method',
                    'GET /endpoints?search=users': 'Search endpoints by path or name',
                    'GET /endpoints?format=json': 'Get endpoints as JSON with details',
                    'GET /routes/get': 'List all GET endpoints (paths only)',
                    'GET /routes/post': 'List all POST endpoints (paths only)',
                    'GET /routes/put': 'List all PUT endpoints (paths only)',
                    'GET /routes/patch': 'List all PATCH endpoints (paths only)',
                    'GET /routes/delete': 'List all DELETE endpoints (paths only)',
                },
                documentation: {
                    'GET /openapi.json': 'OpenAPI specification',
                    'GET /openapi-jq?filter=.paths': 'Filter OpenAPI spec with JQ-like syntax',
                    'GET /docs': 'Swagger UI documentation',
                    'GET /redoc': 'ReDoc documentation',
                    'GET /platCallStatus?id=...': 'Inspect a deferred HTTP call session',
                    'GET /platCallEvents?id=...': 'Read deferred HTTP call events/logs',
                    'GET /platCallResult?id=...': 'Read the final result for a deferred HTTP call',
                    'POST /platCallCancel': 'Cancel a deferred HTTP call by id',
                },
                queryParameters: {
                    endpoints: {
                        method: 'Filter by HTTP method (GET, POST, etc.)',
                        search: 'Search in path and method name (case-insensitive)',
                        q: 'Alias for search',
                        path: 'Filter by path prefix',
                        format: 'Output format: "json" or plain text (default)',
                    },
                    routes: {
                        help: 'Show help for a specific endpoint (e.g., ?help=true)',
                    },
                    openapi_jq: {
                        filter: 'JQ-like filter (e.g., ".paths", ".info", ".paths.*.post")',
                    },
                },
                examples: [
                    'curl http://localhost:3000/endpoints',
                    'curl "http://localhost:3000/endpoints?method=POST"',
                    'curl "http://localhost:3000/endpoints?search=user"',
                    'curl "http://localhost:3000/endpoints?format=json"',
                    'curl "http://localhost:3000/openapi-jq?filter=.paths"',
                    'curl "http://localhost:3000/api/users?help=true"',
                ],
            }

            res.json(help)
        })

        // List all tools in requested format (Claude, OpenAI, or schema)
        // Optional: ?method=methodName to filter to single tool
        // Optional: ?fmt=claude|openai|schema (default: claude)
        this.app.get('/tools', (req: Request, res: Response) => {
            const fmt = (req.query.fmt as string) || 'claude'
            const methodFilter = req.query.method as string | undefined

            if (methodFilter) {
                // Single tool
                const tool = this.tools.get(methodFilter)
                if (!tool || !this.matchesToolQuery(tool, req.query as Record<string, unknown>)) {
                    return res.status(404).json({ error: `Tool '${methodFilter}' not found` })
                }
                return res.json(formatTool(tool, fmt as ToolFormat))
            }

            // All tools
            const tools = Array.from(this.tools.values())
                .filter(tool => this.matchesToolQuery(tool, req.query as Record<string, unknown>))
                .map(tool => formatTool(tool, fmt as ToolFormat))
            res.json(tools)
        })

        if (!this.options.openapi) {
            return
        }

        this.mountDocUI()
    }

    /**
     * Mount Swagger UI and ReDoc based on current options.
     */
    private mountDocUI(): void {
        const swaggerPath = this.options.swagger === true ? '/docs' : typeof this.options.swagger === 'string' ? this.options.swagger : null
        const redocPath = this.options.redoc === true ? '/redoc' : typeof this.options.redoc === 'string' ? this.options.redoc : null

        if (swaggerPath) {
            this.app.use(swaggerPath, swaggerUi.serve)
            this.app.get(swaggerPath, swaggerUi.setup(this.options.openapi))
        }

        if (redocPath) {
            this.app.get(
                redocPath,
                redocExpress({
                    title: 'API Documentation',
                    specUrl: '/openapi.json',
                }),
            )
        }
    }

    /**
     * Setup docs UI after auto-generating the OpenAPI spec.
     * Mounts Swagger UI at /docs and ReDoc at /redoc by default.
     */
    private setupAutoDocumentation(): void {
        if (!this.options.swagger && this.options.swagger !== false) {
            this.options.swagger = true
        }
        if (!this.options.redoc && this.options.redoc !== false) {
            this.options.redoc = true
        }
        this.mountDocUI()
    }

    /**
     * Reserved method names that conflict with plat system features
     */
    private static readonly RESERVED_METHOD_NAMES = ['tools', 'routes', 'endpoints', 'help', 'openapi']

    private matchesToolQuery(tool: any, query: Record<string, unknown>): boolean {
        const includeHidden = query.includeHidden === 'true' || query.includeHidden === true
        if (tool.hidden && !includeHidden) return false

        const controller = typeof query.controller === 'string' ? query.controller : undefined
        if (controller && tool.controller !== controller) return false

        const tag = typeof query.tag === 'string' ? query.tag : undefined
        if (tag && !(Array.isArray(tool.tags) && tool.tags.includes(tag))) return false

        const safeOnly = query.safeOnly === 'true' || query.safeOnly === true
        if (safeOnly && tool.safe !== true) return false

        const longRunning = query.longRunning === 'true' || query.longRunning === true
        if (longRunning && tool.longRunning !== true) return false

        return true
    }

    /**
     * Extract the prefix from a method name (e.g., 'get' from 'getUser')
     * Finds the longest known prefix or the first camelCase word
     */
    private extractMethodPrefix(methodName: string): string | null {
        // Standard prefixes first (in descending length order for accurate matching)
        const standardPrefixes = ['create', 'update', 'delete', 'list', 'find', 'send', 'get', 'do']
        for (const prefix of standardPrefixes) {
            if (methodName.startsWith(prefix) && methodName.length > prefix.length) {
                // Check that next char is uppercase (e.g., 'getUser' matches, 'get' doesn't)
                const nextChar = methodName.charAt(prefix.length)
                if (nextChar === nextChar.toUpperCase()) {
                    return prefix
                }
            }
        }

        // If no standard prefix matches, extract first camelCase word
        // Find the first uppercase letter (after position 0)
        for (let i = 1; i < methodName.length; i++) {
            const char = methodName.charAt(i)
            if (char === char.toUpperCase() && char !== char.toLowerCase()) {
                // Found the camelCase boundary
                return methodName.substring(0, i)
            }
        }

        // No camelCase boundary found - entire name is the prefix
        return methodName.length > 0 ? methodName : null
    }

    /**
     * Validate that a method name follows plat style conventions
     *
     * Rules (ENFORCED):
     * - Must start with a lowercase letter
     * - Cannot contain underscores
     * - Must be valid camelCase
     * - Cannot be a reserved name (tools, routes, endpoints, help, openapi)
     * - Cannot match a controller name
     * - Must respect allowedMethodPrefixes/disAllowedMethodPrefixes config
     *
     * Recommendations (NOT enforced):
     * - Use standard prefixes for CRUD: get, list, find, create, update, delete
     * - Use send/do for external I/O operations
     * - Use natural names for action commands (e.g., addToCart, checkout, importFile)
     */
    private validateMethodName(methodName: string, controllerName: string): void {
        if (!methodName || methodName.length === 0) {
            return // Skip validation for empty names
        }

        const firstChar = methodName.charAt(0)

        // Check for uppercase first letter
        if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
            throw new Error(
                `Method '${methodName}' in ${controllerName} violates plat naming convention: ` +
                `method names must start with a lowercase letter. ` +
                `Use '${firstChar.toLowerCase()}${methodName.slice(1)}' instead.`
            )
        }

        // Check for underscores
        if (methodName.includes('_')) {
            const camelCase = methodName.replace(/_([a-z])/g, (_, char) => char.toUpperCase())
            throw new Error(
                `Method '${methodName}' in ${controllerName} violates plat naming convention: ` +
                `underscores are not allowed. Use camelCase instead. ` +
                `Use '${camelCase}' instead.`
            )
        }

        // Check for reserved names
        if (PLATServer.RESERVED_METHOD_NAMES.includes(methodName.toLowerCase())) {
            throw new Error(
                `Method '${methodName}' in ${controllerName} uses a reserved plat system name. ` +
                `Reserved names: ${PLATServer.RESERVED_METHOD_NAMES.join(', ')}. ` +
                `Choose a different method name.`
            )
        }

        // Check allowedMethodPrefixes configuration
        if (this.options.allowedMethodPrefixes && this.options.allowedMethodPrefixes !== '*') {
            const prefix = this.extractMethodPrefix(methodName)
            if (prefix && !this.options.allowedMethodPrefixes.includes(prefix)) {
                throw new Error(
                    `Method '${methodName}' in ${controllerName} uses disallowed prefix '${prefix}'. ` +
                    `Allowed prefixes: ${this.options.allowedMethodPrefixes.join(', ')}. ` +
                    `Rename the method to use an allowed prefix.`
                )
            }
        }

        // Check disAllowedMethodPrefixes configuration
        if (this.options.disAllowedMethodPrefixes && this.options.disAllowedMethodPrefixes.length > 0) {
            const prefix = this.extractMethodPrefix(methodName)
            if (prefix && this.options.disAllowedMethodPrefixes.includes(prefix)) {
                throw new Error(
                    `Method '${methodName}' in ${controllerName} uses disallowed prefix '${prefix}'. ` +
                    `Disallowed prefixes: ${this.options.disAllowedMethodPrefixes.join(', ')}. ` +
                    `Rename the method to use a different prefix.`
                )
            }
        }
    }

    /**
     * Register a controller class
     *
     * Extracts all @GET, @POST, etc. decorated methods and sets up routing.
     * In plat, routes are 100% flat: method names become routes at the root level.
     * No path parameters in decorators - all routing is done by method names.
     */
    register(...ControllerClasses: (new () => any)[]): PLATServer {
        for (const registered of this.core.registerControllers(...ControllerClasses)) {
                const { operation: rpcOperation, route } = registered
                const { methodName, path: fullPath } = route
                const httpMethod = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
                const routeMeta = rpcOperation.routeMeta
                const handler = async (req: Request, res: Response) => {
                    let input: Record<string, any> = {
                        ...req.params,
                        ...req.query,
                        ...(req.body && typeof req.body === 'object' ? req.body : {}),
                    }

                    // Normalize parameter aliases (query → q, format → fmt, page/pageSize → limit/offset)
                    // Also validates against disAllowedParams from config
                    input = normalizeParameters(input, this.options.paramCoercions, this.options.disAllowedParams)

                    const ctx: RouteContext = {
                        method: req.method,
                        url: req.path,
                        headers: req.headers as Record<string, string | string[]>,
                        opts: routeMeta?.opts,
                        request: req,
                        response: res,
                    }
                    const helpRequested = isHelpRequested(req.query.help, 'help' in req.query)
                    const wantsDeferred = !helpRequested && this.isDeferredExecutionRequested(req)

                    try {
                        if (wantsDeferred && this.options.calls?.controller && this.options.calls.path) {
                            const session = this.options.calls.controller.create({
                                operationId: methodName,
                                method: req.method,
                                path: fullPath,
                            })
                            const abortController = new AbortController()
                            this.options.calls.controller.setCancel(session.id, () => abortController.abort())
                            this.attachCallContext(
                                ctx,
                                session.id,
                                'deferred',
                                abortController.signal,
                                async (event, data) => {
                                    this.options.calls?.controller?.appendEvent(session.id, event, this.serializeRpcValue(data))
                                },
                            )

                            res.status(202).json({
                                id: session.id,
                                status: session.status,
                                statusPath: `${this.options.calls.path}Status?id=${encodeURIComponent(session.id)}`,
                                eventsPath: `${this.options.calls.path}Events?id=${encodeURIComponent(session.id)}`,
                                resultPath: `${this.options.calls.path}Result?id=${encodeURIComponent(session.id)}`,
                                cancelPath: `${this.options.calls.path}Cancel`,
                            })

                            const deferredEnvelope: PLATServerCallEnvelope = {
                                protocol: 'http',
                                method: req.method,
                                path: fullPath,
                                headers: req.headers as Record<string, string>,
                                input,
                                ctx,
                                operationId: methodName,
                                req,
                                res,
                                allowHelp: false,
                                helpRequested: false,
                            }

                            void (async () => {
                                try {
                                    this.options.calls?.controller?.start(session.id)
                                    const execution = await this.dispatchTransportCall(rpcOperation, deferredEnvelope)
                                    this.options.calls?.controller?.complete(
                                        session.id,
                                        this.serializeRpcValue(execution.result),
                                        execution.statusCode,
                                    )
                                } catch (err: any) {
                                    const statusCode = err instanceof HttpError ? err.statusCode : 500
                                    this.options.calls?.controller?.fail(session.id, {
                                        message: err?.message ?? 'Internal server error',
                                        statusCode,
                                        data: err instanceof HttpError ? err.data : undefined,
                                    })
                                }
                            })()
                            return
                        }

                        const execution = await this.dispatchTransportCall(rpcOperation, {
                            protocol: 'http',
                            method: req.method,
                            path: fullPath,
                            headers: req.headers as Record<string, string>,
                            input,
                            ctx,
                            operationId: methodName,
                            req,
                            res,
                            allowHelp: true,
                            helpRequested,
                        })

                        this.applyResponseHeaders(res, ctx)

                        if (!res.headersSent) {
                            if (execution.kind === 'help') {
                                res.status(200).json(execution.result)
                            } else if (execution.statusCode === 204 || execution.result === undefined) {
                                res.status(execution.statusCode === 200 ? 204 : execution.statusCode).end()
                            } else {
                                res.status(execution.statusCode).json(execution.result)
                            }
                        }
                    } catch (err: any) {
                        const isHttpError = err instanceof HttpError
                        const statusCode = isHttpError ? err.statusCode : 500
                        const message = isHttpError ? err.message : 'Internal server error'

                        this.logger.error(`[Error ${statusCode}] ${message}`, err)

                        this.applyRetryAfterHeaders(res, err)

                        // Call onError hook
                        if (this.options.onError) {
                            await this.options.onError(req, res, err, statusCode)
                        }

                        // Build error response based on exposure level
                        if (!res.headersSent) {
                            const errorResponse = this.buildErrorResponse(err, statusCode)
                            res.status(statusCode).json(errorResponse)
                        }
                    }
                }

                // Register route with Express (canonical route)
                this.app[httpMethod](fullPath, handler)

                for (const variant of registered.variants) {
                    this.app[variant.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](variant.path, handler)
                }
        }
        return this
    }

    /**
     * Add Express middleware
     */
    use(...args: any[]): PLATServer {
        this.app.use(...args)
        return this;
    }

    /**
     * Create CORS middleware
     */
    private createCORSMiddleware(corsConfig: CORSOptions | boolean): any {
        const config: CORSOptions =
            corsConfig === true
                ? { origin: '*', credentials: false }
                : corsConfig === false
                    ? { origin: '*', credentials: false }
                    : corsConfig

        return (req: Request, res: Response, next: NextFunction) => {
            const origin =
                typeof config.origin === 'string'
                    ? config.origin
                    : Array.isArray(config.origin)
                        ? config.origin[0] ?? '*'
                        : '*'

            res.setHeader('Access-Control-Allow-Origin', origin)

            if (config.credentials) {
                res.setHeader('Access-Control-Allow-Credentials', 'true')
            }

            if (config.methods) {
                res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '))
            }

            if (config.headers) {
                res.setHeader('Access-Control-Allow-Headers', config.headers.join(', '))
            }

            if (config.exposedHeaders) {
                res.setHeader('Access-Control-Expose-Headers', config.exposedHeaders.join(', '))
            }

            if (config.maxAge) {
                res.setHeader('Access-Control-Max-Age', String(config.maxAge))
            }

            if (req.method === 'OPTIONS') {
                res.status(200).end()
                return
            }

            next()
        }
    }

    /**
     * Extract path parameters from a path string
     * e.g., "/users/:id/posts/:postId" -> ["id", "postId"]
     */
    private extractPathParams(path: string): string[] {
        const matches = path.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)
        if (!matches) return []
        return matches.map(m => m.slice(1))
    }

    /**
     * Apply basic JQ-like filtering to JSON
     * Supports: .key, .key.nested, .[index], .*, .[]
     */
    private applyJsonFilter(obj: any, filter: string): any {
        if (!filter || filter === '.') return obj

        const parts = filter.split('.').filter(p => p)
        let current = obj

        for (const part of parts) {
            if (!current) return undefined

            if (part === '*') {
                // Return all values
                if (Array.isArray(current)) return current
                if (typeof current === 'object') return Object.values(current)
                return undefined
            } else if (part === '[]') {
                // Return as array if object
                return Array.isArray(current) ? current : [current]
            } else if (/^\[(\d+)\]$/.test(part)) {
                // Array index access
                const idx = parseInt(part.slice(1, -1), 10)
                current = Array.isArray(current) ? current[idx] : undefined
            } else {
                // Property access
                current = current[part]
            }
        }

        return current
    }

    /**
     * Format a single route for display
     * e.g., "GET /users/{id} - list user posts"
     */
    private formatRoute(route: { method: string; path: string; methodName?: string }): string {
        const params = this.extractPathParams(route.path)
        const paramStr = params.length > 0 ? ` {${params.join(',')}}` : ''
        const desc = route.methodName ? ` - ${route.methodName}` : ''
        return `${route.method.padEnd(6)} ${route.path}${paramStr}${desc}`
    }

    /**
     * Filter routes based on query parameters
     */
    private filterRoutes(
        routes: Array<{ method: string; path: string; methodName?: string }>,
        query: Record<string, any>
    ): Array<{ method: string; path: string; methodName?: string }> {
        let filtered = routes

        // Filter by HTTP method
        if (query.method) {
            const methodFilter = String(query.method).toUpperCase()
            filtered = filtered.filter(r => r.method === methodFilter)
        }

        // Filter by search term (in path or method name)
        if (query.search || query.q) {
            const searchTerm = String(query.search || query.q).toLowerCase()
            filtered = filtered.filter(r =>
                r.path.toLowerCase().includes(searchTerm) ||
                r.methodName?.toLowerCase().includes(searchTerm)
            )
        }

        // Filter by path prefix
        if (query.path) {
            const pathPrefix = String(query.path)
            filtered = filtered.filter(r => r.path.startsWith(pathPrefix))
        }

        return filtered
    }

    private setupCallRoutes(): void {
        const controller = this.options.calls?.controller
        const basePath = this.options.calls?.path
        if (!controller || !basePath) return
        const statusPath = `${basePath}Status`
        const eventsPath = `${basePath}Events`
        const resultPath = `${basePath}Result`
        const cancelPath = `${basePath}Cancel`

        this.app.get(statusPath, (req: Request, res: Response) => {
            const id = String(req.query.id ?? '')
            if (!id) {
                res.status(400).json({ error: 'Missing call id' })
                return
            }
            const session = controller.get(id)
            if (!session) {
                res.status(404).json({ error: 'Call session not found' })
                return
            }
            const { events: _events, ...summary } = session
            res.json(summary)
        })

        this.app.get(eventsPath, (req: Request, res: Response) => {
            const id = String(req.query.id ?? '')
            if (!id) {
                res.status(400).json({ error: 'Missing call id' })
                return
            }
            const session = controller.get(id)
            if (!session) {
                res.status(404).json({ error: 'Call session not found' })
                return
            }
            const since = Number(req.query.since ?? 0)
            const event = typeof req.query.event === 'string' ? req.query.event as any : undefined
            res.json({ events: controller.listEvents(id, Number.isFinite(since) ? since : 0, event) })
        })

        this.app.get(resultPath, (req: Request, res: Response) => {
            const id = String(req.query.id ?? '')
            if (!id) {
                res.status(400).json({ error: 'Missing call id' })
                return
            }
            const session = controller.get(id)
            if (!session) {
                res.status(404).json({ error: 'Call session not found' })
                return
            }
            const { events: _events, ...summary } = session
            const statusCode = session.status === 'completed'
                ? 200
                : session.status === 'failed'
                    ? (session.error?.statusCode ?? 500)
                    : session.status === 'cancelled'
                        ? 409
                        : 202
            res.status(statusCode).json(summary)
        })

        this.app.post(cancelPath, (req: Request, res: Response) => {
            const id = String(req.body?.id ?? req.query.id ?? '')
            if (!id) {
                res.status(400).json({ error: 'Missing call id' })
                return
            }
            const session = controller.get(id)
            if (!session) {
                res.status(404).json({ error: 'Call session not found' })
                return
            }
            res.json({ cancelled: controller.cancel(id) })
        })
    }

    /**
     * Build error response based on exposure level
     */
    private buildErrorResponse(error: any, statusCode: number): any {
        const exposure = this.options.errorExposure || 'message'

        if (exposure === 'none') {
            return { error: 'Internal server error' }
        }

        if (exposure === 'message') {
            return { error: error.message || 'Internal server error' }
        }

        // 'full' exposure
        const response: any = {
            error: error.message || 'Internal server error',
        }

        if (error instanceof HttpError && error.data) {
            response.data = error.data
        }

        if (error.stack) {
            response.stack = error.stack.split('\n')
        }

        return response
    }

    private isDeferredExecutionRequested(req: Request): boolean {
        const header = req.header('X-PLAT-Execution')
        return header === 'deferred' || req.query.execution === 'deferred'
    }

    private attachCallContext(
        ctx: RouteContext,
        sessionId: string,
        mode: 'rpc' | 'deferred',
        signal: AbortSignal,
        emit: (event: 'progress' | 'log' | 'chunk' | 'message', data?: unknown) => Promise<void> | void,
    ): void {
        const call = {
            id: sessionId,
            mode,
            signal,
            cancelled: () => signal.aborted,
            emit,
            progress: (data?: unknown) => emit('progress', data),
            log: (data?: unknown) => emit('log', data),
            chunk: (data?: unknown) => emit('chunk', data),
        }
        ctx.call = call
        if (mode === 'rpc') {
            ctx.rpc = call
        }
    }

    private applyResponseHeaders(res: Response, ctx: RouteContext): void {
        if (this.options.cache?.cacheHeader !== false) {
            const cacheValue = ctx.cache ? (ctx.cache.hit ? 'true' : 'false') : 'false'
            res.setHeader('X-Cache', cacheValue)
        }

        if (this.options.tokenLimit?.responseCostHeader !== false) {
            const totalCost = ctx.tokenLimit
                ? (ctx.tokenLimit.responseCosts || []).reduce((a, b) => a + b, 0)
                : 0
            res.setHeader('X-Token-Cost', String(totalCost))
        }
    }

    private applyRetryAfterHeaders(res: Response, err: any): void {
        if (!(err instanceof HttpError) || err.statusCode !== 429 || err.data?.retryAfterMs == null) {
            return
        }

        const rateLimitCfg = this.options.rateLimit?.retryAfterHeaders
        const tokenLimitCfg = this.options.tokenLimit?.retryAfterHeaders
        const cfg = rateLimitCfg || tokenLimitCfg
        if (!cfg) return

        const showDelay = cfg === true || (typeof cfg === 'object' && cfg.delay !== false)
        const showRetryAt = cfg === true || (typeof cfg === 'object' && cfg.retryAt !== false)
        if (showDelay) {
            res.setHeader('Retry-After', Math.ceil(err.data.retryAfterMs / 1000))
        }
        if (showRetryAt) {
            res.setHeader('X-Retry-At', new Date(Date.now() + err.data.retryAfterMs).toISOString())
        }
    }

    private async executeOperation(args: {
        methodName: string
        controllerTag: string
        fullPath: string
        transportMethod: string
        routeMeta: any
        controllerMeta: any
        boundMethod: Function
        input: Record<string, any>
        ctx: RouteContext
        req?: any
        res?: Response
        allowHelp: boolean
        helpRequested?: boolean
    }): Promise<OperationExecutionResult> {
        const {
            methodName,
            controllerTag,
            fullPath,
            transportMethod,
            routeMeta,
            controllerMeta,
            boundMethod,
            input,
            ctx,
            req,
            res,
            allowHelp,
            helpRequested = false,
        } = args

        const tokenStartMs = Date.now()
        let handlerWasCalled = false
        let rateLimitEntries: ResolvedRateLimitEntry[] = []
        let tokenLimitEntries: ResolvedTokenLimitEntry[] = []

        try {
            if (req && res && this.options.onRequest) {
                await this.options.onRequest(req, res, fullPath, transportMethod)
            }

            const authMode = routeMeta?.auth ?? controllerMeta?.auth ?? this.options.defaultAuth ?? 'public'
            if (authMode !== 'public' && this.options.auth) {
                const authRequest = req ?? { headers: ctx.headers ?? {} }
                const user = await this.options.auth.verify(authMode, authRequest, ctx)
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

            if (allowHelp && helpRequested) {
                const helpDoc = generateRouteHelp(
                    methodName,
                    fullPath,
                    transportMethod,
                    routeMeta,
                    controllerTag,
                )
                return {
                    kind: 'help',
                    statusCode: 200,
                    result: {
                        help: helpDoc,
                        auth: ctx.auth,
                    },
                }
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
            let cacheHit = false
            let cacheKey: string | null = null
            let cachedValue: any = undefined
            let cachedEntry: any = undefined

            if (cacheMeta && this.options.cache?.controller) {
                const cacheResult = await applyCacheCheck(
                    cacheMeta,
                    this.options.cache.controller,
                    input,
                    transportMethod,
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

            let result: any
            let statusCode = 200
            if (cacheHit) {
                result = cachedValue
            } else {
                result = await boundMethod(input, ctx)
                handlerWasCalled = true
                statusCode =
                    transportMethod === 'POST'
                        ? 201
                        : transportMethod === 'DELETE' && !result
                            ? 204
                            : 200

                if (cacheMeta && cacheKey && this.options.cache?.controller) {
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
                    statusCode,
                )
                if (ctx.tokenLimit) {
                    ctx.tokenLimit.timing = timing
                    ctx.tokenLimit.responseCosts = responseCosts
                }
            }

            if (rateLimitEntries.length > 0 && this.options.rateLimit?.controller) {
                await applyRateLimitRefund(rateLimitEntries, this.options.rateLimit.controller, statusCode)
            }

            if (req && res && this.options.onResponse) {
                await this.options.onResponse(req, res, statusCode, result)
            }

            return {
                kind: 'success',
                result,
                statusCode,
            }
        } catch (err: any) {
            const statusCode = err instanceof HttpError ? err.statusCode : 500

            if (tokenLimitEntries.length > 0 && this.options.tokenLimit?.controller && handlerWasCalled) {
                const timing = {
                    startMs: tokenStartMs,
                    endMs: Date.now(),
                    durationMs: Date.now() - tokenStartMs,
                }
                const failureCosts = await applyTokenLimitFailure(
                    tokenLimitEntries,
                    this.options.tokenLimit.controller,
                    err,
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

            throw err
        }
    }

    private resolveOperation(envelope: Pick<PLATServerCallEnvelope, 'operationId' | 'method' | 'path'>): PLATServerResolvedOperation | undefined {
        return this.operationRegistry.resolve(envelope)
    }

    private async dispatchTransportCall(
        operation: PLATServerResolvedOperation,
        envelope: PLATServerCallEnvelope,
    ): Promise<OperationExecutionResult> {
        return this.executeOperation({
            methodName: operation.methodName,
            controllerTag: operation.controllerTag,
            fullPath: operation.path,
            transportMethod: envelope.method,
            routeMeta: operation.routeMeta,
            controllerMeta: operation.controllerMeta,
            boundMethod: operation.boundMethod,
            input: envelope.input,
            ctx: envelope.ctx,
            req: envelope.req as any,
            res: envelope.res as any,
            allowHelp: envelope.allowHelp,
            helpRequested: envelope.helpRequested,
        })
    }

    createTransportRuntime(): PLATServerTransportRuntime {
        return {
            logger: this.logger,
            resolveOperation: (envelope) => this.resolveOperation(envelope),
            dispatch: async (operation, envelope) => this.dispatchTransportCall(operation, envelope),
            normalizeInput: (input) => normalizeParameters(
                input,
                this.options.paramCoercions,
                this.options.disAllowedParams,
            ),
            serializeValue: (value) => this.serializeRpcValue(value),
            createCallContext: ({ ctx, sessionId, mode, signal, emit }) => {
                const abortSignal = signal ?? new AbortController().signal
                this.attachCallContext(ctx, sessionId, mode, abortSignal, emit)
                return ctx.call
            },
            createEnvelope: ({ protocol, operation, input, headers = {}, ctx, requestId, req, res, allowHelp = false, helpRequested = false }) => ({
                protocol,
                method: operation.method,
                path: operation.path,
                headers,
                input,
                ctx,
                operationId: operation.methodName,
                requestId,
                req,
                res,
                allowHelp,
                helpRequested,
            }),
        }
    }

    private serializeRpcValue(value: any): any {
        if (value instanceof Date) return value.toISOString()
        if (Array.isArray(value)) return value.map((item) => this.serializeRpcValue(item))
        if (value && typeof value === 'object') {
            for (const [typeName, serializer] of Object.entries(this.options.serializers || {})) {
                if (value.constructor?.name === typeName) {
                    return this.serializeRpcValue(serializer(value))
                }
            }
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [key, this.serializeRpcValue(item)]),
            )
        }
        return value
    }

    /**
     * Get the underlying Express app
     */
    getApp(): Express {
        return this.app
    }

    /**
     * Listen on a port
     * Convenience method that starts the server
     */
    /**
     * Auto-generate an OpenAPI 3.1.0 spec from registered tool definitions.
     * Called by listen() when no explicit openapi option was provided.
     */
    private generateOpenAPISpec(): Record<string, any> {
        const paths: Record<string, any> = {}

        for (const [, tool] of this.tools) {
            const method = (tool.method as string).toLowerCase()
            const path = tool.path as string

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
            info: {
                title: 'plat API',
                version: '0.2.0',
            },
            paths,
        }
    }

    listen(
        port?: number,
        hostOrCallback?: string | (() => void),
        callbackIfHost?: () => void,
    ): PLATServer {
        // Auto-generate OpenAPI spec if not explicitly provided
        if (!this.options.openapi) {
            this.options.openapi = this.generateOpenAPISpec()
            this.setupAutoDocumentation()
        }

        const finalPort = port ?? this.options.port ?? 3000
        const finalHost = this.options.host ?? 'localhost'
        const finalProtocol = this.options.protocol ?? 'http'

        let userCallback: (() => void) | undefined
        if (typeof hostOrCallback === 'function') {
            userCallback = hostOrCallback
        } else if (typeof hostOrCallback === 'string') {
            userCallback = callbackIfHost
        }

        // Wrap the callback to print startup message and call user callback
        const wrappedCallback = () => {
            this.printStartupMessage(finalProtocol, finalHost, finalPort)
            if (userCallback) {
                userCallback()
            }
        }

        const server = createHttpServer(this.app)
        const hostContext: PLATServerHostContext = {
            kind: 'node-http',
            app: this.app,
            server,
            meta: {
                protocol: finalProtocol,
                host: finalHost,
                port: finalPort,
            },
        }
        const rpcOptions: RpcProtocolPluginOptions = {
            enabled: this.options.rpc ?? false,
        }
        const builtInPlugins = [
            createRpcProtocolPlugin(rpcOptions),
            createFileQueueProtocolPlugin({
                config: this.options.fileQueue || undefined,
            }),
        ]
        const transportRuntime = this.createTransportRuntime()
        const allPlugins = [...builtInPlugins, ...(this.options.protocolPlugins ?? [])]
        for (const plugin of allPlugins) {
            void plugin.setup?.(transportRuntime)
        }
        for (const plugin of allPlugins) {
            void plugin.attach?.(transportRuntime, hostContext)
            void plugin.start?.(transportRuntime)
        }
        server.listen(finalPort, finalHost, wrappedCallback)
        return this
    }

    /**
     * Print startup message with routes and documentation info
     */
    private printStartupMessage(protocol: string, host: string, port: number): void {
        const url = `${protocol}://${host}:${port}`
        this.logger.info(`✅ Server running at ${url}`)
        if (this.options.rpc !== false) {
            const rpcPath = typeof this.options.rpc === 'string' ? this.options.rpc : DEFAULT_RPC_PATH
            const rpcProtocol = protocol === 'https' ? 'wss' : 'ws'
            this.logger.info(`🔌 RPC:    ${rpcProtocol}://${host}:${port}${rpcPath}`)
        }
        if (this.options.calls?.path) {
            this.logger.info(`⏳ Calls:  ${url}${this.options.calls.path}Status?id=...`)
        }
        if (this.options.fileQueue) {
            this.logger.info(`📁 Queue:  ${this.options.fileQueue.inbox} -> ${this.options.fileQueue.outbox}`)
        }

        // Print documentation endpoints
        if (this.options.openapi) {
            const swaggerPath = this.options.swagger === true ? '/docs' : typeof this.options.swagger === 'string' ? this.options.swagger : null
            const redocPath = this.options.redoc === true ? '/redoc' : typeof this.options.redoc === 'string' ? this.options.redoc : null

            if (swaggerPath || redocPath) {
                this.logger.info('📚 Documentation:')
                if (swaggerPath) {
                    this.logger.info(`  Swagger: ${url}${swaggerPath}`)
                }
                if (redocPath) {
                    this.logger.info(`  ReDoc:   ${url}${redocPath}`)
                }
            }
        }

        // Print API endpoints
        if (this.routes.length > 0) {
            this.logger.info('API Endpoints:')
            const maxPathLength = Math.max(...this.routes.map((r) => r.path.length))
            for (const route of this.routes) {
                this.logger.info(`  ${route.method.padEnd(6)} ${route.path.padEnd(maxPathLength)}`)
            }
        }

        // Print curl example
        if (this.routes.length > 0) {
            const firstGetRoute = this.routes.find((r) => r.method === 'GET')
            if (firstGetRoute) {
                this.logger.info(`Try: curl ${url}${firstGetRoute.path}`)
            }
        }
    }
}

/**
 * Create a new plat server
 *
 * @example
 * ```typescript
 * const server = createServer({
 *   errorExposure: 'message',
 *   cors: true,
 *   onRequest: (req, res, path, method) => console.log(`${method} ${path}`)
 * })
 * server.register(ProductsApi)
 * server.register(OrdersApi)
 * server.listen(3000, () => console.log('Server running'))
 * ```
 */
export function createServer(options?: PLATServerOptions, ...ControllerClasses: (new () => any)[]): PLATServer {
    return new PLATServer(options, ...ControllerClasses)
}
