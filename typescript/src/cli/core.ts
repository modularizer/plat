/**
 * The extensible CLI engine behind `plat run`, generated CLIs and any app-specific CLI.
 *
 * Everything an application might want to do differently is an option here, so nobody has to
 * bypass plat's CLI to get custom behaviour: add CLI-only commands, wrap or replace a method,
 * map bare words to parameters, discover the server, rewrite input or output, handle unknown
 * commands, format errors. Pure: no network, no node-only imports. The transport is `call`.
 */

import { resolveCommand, type ResolvedCommand } from '../args/method_name'
import { defaultFormatters, type CliFormatter } from './format'

/** One operation from the OpenAPI spec. */
export interface CliCommandInfo {
  name: string
  method: string
  path: string
  summary?: string
  params: { name: string; required: boolean }[]
}

/** Pull the callable operations out of an OpenAPI document. */
export function extractCommands(spec: any): CliCommandInfo[] {
  const commands: CliCommandInfo[] = []
  for (const [urlPath, methods] of Object.entries(spec?.paths ?? {} as Record<string, any>)) {
    for (const [httpMethod, _op] of Object.entries(methods as Record<string, any>)) {
      const op = _op as any
      if (!op?.operationId) continue
      const params: CliCommandInfo['params'] = []
      for (const p of op.parameters ?? []) params.push({ name: p.name, required: p.required ?? false })
      const schema = op.requestBody?.content?.['application/json']?.schema
      if (schema?.properties) {
        const required = new Set(schema.required ?? [])
        for (const name of Object.keys(schema.properties)) params.push({ name, required: required.has(name) })
      }
      commands.push({ name: op.operationId, method: httpMethod.toUpperCase(), path: urlPath, summary: op.summary, params })
    }
  }
  return commands
}

export interface CliParsed {
  input: Record<string, any>
  format: string
  /** Bare words after the command, in order (for `positional`). */
  words: string[]
}

export interface CliContext {
  /** The tokens after the command name (flags, `--k=v`, bare words). */
  argv: readonly string[]
  /** The matched spec operation; null for a CLI-only command. */
  command: CliCommandInfo | null
  /** The name that matched, canonical (`runCloneFeed`, or your custom command's key). */
  name: string
  /** What will be sent. `beforeCall` and overrides may change it. */
  input: Record<string, any>
  format: string
  spec: any
  options: CliOptions
  /** Print helpers that honour `options.io`. */
  log: (text: string) => void
  error: (text: string) => void
}

export type CliCall = (command: CliCommandInfo, input: Record<string, any>, ctx: CliContext) => Promise<unknown>

/** A CLI-only command. Return a value to have it printed in the chosen format, or print yourself. */
export type CliCustomCommand = (ctx: CliContext) => unknown | Promise<unknown>

/** Wrap or replace a spec method for the CLI. `next` performs the normal call (with the current input). */
export type CliOverride = (ctx: CliContext, next: (input?: Record<string, any>) => Promise<unknown>) => unknown | Promise<unknown>

export interface CliUnknown {
  argv: readonly string[]
  reason: 'unknown' | 'ambiguous'
  candidates: string[]
  spec: any
}

export interface CliOptions {
  /** The OpenAPI document, or a function that gets it (fetch it, read a file, discover a server).
   *  Loaded lazily: only when a spec method, help or onUnknown needs it, never for a CLI-only command. */
  spec: any | (() => any | Promise<any>)
  /** The transport. Plat's runtime supplies one over `OpenAPIClient`; the light entry over `fetch`. */
  call: CliCall
  /** CLI-only commands, matched before spec methods; they win on a name clash (a custom `describe` is
   *  never turned into a longer stitched method like `describeRelation`). A custom `help` replaces the
   *  built-in help for `help`, `--help` and `-h`. Multi-word keys work. */
  commands?: Record<string, CliCustomCommand>
  /** Wraps EVERY spec call (outermost): confirmations, retries, logging. `next` does the rest of the chain. */
  around?: (ctx: CliContext, next: (input?: Record<string, any>) => Promise<unknown>) => unknown | Promise<unknown>
  /** Per-method CLI behaviour layered on top of a spec method. */
  overrides?: Record<string, CliOverride>
  /** `{ sql: ['datasource', 'query'] }` — bare words after the command fill these params, in order. */
  positional?: Record<string, string[]>
  /** Replace argument parsing entirely. */
  parseArgs?: (argv: readonly string[], command: CliCommandInfo | null) => CliParsed
  /** Replace how a typed name maps to a command (default: any spelling, longest match). */
  resolveName?: (names: readonly string[], argv: readonly string[]) => ResolvedCommand
  /** Runs before every spec call; mutate `ctx.input`, throw to abort. */
  beforeCall?: (ctx: CliContext) => void | Promise<void>
  /** Runs on every spec result; return what to print. */
  afterCall?: (result: unknown, ctx: CliContext) => unknown | Promise<unknown>
  /** Fallback for an unknown or ambiguous command. Return true if you handled it. */
  onUnknown?: (info: CliUnknown, ctx: Pick<CliContext, 'log' | 'error' | 'options'>) => boolean | void | Promise<boolean | void>
  /** Replace how errors are reported. Default: print the message and exit 1. */
  onError?: (err: unknown, ctx: Pick<CliContext, 'log' | 'error' | 'options'>) => void
  /** Replace the help text (return the string to print, or print yourself and return undefined). */
  help?: (commands: CliCommandInfo[], options: CliOptions, spec: any) => string | void
  /** Extra or replacement `--format` values. */
  formatters?: Record<string, CliFormatter>
  defaultFormat?: string
  /** Title line in the default help. */
  title?: string
  /** Override console/exit (tests, embedding). */
  io?: { log?: (t: string) => void; error?: (t: string) => void; exit?: (code: number) => never }
}

