import {
    ensureControllerMeta,
    ensureRouteMeta,
} from './metadata'
import { HttpMethod } from "../types"
import type { AuthMode } from "../types/endpoints"
import type { RateLimitMeta, TokenLimitMeta, CacheMeta } from "../types/plugins"

export const ROUTE_METADATA_KEY = Symbol('plat:route')

export interface ControllerOpts {
    tag?: string
    auth?: AuthMode
    rateLimit?: RateLimitMeta
    tokenLimit?: TokenLimitMeta
    cache?: CacheMeta
    // Allow custom metadata keys for extensibility
    [key: string]: any
}

export interface RouteOpts {
    auth?: AuthMode
    rateLimit?: RateLimitMeta
    tokenLimit?: TokenLimitMeta
    cache?: CacheMeta
    // Allow custom metadata keys for extensibility
    [key: string]: any
}

// Store pending routes for the new decorator proposal (Stage 3)
// Exported so that register() can process them after instance creation
export const pendingRoutes = new Map<any, Array<{ key: string | symbol; method: HttpMethod; opts?: RouteOpts }>>()

/**
 * Controller decorator
 * Registers a controller class. No base path routing - all methods become flat routes named after the method.
 * The controller name is used only for OpenAPI tagging and documentation.
 *
 * @param controllerName - Name for documentation/OpenAPI tags (e.g., "orders", "users")
 * @param opts - Controller-level options (auth, rate limiting, etc.)
 */
export function Controller(
    controllerName?: string,
    opts: ControllerOpts = {},
): ClassDecorator {
    return (target: any) => {
        const meta = ensureControllerMeta(target as Function)
        // Use provided name or fall back to class name
        meta.basePath = controllerName || target.name
        meta.tag = opts.tag || controllerName || target.name
        meta.auth = opts.auth
        meta.rateLimit = opts.rateLimit
        meta.tokenLimit = opts.tokenLimit
        meta.cache = opts.cache

        // Scan methods for old decorator proposal (metadata on methods)
        for (const key of Object.getOwnPropertyNames(target.prototype)) {
            const method = target.prototype[key]
            if (typeof method === 'function' && method[ROUTE_METADATA_KEY]) {
                const { httpMethod, auth } = method[ROUTE_METADATA_KEY]
                const routeMeta = ensureRouteMeta(target as Function, key)
                routeMeta.method = httpMethod
                routeMeta.path = '/' + String(key)
                routeMeta.auth = auth
            }
        }

        // Note: Stage 3 decorator addInitializers will be processed in register()
        // after instance creation, since addInitializers run at that time
    }
}

function routeDecorator(
    method: HttpMethod,
    opts?: RouteOpts,
): MethodDecorator {
    return (target: any, propertyKey: any) => {

        // Handle new decorator proposal (Stage 3)
        // In the new proposal, propertyKey is a context object with kind === 'method'
        if (propertyKey && typeof propertyKey === 'object' && propertyKey.kind === 'method') {
            const methodName = propertyKey.name

            // Mark the method with route metadata through a different mechanism
            // Use addInitializer to register routes with the class metadata
            if (propertyKey.addInitializer) {
                propertyKey.addInitializer(function(this: any) {
                    const ctor = this.constructor
                    if (!pendingRoutes.has(ctor)) {
                        pendingRoutes.set(ctor, [])
                    }
                    pendingRoutes.get(ctor)!.push({
                        key: methodName,
                        method,
                        opts,
                    })
                })
            }
            return
        }

        // Handle old decorator proposal (Stage 1/2)
        if (target && typeof target === 'object' && target.constructor) {
            const ctor = target.constructor
            const key = propertyKey

            const method_fn = target[key]
            if (typeof method_fn === 'function') {
                method_fn[ROUTE_METADATA_KEY] = { httpMethod: method, auth: opts?.auth }
            }

            const meta = ensureRouteMeta(ctor as Function, key)
            if (!meta.method) {
                meta.method = method
                meta.path = '/' + String(key)
                meta.auth = opts?.auth
                meta.rateLimit = opts?.rateLimit
                meta.tokenLimit = opts?.tokenLimit
                meta.cache = opts?.cache
                meta.summary = opts?.summary
                meta.description = opts?.description
                // Store full opts for extensibility
                if (opts) {
                    meta.opts = opts
                }
            }
        }
    }
}

type RouteDecorator = (opts?: RouteOpts) => MethodDecorator

export const GET: RouteDecorator = (opts) => routeDecorator('GET', opts)
export const POST: RouteDecorator = (opts) => routeDecorator('POST', opts)
export const PUT: RouteDecorator = (opts) => routeDecorator('PUT', opts)
export const PATCH: RouteDecorator = (opts) => routeDecorator('PATCH', opts)
export const DELETE: RouteDecorator = (opts) => routeDecorator('DELETE', opts)
