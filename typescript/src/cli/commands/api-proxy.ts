/**
 * API Proxy command
 * Call API endpoints directly from CLI using OpenAPI spec
 */

import fs from 'fs'
import path from 'path'
import { OpenAPIClient } from '../../client/openapi-client'
import { createClientSideServerMQTTWebRTCTransportPlugin } from '../../client-side-server/mqtt-webrtc'
import { PLAT_AUTHORITY_URL } from '../../client-side-server/authority-default'

interface OpenAPISpec {
  openapi: string
  servers?: Array<{ url: string }>
  paths: Record<
    string,
    Record<string, OpenAPIOperation>
  >
}

interface OpenAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  parameters?: Array<{
    name: string
    in: 'path' | 'query' | 'header'
    required?: boolean
    schema?: { type: string }
  }>
  requestBody?: {
    content: Record<string, { schema: any }>
    required?: boolean
  }
  responses: Record<string, any>
}

interface ParsedArgs {
  params: Record<string, any>
  pathParams: Record<string, string>
  options: Record<string, any>
}

/**
 * Parse CLI arguments into params object and options
 * Supports multiple formats:
 * - --key value (space-separated)
 * - --key=value (equals-separated)
 * - key=value (no dashes)
 * - key=value&key2=value2 (query string format)
 * - {"key": value, "key2": "value2"} (JSON object)
 * Plus options: --timeoutMs=5000, etc.
 */
function parseCliArgs(args: string[]): ParsedArgs {
  const params: Record<string, any> = {}
  const options: Record<string, any> = {}
  const pathParams: Record<string, string> = {}

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === undefined) {
      i++
      continue
    }

    // Handle JSON object format
    if (arg.startsWith('{') && arg.endsWith('}')) {
      try {
        const jsonObj = JSON.parse(arg)
        Object.assign(params, jsonObj)
        i++
        continue
      } catch {
        // Not valid JSON, treat as regular arg
      }
    }

    // Handle query string format (key=value&key2=value2)
    if (!arg.startsWith('-') && arg.includes('=') && arg.includes('&')) {
      const pairs = arg.split('&')
      for (const pair of pairs) {
        const [key, val] = pair.split('=', 2)
        if (key !== undefined) {
          params[key] = decodeURIComponent(val || '')
        }
      }
      i++
      continue
    }

    // Handle --key=value (equals-separated with dashes - these are options)
    if (arg.startsWith('--') && arg.includes('=')) {
      const [key, val] = arg.split('=', 2)
      if (key !== undefined) {
        const cleanKey = key.slice(2)
        // Treat as option if it's a known option name
        if (['timeoutMs', 'timeout', 'retryMs', 'retryDelayMs'].includes(cleanKey)) {
          const numVal = parseInt(val || '0', 10)
          options[cleanKey] = isNaN(numVal) ? val : numVal
        } else {
          params[cleanKey] = decodeURIComponent(val || '')
        }
      }
      i++
      continue
    }

    // Handle key=value (no dashes) or --key=value
    if (arg.includes('=') && !arg.startsWith('--')) {
      const [key, val] = arg.split('=', 2)
      if (key !== undefined) {
        params[key] = decodeURIComponent(val || '')
      }
      i++
      continue
    }

    // Handle --key value (space-separated)
    if (arg.startsWith('--') && i + 1 < args.length) {
      const key = arg.slice(2)
      const value = args[i + 1]
      // Check if next arg exists and is not another flag
      if (value && !value.startsWith('-') && !value.includes('=')) {
        // Known options go to options, others to params
        if (['timeoutMs', 'timeout', 'retryMs', 'retryDelayMs'].includes(key)) {
          const numVal = parseInt(value, 10)
          options[key] = isNaN(numVal) ? value : numVal
        } else {
          params[key] = value
        }
        i += 2
        continue
      }
    }

    i++
  }

  return { params, pathParams, options }
}

/**
 * Find operation in OpenAPI spec by operationId
 */
function findOperation(
  spec: OpenAPISpec,
  operationId: string
): { path: string; method: string; operation: OpenAPIOperation } | null {
  for (const [pathKey, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation.operationId === operationId) {
        return { path: pathKey, method, operation }
      }
    }
  }
  return null
}

/**
 * Check if a string is an HTTP method
 */
function isHttpMethod(str: string): boolean {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(str.toUpperCase())
}

/**
 * Proxy an API call using OpenAPI spec
 */
export async function apiProxy(cwd: string, argv: string[]): Promise<void> {
  if (argv.length === 0) {
    console.error('❌ Error: No operation specified')
    console.error('Usage:')
    console.error('  plat <operationId> [--key=value ...]')
    console.error('  plat <method> <path> [--key=value ...]')
    process.exit(1)
  }

  try {
    // Load OpenAPI spec
    const specPath = path.join(cwd, 'openapi.json')
    if (!fs.existsSync(specPath)) {
      console.error('❌ Error: openapi.json not found')
      console.error('Run: plat gen openapi')
      process.exit(1)
    }

    const specContent = fs.readFileSync(specPath, 'utf-8')
    const spec: OpenAPISpec = JSON.parse(specContent)

    // Check if first argument is an HTTP method
    let operationId: string | undefined
    let methodOverride: string | undefined
    let pathOverride: string | undefined
    let argsStartIndex = 1

    if (isHttpMethod(argv[0]!) && argv.length > 1) {
      methodOverride = argv[0]!.toUpperCase()
      pathOverride = argv[1]!
      argsStartIndex = 2
    } else {
      operationId = argv[0]!
    }

    let operation: { path: string; method: string; operation: OpenAPIOperation } | null = null

    // If we have method + path override, find the operation by those
    if (methodOverride && pathOverride) {
      for (const [pathKey, methods] of Object.entries(spec.paths)) {
        if (pathKey === pathOverride || pathKey === `/api${pathOverride}`) {
          const method = methods[methodOverride.toLowerCase()]
          if (method) {
            operation = { path: pathKey, method: methodOverride.toLowerCase(), operation: method }
            break
          }
        }
      }
      if (!operation) {
        console.error(`❌ Error: No operation found for ${methodOverride} ${pathOverride}`)
        process.exit(1)
      }
    } else {
      operation = findOperation(spec, operationId!)
      if (!operation) {
        console.error(`❌ Error: Operation '${operationId}' not found in OpenAPI spec`)
        process.exit(1)
      }
    }

    // Parse remaining arguments
    const parsed = parseCliArgs(argv.slice(argsStartIndex))

    // Resolve base URL
    const baseUrl = parsed.params.baseUrl ?? PLAT_AUTHORITY_URL;
      delete parsed.params.baseUrl

    // Add timeout if specified
    const timeoutMs = parsed.options.timeoutMs || parsed.options.timeout

    // Add Authorization header if token is available
    const token = parsed.params.authToken ?? process.env.PLAT_TOKEN;
      delete parsed.params.authToken
    const client = new OpenAPIClient(spec as any, {
      baseUrl,
      timeoutMs,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      transportPlugins: baseUrl.startsWith('css://')
        ? [createClientSideServerMQTTWebRTCTransportPlugin()]
        : undefined,
    })
    const method = operation.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
    const responseBody = await client[method](operation.path as any, parsed.params as any)
    console.log(typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody, null, 2))
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}
