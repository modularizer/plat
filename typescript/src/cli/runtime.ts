/**
 * Generic CLI runtime that works with any OpenAPI spec.
 *
 * Generated CLIs just pass in their spec — all arg parsing,
 * formatting, and dispatch lives here.
 */

import { OpenAPIClient, type OpenAPIClientConfig } from '../client/openapi-client'
import { createClientSideServerMQTTWebRTCTransportPlugin } from '../client-side-server/mqtt-webrtc'

// ── types ──────────────────────────────────────────────────

interface CliCommand {
  name: string
  method: string
  path: string
  summary?: string
  params: { name: string; required: boolean }[]
}

export interface RunCliOptions {
  /** Override base URL (default: spec.servers[0].url or env) */
  baseUrl?: string
  /** Extra headers to send */
  headers?: Record<string, string>
  /** OpenAPIClient config overrides */
  clientConfig?: Partial<OpenAPIClientConfig>
}

// ── extract commands from spec ─────────────────────────────

function extractCommands(spec: any): CliCommand[] {
  const commands: CliCommand[] = []
  for (const [urlPath, methods] of Object.entries(spec.paths ?? {} as Record<string, any>)) {
    for (const [httpMethod, _op] of Object.entries(methods as Record<string, any>)) {
      const op = _op as any
      if (!op.operationId) continue
      const params: CliCommand['params'] = []
      if (op.parameters) {
        for (const p of op.parameters) {
          params.push({ name: p.name, required: p.required ?? false })
        }
      }
      if (op.requestBody?.content?.['application/json']?.schema?.properties) {
        const schema = op.requestBody.content['application/json'].schema
        const reqSet = new Set(schema.required ?? [])
        for (const name of Object.keys(schema.properties)) {
          params.push({ name, required: reqSet.has(name) })
        }
      }
      commands.push({
        name: op.operationId,
        method: httpMethod.toUpperCase(),
        path: urlPath,
        summary: op.summary,
        params,
      })
    }
  }
  return commands
}

// ── arg parser ─────────────────────────────────────────────

function parseArgs(argv: string[]): { input: Record<string, any>; format: string } {
  const input: Record<string, any> = {}
  let format = 'json'
  for (const arg of argv) {
    const m = arg.match(/^--([\w-]+)=(.*)$/) || arg.match(/^--([\w-]+)$/)
    if (!m) continue
    if (m[1] === 'format') { format = m[2] ?? 'json'; continue }
    const key = m[1]!.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    let val: any = m[2] ?? true
    if (val === 'true') val = true
    else if (val === 'false') val = false
    else if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val)) val = Number(val)
    else if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
      try { val = JSON.parse(val) } catch {}
    }
    input[key] = val
  }
  return { input, format }
}

// ── formatters ─────────────────────────────────────────────

function formatJson(data: any): string {
  return JSON.stringify(data, null, 2)
}

function formatYaml(data: any, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (data === null || data === undefined) return pad + 'null'
  if (typeof data === 'string') return data.includes('\n') ? `|\n${data.split('\n').map(l => pad + '  ' + l).join('\n')}` : data
  if (typeof data !== 'object') return String(data)
  if (Array.isArray(data)) {
    if (data.length === 0) return '[]'
    return data.map(item => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item)
        const first = entries[0]!
        const rest = entries.slice(1)
        let s = pad + '- ' + first[0] + ': ' + formatYaml(first[1], indent + 2)
        for (const [k, v] of rest) s += '\n' + pad + '  ' + k + ': ' + formatYaml(v, indent + 2)
        return s
      }
      return pad + '- ' + formatYaml(item, indent + 1)
    }).join('\n')
  }
  const entries = Object.entries(data)
  if (entries.length === 0) return '{}'
  return entries.map(([k, v]) => {
    if (typeof v === 'object' && v !== null) return pad + k + ':\n' + formatYaml(v, indent + 1)
    return pad + k + ': ' + formatYaml(v, indent)
  }).join('\n')
}

function formatHuman(data: any, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (data === null || data === undefined) return pad + '\u2014'
  if (typeof data !== 'object') return pad + String(data)
  if (Array.isArray(data)) {
    if (data.length === 0) return pad + '(empty)'
    return data.map((item, i) => {
      const prefix = pad + (i + 1) + '. '
      const body = formatHuman(item, 0).trimStart()
      const contPad = ' '.repeat(prefix.length)
      return prefix + body.split('\n').map((line, j) => j === 0 ? line : contPad + line).join('\n')
    }).join('\n')
  }
  return Object.entries(data).map(([k, v]) => {
    if (typeof v === 'object' && v !== null) return pad + k + ':\n' + formatHuman(v, indent + 1)
    return pad + k + ': ' + (v ?? '\u2014')
  }).join('\n')
}

