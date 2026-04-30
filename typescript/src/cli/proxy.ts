import { createClientProxy } from '../client'
import { PLAT_AUTHORITY_URL } from '../client-side-server/authority-default'
import type {
    ClientCallOptions,
    Clientified,
} from '../types/client'
import type {
    EndpointDef,
    HttpMethod,
} from '../types'

declare const process: { env: Record<string, string | undefined> }

type ApiClass<T> = abstract new (...args: any[]) => T

export interface CliAuthContext {
    controllerName: string
    methodName: string
    httpMethod: HttpMethod
    fullPath: string
}

export interface CliProxyConfig {
    baseUrl?: string
    token?: string
    tokenEnvVar?: string
    baseUrlEnvVar?: string
    authScheme?: string
    requireAuth?: boolean

    headers?:
        | HeadersInit
        | (() => HeadersInit | Promise<HeadersInit>)

    getToken?:
        | (() => string | undefined | Promise<string | undefined>)
        | ((ctx: CliAuthContext) => string | undefined | Promise<string | undefined>)

    onMissingToken?: (ctx: CliAuthContext) => void | Promise<void>

    fetch?: typeof globalThis.fetch
    timeoutMs?: number
    retry?: false | {
        maxAttempts?: number
        retryDelayMs?: number | ((ctx: any) => number)
        shouldRetry?: (ctx: any) => boolean
    }
}

export type Cliified<T> = Clientified<T> & {
    $endpoints: Array<{
        methodName: string
        httpMethod: HttpMethod
        fullPath: string
        summary?: string
        description?: string
    }>
    $baseUrl: string
    $controllerName: string
}

const TOKEN_ENV_VAR = 'AUTH_TOKEN'
const BASE_URL_ENV_VAR = 'BASE_URL'

export function createCliProxy<T>(
    controller: ApiClass<T>,
    endpointDefs: EndpointDef[],
    config: CliProxyConfig = {},
): Cliified<T> {
    const controllerEndpoints = endpointDefs.filter((x) => x.controller === controller)

    const baseUrl = resolveBaseUrl(config)

    const clientConfig: Parameters<typeof createClientProxy>[2] = {
        baseUrl,
        headers: async () => {
            const baseHeaders = await resolveHeaders(config.headers)
            return baseHeaders ?? {}
        },
    }

    if (config.fetch !== undefined) clientConfig.fetch = config.fetch
    if (config.timeoutMs !== undefined) clientConfig.timeoutMs = config.timeoutMs
    if (config.retry !== undefined) clientConfig.retry = config.retry

    const client = createClientProxy(controller, endpointDefs, clientConfig)

    const byMethodName = new Map<string, EndpointDef>()
    for (const endpoint of controllerEndpoints) {
        byMethodName.set(endpoint.methodName, endpoint)
    }

    const endpointList = controllerEndpoints.map((x) => ({
        methodName: x.methodName,
        httpMethod: x.httpMethod,
        fullPath: x.fullPath,
        summary: x.summary,
        description: x.description,
    }))

    const proxy = new Proxy(
        {},
        {
            get(_target, prop) {
                if (prop === '$endpoints') return endpointList
                if (prop === '$baseUrl') return baseUrl
                if (prop === '$controllerName') return controller.name

                if (typeof prop !== 'string') return undefined

                const endpoint = byMethodName.get(prop)
                if (!endpoint) return undefined

                const fn = (client as Record<string, unknown>)[prop]
                if (typeof fn !== 'function') return undefined

                return async (input: unknown, callOptions?: ClientCallOptions) => {
                    const ctx: CliAuthContext = {
                        controllerName: controller.name,
                        methodName: endpoint.methodName,
                        httpMethod: endpoint.httpMethod,
                        fullPath: endpoint.fullPath,
                    }

                    const authHeaders = await buildAuthHeaders(config, ctx)
                    const extra: { headers?: HeadersInit } = {}
                    if (authHeaders !== undefined) {
                        extra.headers = authHeaders
                    }
                    const mergedCallOptions = mergeCallOptions(callOptions, extra)

                    return (fn as (input: unknown, opts?: ClientCallOptions) => Promise<unknown>)(
                        input,
                        mergedCallOptions,
                    )
                }
            },
        },
    )

    return proxy as Cliified<T>
}

async function buildAuthHeaders(
    config: CliProxyConfig,
    ctx: CliAuthContext,
): Promise<HeadersInit | undefined> {
    const token = await resolveToken(config, ctx)

    if (!token) {
        if (config.requireAuth) {
            if (config.onMissingToken) {
                await config.onMissingToken(ctx)
            }

            throw new Error(
                [
                    `Missing auth token for ${ctx.controllerName}.${ctx.methodName}`,
                    `Set ${config.tokenEnvVar ?? TOKEN_ENV_VAR} or pass token/getToken to createCliProxy().`,
                ].join('\n'),
            )
        }

        return undefined
    }

    const scheme = config.authScheme ?? 'Bearer'
    return {
        Authorization: `${scheme} ${token}`,
    }
}

async function resolveToken(
    config: CliProxyConfig,
    ctx: CliAuthContext,
): Promise<string | undefined> {
    if (config.token) return config.token

    if (config.getToken) {
        const fn = config.getToken as any
        const value = (fn.length > 0)
            ? await fn(ctx)
            : await fn()

        if (value) return value
    }

    if (config.tokenEnvVar) {
        return readEnv(config.tokenEnvVar)
    }

    return readEnv(TOKEN_ENV_VAR)
}

function resolveBaseUrl(config: CliProxyConfig): string {
    if (config.baseUrl) return config.baseUrl

    const value = readEnv(config.baseUrlEnvVar ?? BASE_URL_ENV_VAR)
    if (value) return value

    return PLAT_AUTHORITY_URL || ''
}

function readEnv(name: string): string | undefined {
    const value = process.env[name]
    if (!value) return undefined

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

async function resolveHeaders(
    headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>),
): Promise<HeadersInit | undefined> {
    if (!headers) return undefined
    return typeof headers === 'function' ? await headers() : headers
}

function mergeCallOptions(
    original: ClientCallOptions | undefined,
    extra: {
        headers?: HeadersInit
    },
): ClientCallOptions | undefined {
    const mergedHeaders = mergeHeaders(original?.headers, extra.headers)

    const out: ClientCallOptions = {}

    if (mergedHeaders) {
        out.headers = mergedHeaders
    }

    if (original?.signal !== undefined) {
        out.signal = original.signal
    }

    if (original?.timeoutMs !== undefined) {
        out.timeoutMs = original.timeoutMs
    }

    if (original?.retry !== undefined) {
        out.retry = original.retry
    }

    return hasAnyCallOption(out) ? out : undefined
}

function mergeHeaders(
    ...sources: Array<HeadersInit | undefined>
): HeadersInit | undefined {
    const out = new Headers()

    for (const src of sources) {
        if (!src) continue
        const h = new Headers(src)
        h.forEach((value, key) => out.set(key, value))
    }

    let hasHeaders = false
    out.forEach(() => {
        hasHeaders = true
    })
    return hasHeaders ? out : undefined
}

function hasAnyCallOption(value: ClientCallOptions): boolean {
    return (
        value.headers !== undefined ||
        value.signal !== undefined ||
        value.timeoutMs !== undefined ||
        value.retry !== undefined
    )
}