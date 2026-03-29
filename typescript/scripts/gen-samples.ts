/**
 * Generate all clients/CLIs for all sample projects.
 *
 * Reads each sample's .env, determines which generators to run,
 * and invokes them. This is called by `npm test` to ensure
 * generated files stay in sync.
 *
 * Usage: npx tsx scripts/gen-samples.ts
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const SAMPLES_DIR = path.join(ROOT, 'samples')
const SCRIPTS = path.join(ROOT, 'scripts')

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return result
}

function run(script: string, cwd: string, args: string[]) {
  const cmd = `npx tsx "${path.join(SCRIPTS, script)}" ${args.map(a => `"${a}"`).join(' ')}`.trim()
  execSync(cmd, { stdio: 'inherit', cwd })
}

const samples = fs.readdirSync(SAMPLES_DIR)
  .filter(d => fs.statSync(path.join(SAMPLES_DIR, d)).isDirectory())
  .sort()

for (const sample of samples) {
  const sampleDir = path.join(SAMPLES_DIR, sample)
  const envPath = path.join(sampleDir, '.env')

  if (!fs.existsSync(envPath)) {
    console.log(`\n--- ${sample} (no .env, skipping) ---`)
    continue
  }

  console.log(`\n--- ${sample} ---`)
  const env = parseEnv(fs.readFileSync(envPath, 'utf-8'))
  const spec = env.PLAT_SPEC || 'openapi.json'

  // Skip openapi generation for now (requires ts-morph analysis of running source)
  // Just generate clients from existing openapi.json

  const specPath = path.join(sampleDir, spec)
  if (!fs.existsSync(specPath) && !spec.startsWith('http')) {
    console.log(`  No spec at ${spec}, skipping client generation`)
    continue
  }

  if (env.PLAT_GEN_CLIENT_TS) {
    const outDir = path.dirname(env.PLAT_GEN_CLIENT_TS)
    fs.mkdirSync(path.join(sampleDir, outDir), { recursive: true })
    console.log(`  client:ts -> ${env.PLAT_GEN_CLIENT_TS}`)

    // Use source-based gen if we have shared types, openapi-based otherwise
    if (env.PLAT_TYPES !== 'generated' && !spec.startsWith('http') && fs.existsSync(path.join(sampleDir, 'server'))) {
      run('gen-client-openapi.ts', sampleDir, ['--src', spec, '--dst', path.join(outDir, 'client.ts')])
    } else {
      run('gen-client-openapi.ts', sampleDir, ['--src', spec, '--dst', path.join(outDir, 'client.ts')])
    }
  }

  if (env.PLAT_GEN_CLIENT_JS) {
    const outDir = path.dirname(env.PLAT_GEN_CLIENT_JS)
    fs.mkdirSync(path.join(sampleDir, outDir), { recursive: true })
    console.log(`  client:js -> ${env.PLAT_GEN_CLIENT_JS}`)
    run('gen-client-js.ts', sampleDir, ['--spec', spec, '--out', outDir])
  }

  if (env.PLAT_GEN_CLIENT_PY) {
    const outDir = path.dirname(env.PLAT_GEN_CLIENT_PY)
    fs.mkdirSync(path.join(sampleDir, outDir), { recursive: true })
    console.log(`  client:py -> ${env.PLAT_GEN_CLIENT_PY}`)
    run('gen-python.ts', sampleDir, ['--spec', spec, '--out', outDir])
  }

  if (env.PLAT_GEN_CLI) {
    const outDir = path.dirname(env.PLAT_GEN_CLI)
    fs.mkdirSync(path.join(sampleDir, outDir), { recursive: true })
    console.log(`  cli -> ${env.PLAT_GEN_CLI}`)
    run('gen-cli-openapi.ts', sampleDir, ['--src', spec, '--dst', path.join(outDir, 'cli.ts')])
  }
}

console.log('\nDone.')
