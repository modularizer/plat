/**
 * Generate a thin typed client bootstrap from an OpenAPI spec.
 *
 * TypeScript output embeds the literal spec so OpenAPIClient gets a precise
 * TSpec and the dynamic proxy becomes fully typed.
 *
 * Usage:
 *   npx tsx scripts/gen-client-openapi.ts [--src <file-or-url>] [--dst <file>]
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadSpec } from './openapi-common.js'

async function main() {
  const args = process.argv.slice(2)
  const { spec, specSource, suggestedBaseUrl } = await loadSpec(args)
  const outPath = resolveOutputPath(args)

  if (outPath.endsWith('.py')) {
    await generatePythonClientFile(args, outPath)
    return
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, generateTsClient(spec, specSource, suggestedBaseUrl), 'utf-8')
  console.log(`Generated ${outPath}`)
}

function resolveOutputPath(args: string[]): string {
  const value = getDstArg(args) ?? 'client.ts'
  return path.resolve(value)
}

function getDstArg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dst') return args[i + 1]
    if (arg?.startsWith('--dst=')) return arg.slice('--dst='.length)
  }
  return undefined
}

function generateTsClient(spec: unknown, specSource: string, suggestedBaseUrl?: string): string {
  const literal = JSON.stringify(spec, null, 2)
  const defaultBaseUrl = JSON.stringify(suggestedBaseUrl ?? defaultBaseUrlForSpec(spec))

  return `/**
 * Auto-generated OpenAPI client bootstrap.
 * Source: ${specSource}
 * DO NOT EDIT MANUALLY.
 */

import { OpenAPIClient, type OpenAPIClientConfig } from 'plat'
import type { OpenAPISpec } from 'plat'

export const openAPISpec = ${literal} as const satisfies OpenAPISpec

export type ApiSpec = typeof openAPISpec
export type ApiClient = OpenAPIClient<ApiSpec>

export const defaultBaseUrl = ${defaultBaseUrl}

export function createClient(
  baseUrl: string = defaultBaseUrl,
  config?: OpenAPIClientConfig,
): ApiClient {
  return new OpenAPIClient<ApiSpec>(openAPISpec, { ...config, baseUrl })
}

export default createClient
`
}

async function generatePythonClientFile(args: string[], outPath: string): Promise<void> {
  const outDir = path.dirname(outPath)
  await fs.mkdir(outDir, { recursive: true })

  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'gen-python.ts')
  const forwardedArgs = buildForwardedArgs(args, outDir)
  execFileSync('npx', ['tsx', scriptPath, ...forwardedArgs], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  const generatedPath = path.join(outDir, 'api_client.py')
  if (generatedPath !== outPath) {
    await fs.rename(generatedPath, outPath)
  }

  console.log(`Generated ${outPath}`)
}

function buildForwardedArgs(args: string[], outDir: string): string[] {
  const out: string[] = ['--dst', outDir]
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    if (arg === '--src') {
      out.push('--src', args[i + 1]!)
      i += 1
      continue
    }
    if (arg.startsWith('--src=')) {
      out.push(arg)
    }
  }
  return out
}

function defaultBaseUrlForSpec(spec: any): string {
  return spec?.servers?.[0]?.url ?? 'http://localhost:3000'
}

main().catch((err) => {
  console.error('❌ Generation failed:', err.message)
  process.exit(1)
})
