#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bumpVersion, resolveNextVersion, VERSION_FILES } from './bump-version.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseMessage = process.argv[2]?.trim()
const versionSpec = process.argv[3]

if (!releaseMessage) {
  console.error('Usage: node scripts/release.mjs <message> [--patch|--minor|<semver>]')
  process.exit(1)
}

try {
  const nextVersion = resolveNextVersion(versionSpec)
  const touchedFiles = bumpVersion(nextVersion)

  run('git', ['add', ...VERSION_FILES])
  run('git', ['commit', '-m', `release: ${nextVersion}`, '-m', releaseMessage])
  run('git', ['push'])
  run('gh', ['release', 'create', `v${nextVersion}`, '--draft', '--title', `v${nextVersion}`, '--notes', releaseMessage])

  console.log(`Release flow prepared for ${nextVersion}`)
  for (const file of touchedFiles) {
    console.log(`- ${file}`)
  }
  console.log(`notes: ${releaseMessage}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}
