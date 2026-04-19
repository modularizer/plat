/** A header value that will be auto-coerced to a string at request time. */
export type HeaderValue = string | number | boolean;
/** Common MIME types for Content-Type / Accept headers. */
export declare const ContentTypes: {
    readonly JSON: "application/json";
    readonly FORM: "application/x-www-form-urlencoded";
    readonly MULTIPART: "multipart/form-data";
    readonly TEXT: "text/plain";
    readonly HTML: "text/html";
    readonly CSV: "text/csv";
    readonly XML: "application/xml";
    readonly BINARY: "application/octet-stream";
};
export type ContentType = typeof ContentTypes[keyof typeof ContentTypes];
export type ContentTypeValue = ContentType | (string & {});
/** Common authorization schemes. */
export declare const AuthSchemes: {
    readonly BEARER: "Bearer";
    readonly BASIC: "Basic";
};
export type AuthScheme = typeof AuthSchemes[keyof typeof AuthSchemes];
export type AuthorizationValue = `${AuthScheme} ${string}` | (string & {});
/** Common Cache-Control directives. */
export declare const CacheDirectives: {
    readonly NO_CACHE: "no-cache";
    readonly NO_STORE: "no-store";
    readonly NO_TRANSFORM: "no-transform";
    readonly MAX_AGE_0: "max-age=0";
};
export type CacheDirective = typeof CacheDirectives[keyof typeof CacheDirectives];
export type CacheControlValue = CacheDirective | `max-age=${number}` | (string & {});
/** Well-known HTTP headers with narrowed value types. */
export interface WellKnownHeaders {
    'Content-Type'?: ContentTypeValue;
    'Accept'?: ContentTypeValue;
    'Authorization'?: AuthorizationValue;
    'Cache-Control'?: CacheControlValue;
    'If-None-Match'?: string;
    'If-Modified-Since'?: string;
    'X-Request-ID'?: string;
    [key: string]: HeaderValue | undefined;
}
/**
 * Typed HTTP headers: well-known headers get narrowed value types,
 * custom headers (TCustom) are merged in, and any unknown header
 * falls back to HeaderValue.
 */
export type TypedHeaders<TCustom extends Record<string, HeaderValue | undefined> = {}> = WellKnownHeaders & TCustom & Record<string, HeaderValue | undefined>;
export declare const HttpMethods: {
    readonly GET: "GET";
    readonly POST: "POST";
    readonly PUT: "PUT";
    readonly PATCH: "PATCH";
    readonly DELETE: "DELETE";
};
export type HttpMethod = typeof HttpMethods[keyof typeof HttpMethods];
/** Property names reserved by the OpenAPIClient proxy system. */
export declare const ProxyProps: {
    readonly ROOT: "root";
    readonly CLIENT: "client";
    readonly SPEC: "spec";
    readonly ROUTES: "routes";
    readonly CHILDREN: "children";
    readonly THEN: "then";
};
export type ProxyProp = typeof ProxyProps[keyof typeof ProxyProps];
/** OpenAPI parameter location values. */
export declare const ParamLocations: {
    readonly QUERY: "query";
    readonly PATH: "path";
    readonly HEADER: "header";
    readonly COOKIE: "cookie";
};
export type ParamLocation = typeof ParamLocations[keyof typeof ParamLocations];
/**
 * All names reserved by the OpenAPIClient and its proxy system.
 * The plat server should reject routes/methods whose names collide with these.
 */
export declare const RESERVED_ROUTE_NAMES: readonly string[];
//# sourceMappingURL=http.d.ts.map