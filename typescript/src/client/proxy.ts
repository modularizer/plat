import {
    ClientCallOptions,
    ClientError,
    ClientProxyConfig,
    Clientified,
    EndpointDef,
    NetworkError,
    RetryContext,
    ServerError,
    TimeoutError,
} from '../types'
import { buildRequest } from './request-builder'

type ApiClass<T> = abstract new (...args: any[]) => T

type ResolvedRetryOptions = false | {
    maxAttempts: number
    retryDelayMs: number | ((ctx: RetryContext) => number)
    shouldRetry: ((ctx: RetryContext) => boolean) | undefined
}

const TIMEOUT_ABORT_REASON = Symbol('plat.timeout')

export function createClientProxy<T>(
    controller: ApiClass<T>,
    endpointDefs: EndpointDef[],
    config: ClientProxyConfig,
): Clientified<T> {
    const fetchImpl = config.fetch ?? globalThis.fetch
    if (!fetchImpl) {
        throw new Error('No fetch implementation available')
    }

    const routes = endpointDefs.filter((x) => x.controller === controller)
    const byMethodName = new Map<string, EndpointDef>()

    for (const route of routes) {
        if (byMethodName.has(route.methodName)) {
            throw new Error(
                `Duplicate endpoint definition for ${controller.name}.${route.methodName}`,
            )
        }
        byMethodName.set(route.methodName, route)
    }

    return new Proxy(
        {},
        {
            get(_target, prop) {
                if (typeof prop !== 'string') return undefined

                const route = byMethodName.get(prop)
                if (!route) return undefined

                return async (input: unknown, callOptions?: ClientCallOptions) => {
                    const parsedInput = route.inputSchema.parse(input)
                    return executeRoute(fetchImpl, route, parsedInput, config, callOptions)
                }
            },
            ownKeys() {
                return [...byMethodName.keys()]
            },
            getOwnPropertyDescriptor(_target, prop) {
                if (typeof prop === 'string' && byMethodName.has(prop)) {
                    return { configurable: true, enumerable: true, writable: true }
                }
                return undefined
            },
        },
    ) as Clientified<T>
}

