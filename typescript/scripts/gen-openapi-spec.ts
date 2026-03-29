/**
 * Generate a literal TypeScript OpenAPI spec module from openapi.json.
 *
 * This is meant for OpenAPIClient<TSpec> so the generated `paths` structure
 * stays fully literal and can power the dynamic proxy typings.
 *
 * Usage:
 *   npx tsx scripts/gen-openapi-spec.ts [--spec <file-or-url>] [--out <file-or-dir>]
 *
 * Examples:
 *   npx tsx scripts/gen-openapi-spec.ts
 *   npx tsx scripts/gen-openapi-spec.ts --spec http://localhost:3000/openapi.json
 *   npx tsx scripts/gen-openapi-spec.ts --spec ./openapi.json --out ./src/generated/openapi.spec.ts
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { loadSpec } from './openapi-common.js'

async function main() {
  const args = process.argv.slice(2)
  const { spec, outDir } = await loadSpec(args)
  const outPath = resolveOutputPath(args, outDir)
  const content = generateSpecModule(spec)

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, content, 'utf-8')

  console.log(`✅ Generated ${outPath}`)
}

function resolveOutputPath(args: string[], outDir: string): string {
  const outIdx = args.indexOf('--out')
  const outArg = outIdx !== -1 ? args[outIdx + 1] : undefined

  if (!outArg) {
    return path.join(outDir, 'openapi.spec.ts')
  }

  const resolved = path.resolve(outArg)
  if (resolved.endsWith('.ts')) {
    return resolved
  }

  return path.join(resolved, 'openapi.spec.ts')
}

function generateSpecModule(spec: unknown): string {
  const json = JSON.stringify(spec, null, 2)

  return `/**
 * Auto-generated from an OpenAPI document.
 * DO NOT EDIT MANUALLY.
 *
 * Regenerate with:
 *   npx tsx scripts/gen-openapi-spec.ts --spec <file-or-url> [--out <file-or-dir>]
 */

import type { OpenAPISpec } from '../src/types/openapi'

export const openAPISpec = ${json} as const satisfies OpenAPISpec

export type GeneratedOpenAPISpec = typeof openAPISpec

export default openAPISpec
`
}

main().catch((err) => {
  console.error('❌ Generation failed:', err.message)
  process.exit(1)
})
