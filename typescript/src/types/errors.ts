import {EndpointDef} from "./endpoints";

export interface ErrorPayload {
    code?: string
    message?: string
    details?: unknown
    [key: string]: unknown
}

function asErrorPayload(value: unknown): ErrorPayload | undefined {
    if (!value || typeof value !== 'object') return undefined
    return value as ErrorPayload
}

function buildHttpErrorMessage(
    status: number,
    statusText: string,
    bodyJson?: unknown,
    bodyText?: string,
): string {
    const jsonMessage =
        bodyJson &&
        typeof bodyJson === 'object' &&
        'message' in bodyJson &&
        typeof (bodyJson as any).message === 'string'
            ? (bodyJson as any).message
            : undefined

    return jsonMessage || bodyText || `HTTP ${status} ${statusText}`
}

export class HttpError extends Error {
    readonly statusCode: number
    readonly data?: any

    constructor(statusCode: number, message: string, data?: any) {
        super(message)
        this.name = 'HttpError'
        this.statusCode = statusCode
        this.data = data
    }
}


export abstract class HttpProxyError extends Error {
    readonly route: EndpointDef | undefined
    readonly url: string
    readonly method: string
    readonly status: number | undefined
    readonly statusText: string | undefined
    readonly headers: Headers | undefined
    readonly bodyText: string | undefined
    readonly bodyJson: unknown
    override readonly cause: unknown

    protected constructor(args: {
        name: string
        message: string
        route?: EndpointDef
        url: string
        method: string
        status: number | undefined
        statusText: string | undefined
        headers: Headers | undefined
        bodyText: string | undefined
        bodyJson: unknown
        cause: unknown
    }) {
        super(args.message, { cause: args.cause })
        this.name = args.name
        this.route = args.route
        this.url = args.url
        this.method = args.method
        this.status = args.status
        this.statusText = args.statusText
        this.headers = args.headers
        this.bodyText = args.bodyText
        this.bodyJson = args.bodyJson
        this.cause = args.cause
    }
}

export class ClientError extends HttpProxyError {
    readonly payload: ErrorPayload | undefined

    constructor(args: {
        route?: EndpointDef
        url: string
        method: string
        status: number
        statusText: string
        headers: Headers
        bodyText: string | undefined
        bodyJson: unknown
    }) {
        super({
            name: 'ClientError',
            message: buildHttpErrorMessage(
                args.status,
                args.statusText,
                args.bodyJson,
                args.bodyText,
            ),
            route: args.route,
            url: args.url,
            method: args.method,
            status: args.status,
            statusText: args.statusText,
            headers: args.headers,
            bodyText: args.bodyText,
            bodyJson: args.bodyJson,
            cause: undefined,
        })
        this.payload = asErrorPayload(args.bodyJson)
    }

    get isUnauthorized(): boolean {
        return this.status === 401
    }

    get isForbidden(): boolean {
        return this.status === 403
    }

    get isNotFound(): boolean {
        return this.status === 404
    }

    get isConflict(): boolean {
        return this.status === 409
    }

    get isUnprocessable(): boolean {
        return this.status === 422
    }

    get isRateLimited(): boolean {
        return this.status === 429
    }

    get retryAfterMs(): number | undefined {
        const raw = this.headers?.get('retry-after')
        if (!raw) return undefined

        const seconds = Number(raw)
        if (Number.isFinite(seconds)) {
            return Math.max(0, seconds * 1000)
        }

        const dateMs = Date.parse(raw)
        if (Number.isFinite(dateMs)) {
            return Math.max(0, dateMs - Date.now())
        }

        return undefined
    }
}

export class ServerError extends HttpProxyError {
    readonly payload: ErrorPayload | undefined

    constructor(args: {
        route?: EndpointDef
        url: string
        method: string
        status: number
        statusText: string
        headers: Headers
        bodyText: string | undefined
        bodyJson: unknown
    }) {
        super({
            name: 'ServerError',
            message: buildHttpErrorMessage(
                args.status,
                args.statusText,
                args.bodyJson,
                args.bodyText,
            ),
            route: args.route,
            url: args.url,
            method: args.method,
            status: args.status,
            statusText: args.statusText,
            headers: args.headers,
            bodyText: args.bodyText,
            bodyJson: args.bodyJson,
            cause: undefined,
        })
        this.payload = asErrorPayload(args.bodyJson)
    }
}

export class NetworkError extends HttpProxyError {
    constructor(args: {
        route?: EndpointDef
        url: string
        method: string
        cause: unknown
    }) {
        super({
            name: 'NetworkError',
            message: `Network error calling ${args.method} ${args.url}`,
            route: args.route,
            url: args.url,
            method: args.method,
            status: undefined,
            statusText: undefined,
            headers: undefined,
            bodyText: undefined,
            bodyJson: undefined,
            cause: args.cause,
        })
    }
}

export class TimeoutError extends HttpProxyError {
    constructor(args: {
        route?: EndpointDef
        url: string
        method: string
        cause: unknown
    }) {
        super({
            name: 'TimeoutError',
            message: `Timed out calling ${args.method} ${args.url}`,
            route: args.route,
            url: args.url,
            method: args.method,
            status: undefined,
            statusText: undefined,
            headers: undefined,
            bodyText: undefined,
            bodyJson: undefined,
            cause: args.cause,
        })
    }
}