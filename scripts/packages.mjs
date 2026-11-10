#!/usr/bin/env node

// One source of truth for "what ships": every top-level directory that declares
// itself a package (package.json or pyproject.toml) is a release target. The
// previous release tooling kept a hand-written list, so a package added later
// (plat-cli) or one that never got added (plat-browser) was silently skipped.
// Discovery means a new package is released without editing a list.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/

const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', 'tests', '.git', '.github'])

export function compareVersions(a, b) {
  const parse = (version) => version.split(/[.+-]/).slice(0, 3).map(Number)
  const [aMajor, aMinor, aPatch] = parse(a)
  const [bMajor, bMinor, bPatch] = parse(b)
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch
}

// Reads `field = "value"` from the [project] table without pulling in a TOML
// parser (the only values this repo needs are plain strings).
export function readPyprojectField(source, field, label = 'pyproject.toml') {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.trim() === '[project]')
  if (start === -1) {
    throw new Error(`${label} has no [project] section`)
  }
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*\[/.test(line)) {
      break
    }
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"\s*$/)
    if (match && match[1] === field) {
      return match[2]
    }
  }
  throw new Error(`${label} [project] has no ${field}`)
}

export function replacePyprojectVersion(source, nextVersion, label = 'pyproject.toml') {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.trim() === '[project]')
  if (start === -1) {
    throw new Error(`${label} has no [project] section`)
  }
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      break
    }
    if (/^\s*version\s*=\s*"/.test(lines[index])) {
      const updated = [...lines]
      updated[index] = lines[index].replace(/^(\s*version\s*=\s*")[^"]*(")/, `$1${nextVersion}$2`)
      return updated.join('\n')
    }
  }
  throw new Error(`${label} [project] has no version`)
}

function readJson(absolutePath) {
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
}

export function discoverPackages() {
  const packages = []

  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) {
      continue
    }
    const dir = entry.name
    const packageJsonPath = path.join(repoRoot, dir, 'package.json')
    const pyprojectPath = path.join(repoRoot, dir, 'pyproject.toml')

    if (fs.existsSync(packageJsonPath)) {
      const manifest = readJson(packageJsonPath)
      if (!manifest.name || !manifest.version) {
        throw new Error(`${dir}/package.json needs both a name and a version to be a release target`)
      }
      if (!semverPattern.test(manifest.version)) {
        throw new Error(`${dir}/package.json has a non-semver version: ${manifest.version}`)
      }
      const lockPath = path.join(repoRoot, dir, 'package-lock.json')
      packages.push({
        kind: 'npm',
        dir,
        name: manifest.name,
        version: manifest.version,
        private: manifest.private === true,
        manifest: path.relative(repoRoot, packageJsonPath),
        lock: fs.existsSync(lockPath) ? path.relative(repoRoot, lockPath) : undefined,
        scripts: manifest.scripts ?? {},
        // A package whose suite needs infrastructure (a database, a live server)
        // says so in its own manifest instead of hiding in a workflow list.
        skipTestReason: manifest.publishSkipTest,
      })
      continue
    }

    if (fs.existsSync(pyprojectPath)) {
      const label = path.relative(repoRoot, pyprojectPath)
      const source = fs.readFileSync(pyprojectPath, 'utf8')
      const version = readPyprojectField(source, 'version', label)
      if (!semverPattern.test(version)) {
        throw new Error(`${label} has a non-semver version: ${version}`)
      }
      packages.push({
        kind: 'pypi',
        dir,
        name: readPyprojectField(source, 'name', label),
        version,
        private: false,
        manifest: label,
        scripts: {},
      })
    }
  }

  return packages.sort((a, b) => a.dir.localeCompare(b.dir))
}

export function versionFiles(pkg) {
  return pkg.lock ? [pkg.manifest, pkg.lock] : [pkg.manifest]
}

export function allVersionFiles(packages) {
  return packages.flatMap(versionFiles)
}

export function publishablePackages(packages = discoverPackages()) {
  return packages.filter((pkg) => !pkg.private)
}

