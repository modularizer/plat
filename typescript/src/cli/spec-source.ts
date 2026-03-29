import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

export function getArgValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === flag) return args[i + 1]
    if (arg?.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
  }
  return undefined
}

export function getFirstPositionalArg(args: string[], valueFlags: string[] = ['--src']): string | undefined {
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

export function stripOption(args: string[], flag: string): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === flag) {
      i += 1
      continue
    }
    if (arg?.startsWith(`${flag}=`)) continue
    out.push(arg!)
  }
  return out
}

export function stripFirstPositionalArg(args: string[], valueFlags: string[] = ['--src']): string[] {
  const out: string[] = []
  let removed = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    if (arg.startsWith('--')) {
      out.push(arg)
      if (valueFlags.includes(arg) && args[i + 1]) {
        out.push(args[i + 1]!)
        i += 1
      }
      continue
    }
    if (!removed) {
      removed = true
      continue
    }
    out.push(arg)
  }
  return out
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

function isYamlPath(value: string): boolean {
  return /\.ya?ml$/i.test(value)
}

async function parseSpec(raw: string, source: string): Promise<any> {
  if (isYamlPath(source)) return parseYaml(raw)
  try {
    return JSON.parse(raw)
  } catch {
    return parseYaml(raw)
  }
}

function buildUrlCandidates(source: string): string[] {
  const url = new URL(source)
  const pathname = url.pathname || '/'
  if (pathname.endsWith('.json') || pathname.endsWith('.yaml') || pathname.endsWith('.yml')) {
    return [url.toString()]
  }
  const basePath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const base = `${url.origin}${basePath}`
  return [`${base}/openapi.json`, `${base}/openapi.yaml`, `${base}/openapi.yml`, source]
}

export async function loadSpecSource(src?: string, cwd = process.cwd()): Promise<{ spec: any; source: string; baseUrl?: string }> {
  if (!src) {
    const defaults = ['openapi.json', 'openapi.yaml', 'openapi.yml']
    for (const candidate of defaults) {
      const full = path.join(cwd, candidate)
      try {
        await fs.access(full)
        const raw = await fs.readFile(full, 'utf-8')
        return { spec: await parseSpec(raw, full), source: full }
      } catch {}
    }
    throw new Error('No OpenAPI spec found. Expected openapi.json/openapi.yaml/openapi.yml or pass --src.')
  }

  const normalizedSrc = await normalizeSpecInput(src, cwd)

  if (isUrl(normalizedSrc)) {
    let lastError: Error | null = null
    for (const candidate of buildUrlCandidates(normalizedSrc)) {
      try {
        const response = await fetch(candidate)
        if (!response.ok) {
          lastError = new Error(`Failed to fetch ${candidate}: ${response.status} ${response.statusText}`)
          continue
        }
        const raw = await response.text()
        return {
          spec: await parseSpec(raw, candidate),
          source: candidate,
          baseUrl: candidate.replace(/\/openapi\.(json|ya?ml)$/i, '').replace(/\/$/, ''),
        }
      } catch (error) {
        lastError = error as Error
      }
    }
    throw lastError ?? new Error(`Unable to load OpenAPI spec from ${normalizedSrc}`)
  }

  const sourcePath = await resolveLocalSpecPath(normalizedSrc)
  const raw = await fs.readFile(sourcePath, 'utf-8')
  return { spec: await parseSpec(raw, sourcePath), source: sourcePath }
}

async function normalizeSpecInput(src: string, cwd: string): Promise<string> {
  if (isUrl(src)) return src

  const resolved = path.resolve(cwd, src)
  try {
    await fs.access(resolved)
    return resolved
  } catch {}

  if (looksLikeHost(src)) {
    return `https://${src}`
  }

  return resolved
}

async function resolveLocalSpecPath(resolved: string): Promise<string> {
  try {
    const stat = await fs.stat(resolved)
    if (stat.isDirectory()) {
      for (const candidate of ['openapi.json', 'openapi.yaml', 'openapi.yml']) {
        const full = path.join(resolved, candidate)
        try {
          await fs.access(full)
          return full
        } catch {}
      }
      throw new Error(`No OpenAPI spec found in directory ${resolved}`)
    }
    return resolved
  } catch {}

  if (!path.extname(resolved)) {
    for (const candidate of [
      `${resolved}.json`,
      `${resolved}.yaml`,
      `${resolved}.yml`,
      path.join(resolved, 'openapi.json'),
      path.join(resolved, 'openapi.yaml'),
      path.join(resolved, 'openapi.yml'),
    ]) {
      try {
        await fs.access(candidate)
        return candidate
      } catch {}
    }
  }

  return resolved
}

export async function hasDirectorySpec(src: string, cwd = process.cwd()): Promise<boolean> {
  const resolved = path.resolve(cwd, src)
  try {
    const stat = await fs.stat(resolved)
    if (!stat.isDirectory()) return false
    for (const candidate of ['openapi.json', 'openapi.yaml', 'openapi.yml']) {
      try {
        await fs.access(path.join(resolved, candidate))
        return true
      } catch {}
    }
    return false
  } catch {
    return false
  }
}
