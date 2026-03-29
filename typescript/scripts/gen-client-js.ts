/**
 * Generate a plain JavaScript client from an OpenAPI spec.
 *
 * Produces a single api.mjs (ESM) with JSDoc type annotations.
 * Zero dependencies — uses native fetch. No build step needed.
 *
 * Usage:
 *   npx tsx scripts/gen-client-js.ts [--spec <file-or-url>] [--out <dir>]
 *
 * Examples:
 *   npx tsx scripts/gen-client-js.ts
 *   npx tsx scripts/gen-client-js.ts --spec http://localhost:3000/openapi.json
 *   npx tsx scripts/gen-client-js.ts --spec ../other-repo/openapi.json --out ./clients
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import {
    loadSpec, extractOperations,
    type SchemaObject, type OperationInfo,
} from './openapi-common'

// ── JSON Schema → JSDoc type ────────────────────────────────

function schemaToJsDocType(schema: SchemaObject): string {
    if (schema.$ref) return schema.$ref.split('/').pop()!

    if (schema.enum) {
        return schema.enum.map(v => typeof v === 'string' ? `'${v}'` : String(v)).join(' | ')
    }

    switch (schema.type) {
        case 'string':   return 'string'
        case 'integer':
        case 'number':   return 'number'
        case 'boolean':  return 'boolean'
        case 'array':    return schema.items ? `${schemaToJsDocType(schema.items)}[]` : 'any[]'
        case 'object': {
            if (!schema.properties) return 'Object'
            const reqSet = new Set(schema.required ?? [])
            const fields = Object.entries(schema.properties)
                .map(([n, s]) => `${n}${reqSet.has(n) ? '' : '?'}: ${schemaToJsDocType(s)}`)
            return `{${fields.join(', ')}}`
        }
        default:         return 'any'
    }
}

// ── generate JSDoc typedef ──────────────────────────────────

function generateTypedef(name: string, schema: SchemaObject): string {
    if (!schema.properties) return ''

    const reqSet = new Set(schema.required ?? [])
    const lines: string[] = []

    lines.push(`/**`)
    if (schema.description) lines.push(` * ${schema.description}`)
    lines.push(` * @typedef {Object} ${name}`)

    for (const [prop, propSchema] of Object.entries(schema.properties)) {
        const type = schemaToJsDocType(propSchema)
        const opt = reqSet.has(prop) ? '' : '?'
        const desc = propSchema.description ? ` - ${propSchema.description}` : ''
        // JSDoc uses [name] for optional
        if (opt) {
            lines.push(` * @property {${type}} [${prop}]${desc}`)
        } else {
            lines.push(` * @property {${type}} ${prop}${desc}`)
        }
    }

    lines.push(` */`)
    return lines.join('\n')
}

// ── collect params ──────────────────────────────────────────

interface ParamInfo {
    name: string
    jsDocType: string
    required: boolean
}

function collectParams(op: OperationInfo): ParamInfo[] {
    const params: ParamInfo[] = []

    if (op.parameters) {
        for (const p of op.parameters) {
            params.push({
                name: p.name,
                jsDocType: schemaToJsDocType(p.schema),
                required: p.required ?? false,
            })
        }
    }

    if (op.inputSchema?.properties) {
        const reqSet = new Set(op.inputSchema.required ?? [])
        for (const [name, propSchema] of Object.entries(op.inputSchema.properties)) {
            params.push({
                name,
                jsDocType: schemaToJsDocType(propSchema),
                required: reqSet.has(name),
            })
        }
    }

    params.sort((a, b) => (a.required === b.required ? 0 : a.required ? -1 : 1))
    return params
}

// ── generate ─────────────────────────────────────────────────

function generate(spec: any, operations: any[], schemas: Record<string, SchemaObject>, cjs: boolean): string {
    const baseUrl = spec.servers?.[0]?.url ?? 'http://localhost:3000'
    const lines: string[] = []

    lines.push(`/**`)
    lines.push(` * plat API Client (JavaScript${cjs ? ' — CommonJS' : ''})`)
    lines.push(` *`)
    lines.push(` * Auto-generated from openapi.json — DO NOT EDIT`)
    lines.push(` * Regenerate with: npx tsx scripts/gen-client-js.ts`)
    lines.push(` *`)
    lines.push(` * Zero dependencies — uses native fetch.`)
    lines.push(` */`)
    lines.push(``)

    // typedefs
    const typedefs: string[] = []
    for (const [name, schema] of Object.entries(schemas)) {
        if (schema.type === 'object' && schema.properties) {
            typedefs.push(generateTypedef(name, schema))
        }
    }
    if (typedefs.length > 0) {
        lines.push(`// ── Data Models ──────────────────────────────────────────`)
        lines.push(``)
        lines.push(typedefs.join('\n\n'))
        lines.push(``)
    }

    // client class
    const esm = !cjs
    const exp = esm ? 'export ' : ''
    const priv = esm ? '#' : '_'

    lines.push(`// ── API Client ──────────────────────────────────────────`)
    lines.push(``)
    lines.push(`${exp}class ApiClient {`)
    if (esm) {
        lines.push(`  /** @type {string} */ #baseUrl`)
        lines.push(`  /** @type {Record<string, string>} */ #headers`)
        lines.push(`  /** @type {number} */ #timeout`)
        lines.push(`  /** @type {number} */ #retries`)
        lines.push(`  /** @type {number} */ #backoff`)
    }
    lines.push(``)
    lines.push(`  /**`)
    lines.push(`   * @param {Object} [options]`)
    lines.push(`   * @param {string} [options.baseUrl='${baseUrl}']`)
    lines.push(`   * @param {Record<string, string>} [options.headers]`)
    lines.push(`   * @param {number} [options.timeout=30000]`)
    lines.push(`   * @param {number} [options.retries=3]`)
    lines.push(`   * @param {number} [options.backoff=500] - base backoff in ms, doubles each retry`)
    lines.push(`   */`)
    lines.push(`  constructor(options = {}) {`)
    lines.push(`    this.${priv}baseUrl = (options.baseUrl ?? '${baseUrl}').replace(/\\/$/, '')`)
    lines.push(`    this.${priv}headers = { 'Content-Type': 'application/json', ...options.headers }`)
    lines.push(`    this.${priv}timeout = options.timeout ?? 30000`)
    lines.push(`    this.${priv}retries = options.retries ?? 3`)
    lines.push(`    this.${priv}backoff = options.backoff ?? 500`)
    lines.push(`  }`)
    lines.push(``)

    // private fetch helper with retry
    lines.push(`  async ${priv}request(method, path, opts) {`)
    lines.push(`    let url = this.${priv}baseUrl + path`)
    lines.push(`    if (opts?.params) {`)
    lines.push(`      const qs = Object.entries(opts.params)`)
    lines.push(`        .filter(([, v]) => v !== undefined && v !== null)`)
    lines.push(`        .map(([k, v]) => \`\${encodeURIComponent(k)}=\${encodeURIComponent(v)}\`)`)
    lines.push(`        .join('&')`)
    lines.push(`      if (qs) url += '?' + qs`)
    lines.push(`    }`)
    lines.push(`    const retryable = new Set([429, 500, 502, 503, 504])`)
    lines.push(`    let lastErr`)
    lines.push(`    for (let attempt = 0; attempt <= this.${priv}retries; attempt++) {`)
    lines.push(`      try {`)
    lines.push(`        const res = await fetch(url, {`)
    lines.push(`          method,`)
    lines.push(`          headers: { ...this.${priv}headers, ...opts?.headers },`)
    lines.push(`          body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,`)
    lines.push(`          signal: AbortSignal.timeout(this.${priv}timeout),`)
    lines.push(`        })`)
    lines.push(`        if (!retryable.has(res.status) || attempt === this.${priv}retries) {`)
    lines.push(`          if (!res.ok) {`)
    lines.push(`            const text = await res.text().catch(() => '')`)
    lines.push(`            throw new Error(\`\${method} \${path} failed (\${res.status}): \${text}\`)`)
    lines.push(`          }`)
    lines.push(`          return res.json()`)
    lines.push(`        }`)
    lines.push(`        lastErr = new Error(\`\${method} \${path} returned \${res.status}\`)`)
    lines.push(`      } catch (err) {`)
    lines.push(`        if (attempt === this.${priv}retries) throw err`)
    lines.push(`        lastErr = err`)
    lines.push(`      }`)
    lines.push(`      const delay = this.${priv}backoff * (2 ** attempt) + Math.random() * this.${priv}backoff`)
    lines.push(`      await new Promise(r => setTimeout(r, delay))`)
    lines.push(`    }`)
    lines.push(`    throw lastErr`)
    lines.push(`  }`)
    lines.push(``)

    // methods
    for (const op of operations) {
        const params = collectParams(op)
        const isGet = op.method === 'GET' || op.method === 'DELETE'

        // JSDoc block
        lines.push(`  /**`)
        if (op.summary) lines.push(`   * ${op.summary}`)

        if (params.length > 0) {
            // build @param with destructured fields
            for (const p of params) {
                if (p.required) {
                    lines.push(`   * @param {${p.jsDocType}} input.${p.name}`)
                } else {
                    lines.push(`   * @param {${p.jsDocType}} [input.${p.name}]`)
                }
            }
        }

        lines.push(`   */`)

        const hasInput = params.length > 0
        const allOptional = params.every(p => !p.required)
        const inputArg = hasInput ? (allOptional ? 'input = {}' : 'input') : ''

        lines.push(`  async ${op.operationId}(${inputArg}) {`)

        if (isGet) {
            if (hasInput) {
                lines.push(`    return this.${priv}request('${op.method}', '${op.path}', { params: input })`)
            } else {
                lines.push(`    return this.${priv}request('${op.method}', '${op.path}')`)
            }
        } else {
            if (hasInput) {
                lines.push(`    return this.${priv}request('${op.method}', '${op.path}', { body: input })`)
            } else {
                lines.push(`    return this.${priv}request('${op.method}', '${op.path}')`)
            }
        }

        lines.push(`  }`)
        lines.push(``)
    }

    lines.push(`}`)
    lines.push(``)
    lines.push(`/**`)
    lines.push(` * @param {Object} [options]`)
    lines.push(` * @param {string} [options.baseUrl]`)
    lines.push(` * @param {Record<string, string>} [options.headers]`)
    lines.push(` * @param {number} [options.timeout]`)
    lines.push(` * @returns {ApiClient}`)
    lines.push(` */`)
    lines.push(`${exp}function createApiClient(options) {`)
    lines.push(`  return new ApiClient(options)`)
    lines.push(`}`)
    lines.push(``)

    if (cjs) {
        lines.push(`module.exports = { ApiClient, createApiClient }`)
        lines.push(``)
    }

    return lines.join('\n')
}

// ── main ────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2)
    const { spec, outDir } = await loadSpec(args)
    const schemas = spec.components?.schemas ?? {}
    const operations = extractOperations(spec)

    await fs.mkdir(outDir, { recursive: true })

    const esmFile = path.join(outDir, 'api.mjs')
    await fs.writeFile(esmFile, generate(spec, operations, schemas, false))
    console.log(`Generated ${esmFile} (${operations.length} methods, ESM)`)

    const cjsFile = path.join(outDir, 'api.cjs')
    await fs.writeFile(cjsFile, generate(spec, operations, schemas, true))
    console.log(`Generated ${cjsFile} (${operations.length} methods, CJS)`)
}

main().catch(err => { console.error(err); process.exit(1) })