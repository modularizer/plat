/**
 * Shared types and utilities for OpenAPI-based generators and runtimes.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

// ── OpenAPI types ───────────────────────────────────────────

export interface OpenAPISpec {
  openapi: string
  info: { title: string; version: string }
  servers?: { url: string }[]
  paths: Record<string, Record<string, PathOperation>>
  components?: { schemas?: Record<string, SchemaObject> }
}

export interface PathOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: Parameter[]
  requestBody?: {
    content: Record<string, { schema: SchemaObject }>
  }
  responses: Record<string, {
    description?: string
    content?: Record<string, { schema: SchemaObject }>
  }>
}

export interface Parameter {
  name: string
  in: string
  required?: boolean
  schema: SchemaObject
}

export interface SchemaObject {
  type?: string
  format?: string
  enum?: (string | number)[]
  properties?: Record<string, SchemaObject>
  required?: string[]
  items?: SchemaObject
  $ref?: string
  allOf?: SchemaObject[]
  oneOf?: SchemaObject[]
  anyOf?: SchemaObject[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  examples?: unknown[]
  nullable?: boolean
  description?: string
}

export interface OperationInfo {
  operationId: string
  method: string
  path: string
  summary?: string
  inputSchema?: SchemaObject
  outputSchema?: SchemaObject
  parameters?: Parameter[]
}

export interface ResolveSpecResult {
  spec: OpenAPISpec
  specSource: string
  suggestedBaseUrl?: string
}

// ── args / path helpers ─────────────────────────────────────

export function getArgValue(args: string[], ...flags: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    for (const flag of flags) {
      if (arg === flag) return args[i + 1]
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
    }
  }
  return undefined
}

export function getFirstPositionalArg(args: string[], valueFlags: string[] = ['--src', '--dst']): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    if (arg.startsWith('--')) {
      if (valueFlags.includes(arg)) i += 1
      continue
    }
    return arg
  }
  return undefined
}

export function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export function looksLikeHost(value: string): boolean {
  return value.includes('.')
    && !value.includes(path.sep)
    && !value.includes('/')
    && !value.includes('\\')
    && !/^\.\.?$/.test(value)
}

export function isYamlPath(value: string): boolean {
  return /\.ya?ml$/i.test(value)
}

export function isJsonPath(value: string): boolean {
  return /\.json$/i.test(value)
}

export function defaultSpecSource(cwd = process.cwd()): string {
  const candidates = [
    path.join(cwd, 'openapi.json'),
    path.join(cwd, 'openapi.yaml'),
    path.join(cwd, 'openapi.yml'),
  ]
  return candidates[0]!
}

// ── spec loading / saving ───────────────────────────────────

export async function resolveSpec(input?: string, cwd = process.cwd()): Promise<ResolveSpecResult> {
  const source = input ? await normalizeInputSource(input, cwd) : await findDefaultSpec(cwd)

  if (isUrl(source)) {
    const attempts = buildUrlCandidates(source)
    let lastError: Error | null = null

    for (const candidate of attempts) {
      try {
        const response = await fetch(candidate)
        if (!response.ok) {
          lastError = new Error(`Failed to fetch ${candidate}: ${response.status} ${response.statusText}`)
          continue
        }
        const raw = await response.text()
        const spec = parseSpecText(raw, candidate)
        return {
          spec,
          specSource: candidate,
          suggestedBaseUrl: deriveBaseUrlFromSpecSource(source),
        }
      } catch (error) {
        lastError = error as Error
      }
    }

    throw lastError ?? new Error(`Unable to load OpenAPI spec from ${source}`)
  }

  const specPath = await findLocalSpec(source)
  if (!specPath) {
    throw new Error(`No OpenAPI spec found at ${source}`)
  }

  const raw = await fs.readFile(specPath, 'utf-8')
  return {
    spec: parseSpecText(raw, specPath),
    specSource: specPath,
  }
}

export async function loadSpec(args: string[]): Promise<{ spec: OpenAPISpec; outDir: string; specSource: string; suggestedBaseUrl?: string }> {
  const cwd = process.cwd()
  const src = getArgValue(args, '--src') ?? getFirstPositionalArg(args)
  const out = getArgValue(args, '--dst')
  const resolved = await resolveSpec(src, cwd)
  const outDir = out ? path.resolve(out) : cwd
  return { ...resolved, outDir }
}

export async function writeOpenAPISpec(spec: unknown, destination: string): Promise<void> {
  const resolved = path.resolve(destination)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  const content = isYamlPath(resolved)
    ? stringifyYaml(spec)
    : JSON.stringify(spec, null, 2)
  await fs.writeFile(resolved, content, 'utf-8')
}

function parseSpecText(raw: string, source: string): OpenAPISpec {
  if (isYamlPath(source)) {
    return parseYaml(raw) as OpenAPISpec
  }

  try {
    return JSON.parse(raw) as OpenAPISpec
  } catch (jsonError) {
    try {
      return parseYaml(raw) as OpenAPISpec
    } catch {
      throw jsonError
    }
  }
}

async function normalizeInputSource(input: string, cwd: string): Promise<string> {
  if (isUrl(input)) return input

  const resolved = path.resolve(cwd, input)
  try {
    await fs.access(resolved)
    return resolved
  } catch {}

  if (looksLikeHost(input)) {
    return `https://${input}`
  }

  return resolved
}

async function findDefaultSpec(cwd: string): Promise<string> {
  const candidates = [
    path.join(cwd, 'openapi.json'),
    path.join(cwd, 'openapi.yaml'),
    path.join(cwd, 'openapi.yml'),
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {}
  }

  return candidates[0]!
}

async function findLocalSpec(input: string): Promise<string | null> {
  const candidates: string[] = []

  try {
    const stat = await fs.stat(input)
    if (stat.isDirectory()) {
      candidates.push(
        path.join(input, 'openapi.json'),
        path.join(input, 'openapi.yaml'),
        path.join(input, 'openapi.yml'),
      )
    } else {
      candidates.push(input)
    }
  } catch {}

  if (!path.extname(input)) {
    candidates.push(
      `${input}.json`,
      `${input}.yaml`,
      `${input}.yml`,
      path.join(input, 'openapi.json'),
      path.join(input, 'openapi.yaml'),
      path.join(input, 'openapi.yml'),
    )
  }

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {}
  }

  return null
}

function buildUrlCandidates(source: string): string[] {
  const url = new URL(source)
  const pathname = url.pathname || '/'

  if (pathname.endsWith('.json') || pathname.endsWith('.yaml') || pathname.endsWith('.yml')) {
    return [url.toString()]
  }

  const normalizedBase = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const basePath = normalizedBase === '' ? '' : normalizedBase
  const base = `${url.origin}${basePath}`

  return [
    `${base}/openapi.json`,
    `${base}/openapi.yaml`,
    `${base}/openapi.yml`,
    source,
  ]
}

function deriveBaseUrlFromSpecSource(source: string): string | undefined {
  if (!isUrl(source)) return undefined
  const url = new URL(source)
  const pathname = url.pathname || '/'
  if (pathname.endsWith('/openapi.json') || pathname.endsWith('/openapi.yaml') || pathname.endsWith('/openapi.yml')) {
    url.pathname = pathname.replace(/\/openapi\.(json|ya?ml)$/i, '') || '/'
    return url.toString().replace(/\/$/, '')
  }
  return source.replace(/\/$/, '')
}

// ── extract operations from spec ────────────────────────────

export function extractOperations(spec: OpenAPISpec): OperationInfo[] {
  const operations: OperationInfo[] = []

  for (const [urlPath, methods] of Object.entries(spec.paths)) {
    for (const [httpMethod, op] of Object.entries(methods)) {
      if (!op.operationId) continue
      const inputSchema = op.requestBody?.content?.['application/json']?.schema
      const outputSchema = op.responses?.['200']?.content?.['application/json']?.schema
      operations.push({
        operationId: op.operationId,
        method: httpMethod.toUpperCase(),
        path: urlPath,
        summary: op.summary,
        inputSchema,
        outputSchema,
        parameters: op.parameters,
      })
    }
  }

  return operations
}

// ── camelCase → snake_case ──────────────────────────────────

export function toSnakeCase(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}
