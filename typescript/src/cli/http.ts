/**
 * Dependency-free HTTP transport for the CLI engine: plain `fetch`, nothing else.
 * This is what the lightweight `@modularizer/plat-cli` package ships.
 */

import { runCliCore, type CliCall, type CliOptions } from './core'

export interface HttpCallOptions {
  baseUrl: string | (() => string | Promise<string>)
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
  fetch?: typeof fetch
}

/** Where the OpenAPI document lives on a plat server. */
export async function fetchSpec(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<any> {
  const res = await fetchImpl(new URL('/openapi.json', baseUrl))
  if (!res.ok) throw new Error(`Could not load ${new URL('/openapi.json', baseUrl)}: HTTP ${res.status}`)
  return res.json()
}

/** `{id}` path params come from the input; GET/DELETE send the rest as a query string, others as JSON. */
export function httpCall(options: HttpCallOptions): CliCall {
  return async (command, input) => {
    const baseUrl = typeof options.baseUrl === 'function' ? await options.baseUrl() : options.baseUrl
    const extra = typeof options.headers === 'function' ? await options.headers() : options.headers
    const rest = { ...input }
    const path = command.path.replace(/\{(\w+)\}/g, (_, key: string) => {
      const value = rest[key]
      delete rest[key]
      return encodeURIComponent(String(value ?? ''))
    })
    const url = new URL(path, baseUrl)
    const hasBody = command.method !== 'GET' && command.method !== 'DELETE' && command.method !== 'HEAD'
    if (!hasBody) {
      for (const [key, value] of Object.entries(rest)) {
        url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
      }
    }
    const res = await (options.fetch ?? fetch)(url, {
      method: command.method,
      headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...extra },
      ...(hasBody ? { body: JSON.stringify(rest) } : {}),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${command.name}: HTTP ${res.status} ${text}`)
    try { return JSON.parse(text) } catch { return text }
  }
}

export interface HttpCliOptions extends Omit<CliOptions, 'spec' | 'call'> {
  baseUrl: HttpCallOptions['baseUrl']
  headers?: HttpCallOptions['headers']
  /** Default: fetch `/openapi.json` from `baseUrl`. */
  spec?: CliOptions['spec']
  call?: CliOptions['call']
  fetch?: typeof fetch
}

/** Run a CLI against a plat server over plain HTTP. */
export async function runHttpCli(options: HttpCliOptions, argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { baseUrl, headers, fetch: fetchImpl, spec, call, ...core } = options
  await runCliCore({
    ...core,
    spec: spec ?? (async () => fetchSpec(typeof baseUrl === 'function' ? await baseUrl() : baseUrl, fetchImpl)),
    call: call ?? httpCall({ baseUrl, headers, fetch: fetchImpl }),
  }, argv)
}