// Order matters for npm: a package must be on the registry before anything that
// depends on it can install. Topologically sort the workspace dependencies so
// `plat` publishes before `plat-authority`, without naming either of them.
export function inDependencyOrder(packages = publishablePackages()) {
  const npmPackages = packages.filter((pkg) => pkg.kind === 'npm')
  const byName = new Map(npmPackages.map((pkg) => [pkg.name, pkg]))
  const ordered = []
  const visiting = new Set()
  const visited = new Set()

  const visit = (pkg, trail) => {
    if (visited.has(pkg.name)) {
      return
    }
    if (visiting.has(pkg.name)) {
      throw new Error(`Workspace dependency cycle: ${[...trail, pkg.name].join(' -> ')}`)
    }
    visiting.add(pkg.name)
    const manifest = readJson(path.join(repoRoot, pkg.manifest))
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        const local = byName.get(dependency)
        if (local && local !== pkg) {
          visit(local, [...trail, pkg.name])
        }
      }
    }
    visiting.delete(pkg.name)
    visited.add(pkg.name)
    ordered.push(pkg)
  }

  for (const pkg of npmPackages) {
    visit(pkg, [])
  }
  return ordered
}

export function buildPublishPlan(packages = discoverPackages()) {
  const publishable = publishablePackages(packages)
  const npmPackages = inDependencyOrder(publishable)
  return {
    npm: npmPackages.map((pkg) => ({
      dir: pkg.dir,
      name: pkg.name,
      version: pkg.version,
      skipTest: Boolean(pkg.skipTestReason),
    })),
    pypi: publishable
      .filter((pkg) => pkg.kind === 'pypi')
      .map((pkg) => ({ dir: pkg.dir, name: pkg.name, version: pkg.version, hasTests: fs.existsSync(path.join(repoRoot, pkg.dir, 'tests')) })),
  }
}

// Some sources carry the version as a literal (the servers report their own
// version). Any literal that matches a current package version is part of the
// release, so this scans the tracked sources instead of listing the files.
const SOURCE_VERSION_LITERALS = ["version: '([^']+)'", '"version": "([^"]+)"']

export function planSourceVersionChanges(packages, nextVersion) {
  const versions = new Set(packages.map((pkg) => pkg.version))
  const tracked = execFileSync('git', ['ls-files', '--', '*.ts', '*.py'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)

  const changes = []
  for (const file of tracked) {
    const absolutePath = path.join(repoRoot, file)
    const before = fs.readFileSync(absolutePath, 'utf8')
    let after = before
    for (const literal of SOURCE_VERSION_LITERALS) {
      after = after.replace(new RegExp(literal, 'g'), (match, version) =>
        versions.has(version) ? match.replace(version, nextVersion) : match,
      )
    }
    if (after !== before) {
      changes.push({ file, absolutePath, before, after })
    }
  }
  return changes
}

function printUsage() {
  console.log('Usage: node scripts/packages.mjs [--list|--json|--plan|--order-npm|--order-pypi]')
  console.log('  --list       every discovered package with its version (default)')
  console.log('  --json       machine-readable packages + publish plan')
  console.log('  --plan       GitHub Actions outputs: npm=<json> and pypi=<json>')
  console.log('  --order-npm  npm directories in dependency order, one per line')
  console.log('  --order-pypi Python package directories, one per line')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const packages = discoverPackages()
    const plan = buildPublishPlan(packages)

    if (args.includes('--json')) {
      console.log(JSON.stringify({ packages, plan }, null, 2))
    } else if (args.includes('--plan')) {
      console.log(`npm=${JSON.stringify(plan.npm)}`)
      console.log(`pypi=${JSON.stringify(plan.pypi)}`)
    } else if (args.includes('--order-npm')) {
      for (const pkg of plan.npm) {
        console.log(pkg.dir)
      }
    } else if (args.includes('--order-pypi')) {
      for (const pkg of plan.pypi) {
        console.log(pkg.dir)
      }
    } else if (args.length > 0 && !args.includes('--list')) {
      printUsage()
      process.exit(1)
    } else {
      for (const pkg of packages) {
        const note = pkg.private ? ' (private, not published)' : pkg.skipTestReason ? ` (tests skipped: ${pkg.skipTestReason})` : ''
        console.log(`${pkg.dir.padEnd(20)} ${pkg.kind.padEnd(5)} ${pkg.name.padEnd(30)} ${pkg.version}${note}`)
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
