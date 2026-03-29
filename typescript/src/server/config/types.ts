import { AuthMode, CacheController, RateLimitConfigs, RateLimitController, TokenLimitConfigs, TokenLimitController } from "../../types"
import { Logger } from "./logger"
import type { InMemoryCallSessionController } from "../call-sessions"
import type { PLATServerProtocolPlugin } from "../protocol-plugin"


export interface AuthHandler {
    verify(mode: AuthMode, req: any, ctx: any): Promise<any> | any
}

export type Serializer = (value: any) => any


export interface CORSOptions {
    origin?: string | string[] | boolean | ((origin: string) => boolean)
    credentials?: boolean
    methods?: string[]
    headers?: string[]
    exposedHeaders?: string[]
    maxAge?: number
}

export interface FileQueueOptions {
    inbox: string
    outbox: string
    pollIntervalMs?: number
    archive?: string | false
}

export interface PLATServerOptions {
    /**
     * How much error information to expose to clients
     * - 'none': only { error: 'Internal server error' }
     * - 'message': { error: 'Original error message' }
     * - 'full': { error: message, stack, data, ... }
     */
    errorExposure?: 'none' | 'message' | 'full'

    /**
     * Custom serializers for non-standard types
     * Applied after default Date/DateTime serialization
     */
    serializers?: Record<string, Serializer>

    /**
     * CORS configuration
     */
    cors?: CORSOptions | boolean

    /**
     * Default response headers
     */
    headers?: Record<string, string>

    /**
     * Hook called for each incoming request
     */
    onRequest?: (req: any, res: any, path: string, method: string) => void | Promise<void>

    /**
     * Hook called for each successful response
     */
    onResponse?: (req: any, res: any, statusCode: number, result: any) => void | Promise<void>

    /**
     * Hook called when an error occurs
     */
    onError?: (req: any, res: any, error: Error, statusCode: number) => void | Promise<void>

    /**
     * Hook to handle uncaught exceptions
     * Return true to prevent default error response
     */
    handleError?: (req: any, res: any, error: Error) => boolean | Promise<boolean>

    /**
     * Port to listen on
     */
    port?: number

    /**
     * Host to listen on (default: 'localhost')
     */
    host?: string

    /**
     * Protocol for logging (default: 'http')
     */
    protocol?: string

    /**
     * RPC/WebSocket transport configuration
     * - true: enable RPC websocket endpoint at /rpc
     * - string: mount at specified path
     * - false: disable
     */
    rpc?: boolean | string

    /**
     * OpenAPI specification for Swagger/ReDoc docs
     */
    openapi?: any

    /**
     * Enable automatic Swagger UI (default: true if openapi provided)
     * - true: mount at /docs
     * - string: mount at specified path (e.g. '/api-docs')
     * - false: disable
     */
    swagger?: boolean | string

    /**
     * Enable automatic ReDoc (default: true if openapi provided)
     * - true: mount at /redoc
     * - string: mount at specified path (e.g. '/api-redoc')
     * - false: disable
     */
    redoc?: boolean | string

    /**
     * URL path redirects, e.g. { '/': '/docs' }
     */
    redirects?: Record<string, string>

    /**
     * Logger instance (defaults to console-based logger)
     */
    logger?: Logger

    /**
     * Authentication handler for verifying auth modes
     */
    auth?: AuthHandler

    /**
     * Default auth mode for all routes (can be overridden per-controller or per-route)
     * Default: 'public' (no auth required)
     */
    defaultAuth?: AuthMode

    /**
     * Rate limiting configuration
     */
    rateLimit?: {
        controller?: RateLimitController
        configs?: RateLimitConfigs
        // On 429: true = both headers; false/omit = no headers; object for granular control
        retryAfterHeaders?: boolean | { delay?: boolean; retryAt?: boolean }
    }

    /**
     * Token limiting configuration
     */
    tokenLimit?: {
        controller?: TokenLimitController
        configs?: TokenLimitConfigs
        retryAfterHeaders?: boolean | { delay?: boolean; retryAt?: boolean }
        // Include X-Token-Cost header in all responses (default: true)
        responseCostHeader?: boolean
    }

    /**
     * Caching configuration
     */
    cache?: {
        controller?: CacheController
        // Include X-Cache header (true/false) in all responses (default: true)
        cacheHeader?: boolean
    }

    /**
     * Custom route options validation
     * Called for each route to validate any custom keys in RouteOpts
     * Throw an error to reject invalid options
     */
    validateRouteOpts?: (opts: Record<string, any>, methodName: string, path: string) => void | Promise<void>

    /**
     * Method prefix configuration
     * Enforce specific method prefixes (get, list, create, etc.)
     * - '*': Allow any prefix (default, recommended)
     * - Array of strings: Only allow these prefixes (e.g., ['get', 'list', 'create'])
     */
    allowedMethodPrefixes?: '*' | string[]

    /**
     * Disallowed method prefixes
     * Forbid specific method prefixes (e.g., 'fetch', 'search')
     * Default: [] (none disallowed)
     */
    disAllowedMethodPrefixes?: string[]

    /**
     * Parameter name coercions/aliases
     * Maps parameter names to their canonical forms
     * - Key: alternative name (e.g., 'query')
     * - Value: canonical name (e.g., 'q')
     * Automatically filters out identity mappings (e.g., 'q' -> 'q')
     * Default: { query: 'q', search: 'q', format: 'fmt' }
     */
    paramCoercions?: Record<string, string>

    /**
     * Disallowed parameter names in handlers
     * Throws error if a handler uses these parameter names
     * Forces use of canonical names instead
     * Default: [] (none disallowed)
     * Example: ['search'] forces use of 'q' instead
     */
    disAllowedParams?: string[]

    /**
     * Deferred HTTP call sessions for long-running operations.
     */
    calls?: {
        controller?: InMemoryCallSessionController
        path?: string
    }

    /**
     * Optional file-based request/response transport.
     * Reads JSON requests from inbox and writes JSON responses to outbox.
     */
    fileQueue?: FileQueueOptions | false

    /**
     * Extra protocol plugins. Built-in HTTP/WS/file behavior still works by default.
     */
    protocolPlugins?: PLATServerProtocolPlugin[]
}
