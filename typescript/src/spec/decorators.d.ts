import { HttpMethod } from "../types";
import type { AuthMode } from "../types/endpoints";
import type { RateLimitMeta, TokenLimitMeta, CacheMeta } from "../types/plugins";
export declare const ROUTE_METADATA_KEY: unique symbol;
export interface ControllerOpts {
    tag?: string;
    auth?: AuthMode;
    rateLimit?: RateLimitMeta;
    tokenLimit?: TokenLimitMeta;
    cache?: CacheMeta;
    [key: string]: any;
}
export interface RouteOpts {
    auth?: AuthMode;
    rateLimit?: RateLimitMeta;
    tokenLimit?: TokenLimitMeta;
    cache?: CacheMeta;
    [key: string]: any;
}
export declare const pendingRoutes: Map<any, {
    key: string | symbol;
    method: HttpMethod;
    opts?: RouteOpts;
}[]>;
/**
 * Controller decorator
 * Registers a controller class. No base path routing - all methods become flat routes named after the method.
 * The controller name is used only for OpenAPI tagging and documentation.
 *
 * @param controllerName - Name for documentation/OpenAPI tags (e.g., "orders", "users")
 * @param opts - Controller-level options (auth, rate limiting, etc.)
 */
export declare function Controller(controllerName?: string, opts?: ControllerOpts): ClassDecorator;
type RouteDecorator = (opts?: RouteOpts) => MethodDecorator;
export declare const GET: RouteDecorator;
export declare const POST: RouteDecorator;
export declare const PUT: RouteDecorator;
export declare const PATCH: RouteDecorator;
export declare const DELETE: RouteDecorator;
export {};
//# sourceMappingURL=decorators.d.ts.map