function formatTable(data: any): string {
  let rows: any[]
  if (Array.isArray(data)) rows = data
  else if (typeof data === 'object' && data !== null) {
    const vals = Object.values(data)
    const arrVal = vals.find(v => Array.isArray(v))
    if (arrVal) rows = arrVal as any[]
    else rows = [data]
  } else {
    return String(data)
  }

  if (rows.length === 0) return '(empty)'
  if (typeof rows[0] !== 'object' || rows[0] === null) return rows.map(String).join('\n')

  const flatRows = rows.map(row => {
    const flat: Record<string, string> = {}
    for (const [k, v] of Object.entries(row)) {
      flat[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
    }
    return flat
  })

  const cols = Array.from(new Set(flatRows.flatMap(r => Object.keys(r))))
  const termWidth = (process.stdout as any).columns || 120

  const widths: Record<string, number> = {}
  for (const col of cols) {
    widths[col] = col.length
    for (const row of flatRows) {
      widths[col] = Math.max(widths[col]!, (row[col] || '').length)
    }
  }

  const borders = 1 + cols.length * 3
  let totalWidth = borders + cols.reduce((s, c) => s + widths[c]!, 0)
  while (totalWidth > termWidth) {
    let widest = cols[0]!, maxW = 0
    for (const c of cols) { if (widths[c]! > maxW) { maxW = widths[c]!; widest = c } }
    if (maxW <= 4) break
    widths[widest] = Math.max(4, widths[widest]! - 1)
    totalWidth = borders + cols.reduce((s, c) => s + widths[c]!, 0)
  }

  const truncate = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + '\u2026' : s

  const hline = (left: string, mid: string, right: string) =>
    left + cols.map(c => '\u2500'.repeat(widths[c]! + 2)).join(mid) + right
  const dataRow = (row: Record<string, string>) =>
    '\u2502' + cols.map(c => ' ' + truncate(row[c] || '', widths[c]!).padEnd(widths[c]!) + ' ').join('\u2502') + '\u2502'

  const lines: string[] = []
  lines.push(hline('\u250c', '\u252c', '\u2510'))
  lines.push('\u2502' + cols.map(c => ' ' + truncate(c, widths[c]!).padEnd(widths[c]!) + ' ').join('\u2502') + '\u2502')
  lines.push(hline('\u251c', '\u253c', '\u2524'))
  for (const row of flatRows) lines.push(dataRow(row))
  lines.push(hline('\u2514', '\u2534', '\u2518'))
  return lines.join('\n')
}

function formatCsv(data: any): string {
  let rows: any[]
  if (Array.isArray(data)) rows = data
  else if (typeof data === 'object' && data !== null) {
    const arrVal = Object.values(data).find(v => Array.isArray(v))
    if (arrVal) rows = arrVal as any[]
    else rows = [data]
  } else return String(data)

  if (rows.length === 0) return ''
  if (typeof rows[0] !== 'object' || rows[0] === null) return rows.map(String).join('\n')

  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))))
  const esc = (v: any) => {
    const s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [cols.join(',')]
  for (const row of rows) lines.push(cols.map(c => esc(row[c])).join(','))
  return lines.join('\n')
}

function output(data: any, format: string) {
  switch (format) {
    case 'yaml': console.log(formatYaml(data)); break
    case 'table': console.log(formatTable(data)); break
    case 'csv': console.log(formatCsv(data)); break
    case 'human': console.log(formatHuman(data)); break
    default: console.log(formatJson(data))
  }
}

// ── main entry point ───────────────────────────────────────

export async function runCli(spec: any, argvOrOptions?: string[] | RunCliOptions, maybeOptions?: RunCliOptions) {
  const argv = Array.isArray(argvOrOptions) ? argvOrOptions : process.argv.slice(2)
  const options = Array.isArray(argvOrOptions) ? maybeOptions : argvOrOptions
  const commands = extractCommands(spec)
  const [command, ...rest] = argv

  if (!command || command === 'help' || command === '--help') {
    const title = spec.info?.title ?? 'API'
    console.log(`${title} CLI\n`)
    console.log('Usage: <command> [--key=value ...] [--format=json|yaml|table|csv|human]\n')
    console.log('Commands:')
    for (const cmd of commands) {
      const params = cmd.params.map(p => p.required ? `--${p.name}` : `[--${p.name}]`).join(' ')
      const summary = cmd.summary ? `  \u2014 ${cmd.summary}` : ''
      console.log(`  ${cmd.name.padEnd(30)} ${params}${summary}`)
    }
    console.log('\nEnvironment Variables:')
    console.log('  API_URL        Base URL (default: from spec or http://localhost:3000)')
    console.log('  API_TOKEN      Bearer auth token')
    process.exit(0)
  }

  const matched = commands.find(c => c.name === command)
  if (!matched) {
    console.error(`Unknown command: ${command}. Run with --help for available commands.`)
    process.exit(1)
  }

  const baseUrl = options?.baseUrl
    ?? process.env.API_URL
    ?? process.env.API_BASE_URL
    ?? spec.servers?.[0]?.url
    ?? 'http://localhost:3000'

  const token = process.env.API_TOKEN
  const clientConfig: Partial<OpenAPIClientConfig> = {
    ...options?.clientConfig,
  }

  if (
    baseUrl.startsWith('css://')
    && !clientConfig.transportPlugins?.length
  ) {
    clientConfig.transportPlugins = [createClientSideServerMQTTWebRTCTransportPlugin()]
  }

  const client = new OpenAPIClient(spec, {
    baseUrl,
    headers: {
      ...options?.headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...clientConfig,
  })

  const { input, format } = parseArgs(rest)

  try {
    const method = matched.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
    const result = await client[method](matched.path, input)
    output(result, format)
  } catch (err: any) {
    console.error(err.message)
    process.exit(1)
  }
}