async function executeRoute(
    fetchImpl: typeof globalThis.fetch,
    route: EndpointDef,
    parsedInput: unknown,
    config: ClientProxyConfig,
    callOptions?: ClientCallOptions,
): Promise<unknown> {
    const request = buildRequest(
        route,
        parsedInput as Record<string, unknown>,
        config.baseUrl,
    )

    const retryOptions = mergeRetryOptions(config.retry, callOptions?.retry)
    const maxAttempts = retryOptions === false ? 1 : retryOptions.maxAttempts
    let attempt = 0
    let lastError: unknown

    while (attempt < maxAttempts) {
        attempt += 1

        try {
            const mergedHeaders = mergeHeaders(
                request.headers,
                await resolveHeaders(config.headers),
                callOptions?.headers,
            )

            const init: RequestInit = {
                method: route.httpMethod,
                headers: mergedHeaders,
            }

            if (request.body !== undefined) {
                init.body = request.body
            }

            if (callOptions?.signal !== undefined) {
                init.signal = callOptions.signal
            }

            const response = await fetchWithTimeout(
                fetchImpl,
                route,
                request.url,
                init,
                callOptions?.timeoutMs ?? config.timeoutMs,
            )

            if (response.ok) {
                if (response.status === 204) {
                    return undefined
                }

                const data = await parseSuccessBody(response)
                return route.outputSchema.parse(data)
            }

            const httpError = await toHttpError(
                route,
                request.url,
                route.httpMethod,
                response,
            )

            await runResponseHooks(httpError, config)

            if (
                retryOptions !== false &&
                shouldRetryResponse(
                    {
                        attempt,
                        maxAttempts,
                        response,
                        route,
                    },
                    retryOptions,
                )
            ) {
                await sleep(
                    getRetryDelayMs(
                        {
                            attempt,
                            maxAttempts,
                            response,
                            route,
                        },
                        retryOptions,
                        httpError instanceof ClientError ? httpError.retryAfterMs : undefined,
                    ),
                )
                lastError = httpError
                continue
            }

            throw httpError
        } catch (error) {
            const normalized = normalizeThrownError(
                error,
                route,
                request.url,
                route.httpMethod,
            )

            if (
                retryOptions !== false &&
                shouldRetryError(
                    {
                        attempt,
                        maxAttempts,
                        error: normalized,
                        route,
                    },
                    retryOptions,
                )
            ) {
                await sleep(
                    getRetryDelayMs(
                        {
                            attempt,
                            maxAttempts,
                            error: normalized,
                            route,
                        },
                        retryOptions,
                    ),
                )
                lastError = normalized
                continue
            }

            throw normalized
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Request failed')
}

async function runResponseHooks(
    error: ClientError | ServerError,
    config: ClientProxyConfig,
): Promise<void> {
    if (error instanceof ClientError) {
        if (error.isUnauthorized && config.onUnauthorized) {
            await config.onUnauthorized(error)
            return
        }

        if (error.isForbidden && config.onForbidden) {
            await config.onForbidden(error)
            return
        }

        if (error.isRateLimited && config.onRateLimited) {
            await config.onRateLimited(error)
            return
        }

        return
    }

    if (config.onServerError) {
        await config.onServerError(error)
    }
}

async function fetchWithTimeout(
    fetchImpl: typeof globalThis.fetch,
    route: EndpointDef,
    url: string,
    init: RequestInit,
    timeoutMs?: number,
): Promise<Response> {
    if (!timeoutMs || timeoutMs <= 0) {
        return fetchImpl(url, init)
    }

    const timeoutController = new AbortController()
    const mergedSignal = mergeAbortSignals(
        init.signal ?? undefined,
        timeoutController.signal,
    )

    const timer = setTimeout(() => {
        timeoutController.abort(TIMEOUT_ABORT_REASON)
    }, timeoutMs)

    try {
        const nextInit: RequestInit = {}

        if (init.method !== undefined) {
            nextInit.method = init.method
        }

        if (init.headers !== undefined) {
            nextInit.headers = init.headers
        }

        if (init.body !== undefined) {
            nextInit.body = init.body
        }

        if (mergedSignal !== undefined) {
            nextInit.signal = mergedSignal
        }

        if (init.body !== undefined) {
            nextInit.body = init.body
        }

        if (mergedSignal !== undefined) {
            nextInit.signal = mergedSignal
        }

        return await fetchImpl(url, nextInit)
    } catch (error) {
        if (isTimeoutAbort(error, timeoutController.signal)) {
            throw new TimeoutError({
                route,
                url,
                method: String(init.method ?? 'GET'),
                cause: error,
            })
        }

        throw error
    } finally {
        clearTimeout(timer)
    }
}

async function toHttpError(
    route: EndpointDef,
    url: string,
    method: string,
    response: Response,
): Promise<ClientError | ServerError> {
    const parsed = await parseErrorBody(response)

    if (response.status >= 400 && response.status < 500) {
        return new ClientError({
            route,
            url,
            method,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            bodyText: parsed.bodyText,
            bodyJson: parsed.bodyJson,
        })
    }

    return new ServerError({
        route,
        url,
        method,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        bodyText: parsed.bodyText,
        bodyJson: parsed.bodyJson,
    })
}

async function parseSuccessBody(response: Response): Promise<unknown> {
    const text = await response.text()
    if (!text) return undefined

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
        return JSON.parse(text)
    }

    return text
}

async function parseErrorBody(response: Response): Promise<{
    bodyText: string | undefined
    bodyJson: unknown
}> {
    const text = await response.text().catch(() => '')
    if (!text) {
        return {
            bodyText: undefined,
            bodyJson: undefined,
        }
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
        try {
            return {
                bodyText: text,
                bodyJson: JSON.parse(text),
            }
        } catch {
            return {
                bodyText: text,
                bodyJson: undefined,
            }
        }
    }

    return {
        bodyText: text,
        bodyJson: undefined,
    }
}

function normalizeThrownError(
    error: unknown,
    route: EndpointDef,
    url: string,
    method: string,
): unknown {
    if (
        error instanceof ClientError ||
        error instanceof ServerError ||
        error instanceof NetworkError ||
        error instanceof TimeoutError
    ) {
        return error
    }

    if (isAbortError(error)) {
        return error
    }

    return new NetworkError({
        route,
        url,
        method,
        cause: error,
    })
}

function mergeRetryOptions(
    configRetry: ClientProxyConfig['retry'],
    callRetry: ClientCallOptions['retry'],
): ResolvedRetryOptions {
    if (configRetry === false || callRetry === false) {
        return false
    }

    return {
        maxAttempts: callRetry?.maxAttempts ?? configRetry?.maxAttempts ?? 2,
        retryDelayMs:
            callRetry?.retryDelayMs ??
            configRetry?.retryDelayMs ??
            defaultRetryDelayMs,
        shouldRetry: callRetry?.shouldRetry ?? configRetry?.shouldRetry,
    }
}

function shouldRetryResponse(
    ctx: RetryContext,
    retry: Exclude<ResolvedRetryOptions, false>,
): boolean {
    if (ctx.attempt >= ctx.maxAttempts) return false

    if (retry.shouldRetry) {
        return retry.shouldRetry(ctx)
    }

    const status = ctx.response?.status
    return (
        status === 408 ||
        status === 425 ||
        status === 429 ||
        status === 502 ||
        status === 503 ||
        status === 504
    )
}

function shouldRetryError(
    ctx: RetryContext,
    retry: Exclude<ResolvedRetryOptions, false>,
): boolean {
    if (ctx.attempt >= ctx.maxAttempts) return false

    if (retry.shouldRetry) {
        return retry.shouldRetry(ctx)
    }

    return ctx.error instanceof NetworkError || ctx.error instanceof TimeoutError
}

function getRetryDelayMs(
    ctx: RetryContext,
    retry: Exclude<ResolvedRetryOptions, false>,
    retryAfterMs?: number,
): number {
    if (retryAfterMs != null) {
        return retryAfterMs
    }

    const raw =
        typeof retry.retryDelayMs === 'function'
            ? retry.retryDelayMs(ctx)
            : retry.retryDelayMs

    return Math.max(0, raw)
}

function defaultRetryDelayMs(ctx: RetryContext): number {
    const base = 300 * 2 ** (ctx.attempt - 1)
    const jitter = Math.floor(Math.random() * 150)
    return base + jitter
}

async function resolveHeaders(
    headers?: ClientProxyConfig['headers'],
): Promise<HeadersInit | undefined> {
    if (!headers) return undefined
    return typeof headers === 'function' ? await headers() : headers
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
    const out = new Headers()

    for (const src of sources) {
        if (!src) continue
        const h = new Headers(src)
        h.forEach((value, key) => out.set(key, value))
    }

    return out
}

function mergeAbortSignals(
    a?: AbortSignal,
    b?: AbortSignal,
): AbortSignal | undefined {
    if (!a) return b
    if (!b) return a

    const controller = new AbortController()

    const abort = (reason: unknown) => {
        if (!controller.signal.aborted) {
            controller.abort(reason)
        }
    }

    if (a.aborted) abort(getAbortReason(a))
    if (b.aborted) abort(getAbortReason(b))

    a.addEventListener('abort', () => abort(getAbortReason(a)), { once: true })
    b.addEventListener('abort', () => abort(getAbortReason(b)), { once: true })

    return controller.signal
}

function getAbortReason(signal: AbortSignal): unknown {
    return (signal as AbortSignal & { reason?: unknown }).reason
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError'
}

function isTimeoutAbort(
    error: unknown,
    timeoutSignal: AbortSignal,
): boolean {
    if (!isAbortError(error)) return false
    return getAbortReason(timeoutSignal) === TIMEOUT_ABORT_REASON
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}