export function defaultParseArgs(argv: readonly string[]): CliParsed {
  const input: Record<string, any> = {}
  const words: string[] = []
  let format = ''
  for (const arg of argv) {
    const m = arg.match(/^--([\w-]+)=(.*)$/) || arg.match(/^--([\w-]+)$/)
    if (!m) {
      words.push(arg)
      continue
    }
    if (m[1] === 'format') { format = m[2] ?? ''; continue }
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
  return { input, format, words }
}

export function defaultHelp(commands: CliCommandInfo[], options: CliOptions, spec: any): string {
  const lines = [`${options.title ?? spec?.info?.title ?? 'API'} CLI\n`]
  lines.push('Usage: <command> [--key=value ...] [--format=json|yaml|table|csv|human]\n')
  lines.push('Commands:')
  for (const name of Object.keys(options.commands ?? {})) lines.push(`  ${name}`)
  for (const cmd of commands) {
    const params = cmd.params.map(p => p.required ? `--${p.name}` : `[--${p.name}]`).join(' ')
    const summary = cmd.summary ? `  — ${cmd.summary}` : ''
    lines.push(`  ${cmd.name.padEnd(30)} ${params}${summary}`)
  }
  return lines.join('\n')
}

/** Run the CLI. Resolves when done; failures go through `onError` (default: exit 1). */
export async function runCliCore(options: CliOptions, argv: readonly string[]): Promise<void> {
  const log = options.io?.log ?? ((t: string) => console.log(t))
  const error = options.io?.error ?? ((t: string) => console.error(t))
  const exit = options.io?.exit ?? ((code: number) => process.exit(code))
  const base = { log, error, options }
  const fail = (err: unknown) => {
    if (options.onError) return options.onError(err, base)
    error(err instanceof Error ? err.message : String(err))
    exit(1)
  }

  try {
    const custom = options.commands ?? {}
    const formatters = { ...defaultFormatters, ...options.formatters }
    let loaded: { spec: any; commands: CliCommandInfo[] } | undefined
    const load = async () => {
      if (!loaded) {
        const spec = typeof options.spec === 'function' ? await options.spec() : options.spec
        loaded = { spec, commands: extractCommands(spec) }
      }
      return loaded
    }
    const resolver = options.resolveName ?? resolveCommand

    const [first] = argv
    const wantsHelp = first === undefined || first === 'help' || first === '--help' || first === '-h'
    if (wantsHelp && !custom.help) {
      const { spec, commands } = await load()
      const text = (options.help ?? defaultHelp)(commands, options, spec)
      if (text !== undefined) log(text)
      return exit(0)
    }

    // CLI-only commands first, so the spec (and the network) is only needed for spec methods.
    let resolved = resolver(Object.keys(custom), wantsHelp ? ['help'] : argv)
    // A replaced resolver may answer with a spec name it was never offered; only custom names count here.
    if (resolved.ok && !custom[resolved.name]) resolved = { ok: false, reason: 'unknown', candidates: [] }
    let spec: any = undefined
    let commands: CliCommandInfo[] = []
    if (!resolved.ok && resolved.reason === 'unknown') {
      ;({ spec, commands } = await load())
      resolved = resolver(commands.map(c => c.name), argv)
    }
    if (!resolved.ok) {
      const handled = await options.onUnknown?.({ argv, reason: resolved.reason, candidates: resolved.candidates, spec }, base)
      if (handled === true) return
      return fail(new Error(resolved.reason === 'ambiguous'
        ? `Ambiguous command: ${first}. Could be: ${resolved.candidates.join(', ')}.`
        : `Unknown command: ${first}. Run with --help for available commands.`))
    }
    if (wantsHelp) resolved = { ...resolved, consumed: first === undefined ? 0 : 1 }

    const command = custom[resolved.name] ? null : commands.find(c => c.name === resolved.name) ?? null
    const rest = argv.slice(resolved.consumed)
    const parsed = (options.parseArgs ?? defaultParseArgs)(rest, command)
    const input = { ...parsed.input }
    const positional = options.positional?.[resolved.name] ?? []
    positional.forEach((param, index) => {
      const word = parsed.words[index]
      if (word !== undefined && input[param] === undefined) input[param] = word
    })
    const format = parsed.format || options.defaultFormat || 'json'
    const ctx: CliContext = { ...base, argv: rest, command, name: resolved.name, input, format, spec }

    const print = (value: unknown) => {
      if (value === undefined) return
      const formatter = formatters[format]
      if (!formatter) throw new Error(`Unknown format: ${format}. Available: ${Object.keys(formatters).join(', ')}`)
      log(formatter(value))
    }

    const customRun = custom[resolved.name]
    if (customRun) return print(await customRun(ctx))
    if (!command) return

    const call = async (override?: Record<string, any>) => {
      if (override) ctx.input = override
      await options.beforeCall?.(ctx)
      const result = await options.call(command, ctx.input, ctx)
      return options.afterCall ? options.afterCall(result, ctx) : result
    }
    const override = options.overrides?.[resolved.name]
    const inner = override ? () => override(ctx, call) : () => call()
    print(options.around ? await options.around(ctx, async (input) => {
      if (input) ctx.input = input
      return inner()
    }) : await inner())
  } catch (err) {
    fail(err)
  }
}
