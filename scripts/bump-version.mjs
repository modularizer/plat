#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/

export const VERSION_FILES = [
  'typescript/package.json',
  'typescript/package-lock.json',
  'python/pyproject.toml',
  'typescript/src/server/server.ts',
  'typescript/src/client-side-server/server.ts',
]

export function bumpVersion(nextVersion) {
  if (!nextVersion || !semverPattern.test(nextVersion)) {
    throw new Error('Usage: node scripts/bump-version.mjs <semver>')
  }

  const touchedFiles = []

  updateJson('typescript/package.json', (data) => {
    data.version = nextVersion
  }, touchedFiles)

  updateJson('typescript/package-lock.json', (data) => {
    data.version = nextVersion
    if (data.packages?.['']) {
      data.packages[''].version = nextVersion
    }
  }, touchedFiles)

  updateText('python/pyproject.toml', (source) => {
    assertPattern(source, /^version = ".*"$/m, 'python/pyproject.toml')
    return source.replace(/^version = ".*"$/m, `version = "${nextVersion}"`)
  }, touchedFiles)

  updateText('typescript/src/server/server.ts', (source) => {
    assertPattern(source, /version: '[^']+'/m, 'typescript/src/server/server.ts')
    return source.replace(/version: '[^']+'/m, `version: '${nextVersion}'`)
  }, touchedFiles)

  updateText('typescript/src/client-side-server/server.ts', (source) => {
    assertPattern(source, /version: '[^']+'/m, 'typescript/src/client-side-server/server.ts')
    return source.replace(/version: '[^']+'/m, `version: '${nextVersion}'`)
  }, touchedFiles)

  return touchedFiles
}

function updateJson(relativePath, mutate, touchedFiles) {
  const filePath = path.join(repoRoot, relativePath)
  const source = fs.readFileSync(filePath, 'utf8')
  const data = JSON.parse(source)
  mutate(data)
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`)
  touchedFiles.push(relativePath)
}

function updateText(relativePath, transform, touchedFiles) {
  const filePath = path.join(repoRoot, relativePath)
  const source = fs.readFileSync(filePath, 'utf8')
  const updated = transform(source)
  fs.writeFileSync(filePath, updated)
  touchedFiles.push(relativePath)
}

function assertPattern(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`Expected to update ${label}, but no matching version string was found.`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const nextVersion = process.argv[2]
    const touchedFiles = bumpVersion(nextVersion)
    console.log(`Bumped plat version to ${nextVersion}`)
    for (const file of touchedFiles) {
      console.log(`- ${file}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
