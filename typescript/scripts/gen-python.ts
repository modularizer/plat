/**
 * Generate a typed Python client from an OpenAPI spec.
 *
 * This delegates to the Python package's code generator so the npm/tsx and
 * Python CLIs emit the same client shape.
 *
 * Usage:
 *   npx tsx scripts/gen-python.ts [--src <file-or-url>] [--dst <dir>]
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadSpec } from './openapi-common.js'

async function main() {
  const args = process.argv.slice(2)
  const { spec, outDir, specSource, suggestedBaseUrl } = await loadSpec(args)
  const outputDir = path.resolve(outDir)
  const outputFile = path.join(outputDir, 'api_client.py')

  await fs.mkdir(outputDir, { recursive: true })

  const pythonRoot = path.resolve(process.cwd(), 'python')
  const generator = [
    'import json, os, sys',
    'sys.path.insert(0, os.environ["PLAT_PYTHONPATH"])',
    'from plat.openapi_codegen import generate_python_client',
    'payload = json.loads(sys.stdin.read())',
    'print(generate_python_client(payload["spec"], payload["source"], payload.get("base_url")), end="")',
  ].join('; ')

  const content = execFileSync(
    'python3',
    ['-c', generator],
    {
      cwd: process.cwd(),
      env: { ...process.env, PLAT_PYTHONPATH: pythonRoot },
      input: JSON.stringify({
        spec,
        source: specSource,
        base_url: suggestedBaseUrl ?? spec.servers?.[0]?.url ?? 'http://localhost:3000',
      }),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  )

  await fs.writeFile(outputFile, content, 'utf-8')
  console.log(`Generated ${outputFile}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
