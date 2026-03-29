/**
 * Generate a CLI wrapper from OpenAPI specification
 *
 * Creates a tiny src/cli.ts that delegates to plat's generic CLI runtime.
 * All arg parsing, formatting, and dispatch lives in plat's runCli().
 *
 * Usage: npx tsx scripts/gen-cli.ts
 */

import fs from 'node:fs/promises'
import path from 'node:path'

async function main() {
  const projectRoot = process.cwd()
  const outPath = path.join(projectRoot, 'src', 'cli.ts')

  // Find the openapi.json relative to src/
  const candidates = [
    { abs: path.join(projectRoot, 'openapi.json'), rel: '../openapi.json' },
    { abs: path.join(projectRoot, 'generated', 'openapi.json'), rel: '../generated/openapi.json' },
  ]

  let specImport = '../openapi.json'
  for (const { abs, rel } of candidates) {
    try {
      await fs.access(abs)
      specImport = rel
      break
    } catch {}
  }

  const code = `#!/usr/bin/env npx tsx
/**
 * GENERATED: CLI
 * @generated npm run gen
 * ⚠️  DO NOT EDIT - Regenerate with: npm run gen
 */

import { runCli } from 'plat'
import spec from '${specImport}'

runCli(spec)
`

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, code, 'utf-8')
  console.log(`✅ Generated CLI: ${outPath}`)
}

main().catch((err) => {
  console.error('❌ CLI generation failed:', err.message)
  process.exit(1)
})
