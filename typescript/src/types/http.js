// ── Header types ──────────────────────────────────────────
/** Common MIME types for Content-Type / Accept headers. */
export const ContentTypes = {
    JSON: 'application/json',
    FORM: 'application/x-www-form-urlencoded',
    MULTIPART: 'multipart/form-data',
    TEXT: 'text/plain',
    HTML: 'text/html',
    CSV: 'text/csv',
    XML: 'application/xml',
    BINARY: 'application/octet-stream',
};
/** Common authorization schemes. */
export const AuthSchemes = {
    BEARER: 'Bearer',
    BASIC: 'Basic',
};
/** Common Cache-Control directives. */
export const CacheDirectives = {
    NO_CACHE: 'no-cache',
    NO_STORE: 'no-store',
    NO_TRANSFORM: 'no-transform',
    MAX_AGE_0: 'max-age=0',
};
// ── HTTP methods ──────────────────────────────────────────
export const HttpMethods = {
    GET: 'GET',
    POST: 'POST',
    PUT: 'PUT',
    PATCH: 'PATCH',
    DELETE: 'DELETE',
};
/** Property names reserved by the OpenAPIClient proxy system. */
export const ProxyProps = {
    ROOT: 'root',
    CLIENT: 'client',
    SPEC: 'spec',
    ROUTES: 'routes',
    CHILDREN: 'children',
    THEN: 'then',
};
/** OpenAPI parameter location values. */
export const ParamLocations = {
    QUERY: 'query',
    PATH: 'path',
    HEADER: 'header',
    COOKIE: 'cookie',
};
/**
 * All names reserved by the OpenAPIClient and its proxy system.
 * The plat server should reject routes/methods whose names collide with these.
 */
export const RESERVED_ROUTE_NAMES = [
    ...Object.values(ProxyProps),
    ...Object.values(HttpMethods).map(m => m.toLowerCase()),
    // Native function properties that the proxy falls through to
    'bind', 'call', 'apply', 'toString', 'valueOf',
    'constructor', 'prototype', 'length', 'name',
    'tools', 'buildHeaders',
];
//# sourceMappingURL=http.js.map