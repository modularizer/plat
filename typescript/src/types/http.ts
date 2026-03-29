// ── Header types ──────────────────────────────────────────

/** A header value that will be auto-coerced to a string at request time. */
export type HeaderValue = string | number | boolean

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
} as const;
export type ContentType = typeof ContentTypes[keyof typeof ContentTypes];
export type ContentTypeValue = ContentType | (string & {})

/** Common authorization schemes. */
export const AuthSchemes = {
    BEARER: 'Bearer',
    BASIC: 'Basic',
} as const;
export type AuthScheme = typeof AuthSchemes[keyof typeof AuthSchemes];
export type AuthorizationValue = `${AuthScheme} ${string}` | (string & {})

/** Common Cache-Control directives. */
export const CacheDirectives = {
    NO_CACHE: 'no-cache',
    NO_STORE: 'no-store',
    NO_TRANSFORM: 'no-transform',
    MAX_AGE_0: 'max-age=0',
} as const;
export type CacheDirective = typeof CacheDirectives[keyof typeof CacheDirectives];
export type CacheControlValue = CacheDirective | `max-age=${number}` | (string & {})

/** Well-known HTTP headers with narrowed value types. */
export interface WellKnownHeaders {
  'Content-Type'?: ContentTypeValue
  'Accept'?: ContentTypeValue
  'Authorization'?: AuthorizationValue
  'Cache-Control'?: CacheControlValue
  'If-None-Match'?: string
  'If-Modified-Since'?: string
  'X-Request-ID'?: string
  [key: string]: HeaderValue | undefined
}

/**
 * Typed HTTP headers: well-known headers get narrowed value types,
 * custom headers (TCustom) are merged in, and any unknown header
 * falls back to HeaderValue.
 */
export type TypedHeaders<TCustom extends Record<string, HeaderValue | undefined> = {}> =
  WellKnownHeaders & TCustom & Record<string, HeaderValue | undefined>

// ── HTTP methods ──────────────────────────────────────────

export const HttpMethods = {
    GET: 'GET',
    POST: 'POST',
    PUT: 'PUT',
    PATCH: 'PATCH',
    DELETE: 'DELETE',
} as const;
export type HttpMethod = typeof HttpMethods[keyof typeof HttpMethods];

/** Property names reserved by the OpenAPIClient proxy system. */
export const ProxyProps = {
    ROOT: 'root',
    CLIENT: 'client',
    SPEC: 'spec',
    ROUTES: 'routes',
    CHILDREN: 'children',
    THEN: 'then',
} as const;
export type ProxyProp = typeof ProxyProps[keyof typeof ProxyProps];

/** OpenAPI parameter location values. */
export const ParamLocations = {
    QUERY: 'query',
    PATH: 'path',
    HEADER: 'header',
    COOKIE: 'cookie',
} as const;
export type ParamLocation = typeof ParamLocations[keyof typeof ParamLocations];

/**
 * All names reserved by the OpenAPIClient and its proxy system.
 * The plat server should reject routes/methods whose names collide with these.
 */
export const RESERVED_ROUTE_NAMES: readonly string[] = [
    ...Object.values(ProxyProps),
    ...Object.values(HttpMethods).map(m => m.toLowerCase()),
    // Native function properties that the proxy falls through to
    'bind', 'call', 'apply', 'toString', 'valueOf',
    'constructor', 'prototype', 'length', 'name',
    'tools', 'buildHeaders',
] as const;