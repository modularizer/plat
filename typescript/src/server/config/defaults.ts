import { AuthMode, CacheController, RateLimitConfigs, RateLimitController, TokenLimitConfigs, TokenLimitController } from "../../types"
import { PLATServerOptions } from "./types"
import {defaultLogger} from "./logger"


export const DEFAULT_OPTIONS: PLATServerOptions = {
    errorExposure: 'message',
    serializers: {},
    cors: false,
    headers: {},
    port: 3000,
    host: 'localhost',
    protocol: 'http',
    rpc: true,
    swagger: true,
    redoc: true,
    logger: defaultLogger,
    // plat opinionated defaults: allow all prefixes, coerce common aliases
    allowedMethodPrefixes: '*', // Allow any prefix; set to array to restrict
    disAllowedMethodPrefixes: [], // Block specific prefixes
    paramCoercions: {
        // Automatically coerce common parameter aliases to canonical names
        query: 'q',
        search: 'q',
        format: 'fmt',
    },
    disAllowedParams: [], // Forbid specific parameter names
    calls: {
        path: '/platCall',
    },
    fileQueue: false,
}
