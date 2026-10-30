/**
 * Generic CLI runtime that works with any OpenAPI spec.
 *
 * Generated CLIs just pass in their spec — all arg parsing,
 * formatting, and dispatch lives here.
 */

import { OpenAPIClient, type OpenAPIClientConfig } from '../client/openapi-client'
import { createClientSideServerMQTTWebRTCTransportPlugin } from '../client-side-server/mqtt-webrtc'
import { PLAT_AUTHORITY_URL } from '../client-side-server/authority-default'
import { runCliCore, type CliOptions } from './core'

// ── main entry point ───────────────────────────────────────

export interface RunCliOptions extends Partial<Omit<CliOptions, 'spec' | 'call'>> {
  /** Override base URL (default: spec.servers[0].url or env) */
  baseUrl?: string
  /** Extra headers to send */
  headers?: Record<string, string>
  /** OpenAPIClient config overrides */
  clientConfig?: Partial<OpenAPIClientConfig>
  /** Replace the default OpenAPIClient transport. */
  call?: CliOptions['call']
}

/**
 * Run a CLI for `spec`. Every behaviour a CLI might want to change is an option (see `CliOptions`):
 * extra commands, overrides, positional params, hooks, formatters, help. Do not hand-roll a CLI.
 */
export async function runCli(spec: any, argvOrOptions?: string[] | RunCliOptions, maybeOptions?: RunCliOptions) {
  const argv = Array.isArray(argvOrOptions) ? argvOrOptions : process.argv.slice(2)
  const options = (Array.isArray(argvOrOptions) ? maybeOptions : argvOrOptions) ?? {}
  const { baseUrl: baseUrlOption, headers, clientConfig: clientOverrides, call, ...core } = options

  let client: any
  const defaultCall: CliOptions['call'] = async (command, input) => {
    if (!client) {
      const baseUrl = baseUrlOption ?? spec.servers?.[0]?.url ?? PLAT_AUTHORITY_URL
      const token = process.env.API_TOKEN
      const clientConfig: Partial<OpenAPIClientConfig> = { ...clientOverrides }
      if (baseUrl.startsWith('css://') && !clientConfig.transportPlugins?.length) {
        clientConfig.transportPlugins = [createClientSideServerMQTTWebRTCTransportPlugin()]
      }
      client = new OpenAPIClient(spec, {
        baseUrl,
        headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...clientConfig,
      })
    }
    const method = command.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
    return client[method](command.path, input)
  }

  await runCliCore({ ...core, spec, call: call ?? defaultCall }, argv)
}
