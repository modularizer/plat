import { promises as fs } from 'node:fs'
import path from 'node:path'

const DIST_DIR = path.resolve('dist')
const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json'])

async function main(): Promise<void> {
  await rewriteDirectory(DIST_DIR)
}

async function rewriteDirectory(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await rewriteDirectory(fullPath)
      continue
    }
    if (entry.isFile() && fullPath.endsWith('.js')) {
      await rewriteFile(fullPath)
    }
  }
}

async function rewriteFile(filePath: string): Promise<void> {
  const original = await fs.readFile(filePath, 'utf8')
  const rewritten = await rewriteSpecifiers(original, filePath)
  if (rewritten !== original) {
    await fs.writeFile(filePath, rewritten, 'utf8')
  }
}

async function rewriteSpecifiers(source: string, importerPath: string): Promise<string> {
  const patterns = [
    /(import\s+[\s\S]*?\sfrom\s+)(['"])(\.{1,2}\/[^'"]+)\2/g,
    /(export\s+\*\s+from\s+)(['"])(\.{1,2}\/[^'"]+)\2/g,
    /(export\s+\{[\s\S]*?\}\s+from\s+)(['"])(\.{1,2}\/[^'"]+)\2/g,
  ]

  let output = source
  for (const pattern of patterns) {
    output = await replaceAsync(output, pattern, async (_match, prefix: string, quote: string, specifier: string) => {
      const resolved = await resolveOutputSpecifier(importerPath, specifier)
      return `${prefix}${quote}${resolved}${quote}`
    })
  }

  return output
}

async function resolveOutputSpecifier(importerPath: string, specifier: string): Promise<string> {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return specifier
  }

  const ext = path.extname(specifier)
  if (JS_EXTENSIONS.has(ext)) {
    return specifier
  }

  const importerDir = path.dirname(importerPath)
  const baseTarget = path.resolve(importerDir, specifier)
  const fileCandidate = `${baseTarget}.js`
  if (await exists(fileCandidate)) {
    return `${specifier}.js`
  }

  const indexCandidate = path.join(baseTarget, 'index.js')
  if (await exists(indexCandidate)) {
    return `${specifier}/index.js`
  }

  return specifier
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function replaceAsync(
  input: string,
  pattern: RegExp,
  replacer: (...args: any[]) => Promise<string>,
): Promise<string> {
  const matches = Array.from(input.matchAll(pattern))
  if (matches.length === 0) return input

  let result = ''
  let lastIndex = 0

  for (const match of matches) {
    const index = match.index ?? 0
    result += input.slice(lastIndex, index)
    result += await replacer(...match)
    lastIndex = index + match[0].length
  }

  result += input.slice(lastIndex)
  return result
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
