import type { BuiltRequest } from '../types/client'
import type { ClientRouteLike } from '../types/client-route'

export function buildRequest(
    route: ClientRouteLike,
    input: Record<string, unknown>,
    baseUrl: string,
): BuiltRequest {
    const pathParamNames = getPathParamNames(route.fullPath)

    let path = route.fullPath
    const usedKeys = new Set<string>()

    for (const key of pathParamNames) {
        const value = input[key]
        if (value === undefined || value === null) {
            throw new Error(
                `Missing path param "${key}" for ${route.controllerName}.${route.methodName}`,
            )
        }

        path = path.replace(`:${key}`, encodeURIComponent(serializePathValue(value)))
        usedKeys.add(key)
    }

    const leftovers: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input)) {
        if (!usedKeys.has(key) && value !== undefined) {
            leftovers[key] = value
        }
    }

    const url = new URL(path, normalizeBaseUrl(baseUrl))

    if (route.httpMethod === 'GET' || route.httpMethod === 'DELETE') {
        for (const [key, value] of Object.entries(leftovers)) {
            appendQueryValue(url, key, value)
        }

        return {
            url: stripDummyOrigin(url),
            headers: {
                accept: 'application/json',
            },
        }
    }

    return {
        url: stripDummyOrigin(url),
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
        },
        body: JSON.stringify(leftovers),
    }
}

export function getPathParamNames(path: string): string[] {
    return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!)
}

function serializePathValue(value: unknown): string {
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value)
    }
    return JSON.stringify(value)
}

function appendQueryValue(url: URL, key: string, value: unknown): void {
    if (value === undefined) return

    if (Array.isArray(value)) {
        for (const item of value) appendQueryValue(url, key, item)
        return
    }

    if (value instanceof Date) {
        url.searchParams.append(key, value.toISOString())
        return
    }

    if (value === null) {
        url.searchParams.append(key, 'null')
        return
    }

    if (typeof value === 'object') {
        url.searchParams.append(key, JSON.stringify(value))
        return
    }

    url.searchParams.append(key, String(value))
}

function normalizeBaseUrl(baseUrl: string): string {
    if (/^https?:\/\//.test(baseUrl)) {
        return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    }

    const normalized = baseUrl ? (baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`) : '/'
    return `http://__dummy__${normalized.endsWith('/') ? normalized : `${normalized}/`}`
}

function stripDummyOrigin(url: URL): string {
    if (url.origin === 'http://__dummy__') {
        return `${url.pathname}${url.search}`
    }
    return url.toString()
}
