#!/usr/bin/env node

// Publishes every npm package the repo contains, in workspace dependency order
// (a dependency has to exist on the registry before its dependant installs).
//
// npm is published from a machine that has run `npm login`, because this repo has
// no trusted publisher configured for its packages and GitHub's token is not an
// npm credential — npm answers CI's PUT with 404. A package can additionally
// require 2FA, in which case npm refuses with EOTP unless a one-time password is
// passed: `--otp 123456` or `NPM_OTP=123456`.
//
// Versions already on the registry are skipped, so a half-finished release can be
// re-run, and one failing package does not stop the rest from publishing.

import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { inDependencyOrder, repoRoot } from './packages.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const otpIndex = args.indexOf('--otp')
const otp = otpIndex === -1 ? process.env.NPM_OTP : args[otpIndex + 1]
const packages = inDependencyOrder()
// Provenance needs a CI provider's OIDC token; a local publish has none.
const provenance = process.env.GITHUB_ACTIONS === 'true' ? ['--provenance'] : []
const installed = new Set()
const failures = []

if (!dryRun) {
  try {
    requireNpmAuth()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

console.log(`npm packages: ${packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}`)

for (const pkg of packages) {
  console.log(`\n::group::${pkg.name}@${pkg.version}`)
  try {
    installBuildTooling(pkg)
    install(pkg)
    runIn(pkg, 'npm', ['run', 'build', '--if-present'])

    if (pkg.scripts.test) {
      if (pkg.skipTestReason) {
        console.log(`Skipping tests: ${pkg.skipTestReason}`)
      } else {
        runIn(pkg, 'npm', ['test'])
      }
    }

    const publishArgs = ['publish', ...provenance, '--access', 'public', ...(otp ? ['--otp', otp] : [])]
    if (dryRun) {
      console.log(`[dry-run] npm ${publishArgs.join(' ')}`)
    } else if (isPublished(pkg)) {
      console.log(`${pkg.name}@${pkg.version} is already published; skipping`)
    } else {
      publish(pkg, publishArgs)
    }
  } catch (error) {
    failures.push(`${pkg.name}@${pkg.version}`)
    console.error(`::error::${pkg.name}@${pkg.version}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    console.log('::endgroup::')
  }
}

if (failures.length > 0) {
  console.error(`\nFailed to publish: ${failures.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(`\nAll ${packages.length} npm package(s) handled.`)
}

// Publishing from CI needs an npm credential this repo does not have, so the
// failure is reported here instead of being discovered halfway through a release.
function requireNpmAuth() {
  try {
    const user = execFileSync('npm', ['whoami'], { encoding: 'utf8' }).trim()
    console.log(`npm identity: ${user}`)
  } catch {
    throw new Error('Not logged in to npm. Run `npm login`, then re-run this command.')
  }
}

// Some builds compile sources from a neighbouring package (`../typescript/...`)
// and need its dependencies, so install that package first. Derived from the
// build script rather than a list of names.
function installBuildTooling(pkg) {
  const buildScript = pkg.scripts.build ?? ''
  for (const match of buildScript.matchAll(/\.\.\/([A-Za-z0-9_.-]+)\//g)) {
    const dependency = packages.find((candidate) => candidate.dir === match[1])
    if (dependency) {
      install(dependency)
    }
  }
}

function install(pkg) {
  if (installed.has(pkg.dir)) {
    return
  }
  if (pkg.lock) {
    runIn(pkg, 'npm', ['ci'])
  } else {
    runIn(pkg, 'npm', ['install', '--no-audit', '--no-fund'])
  }
  installed.add(pkg.dir)
}

// npm reports why a publish was refused on stderr (EOTP, E403, E404 for a scope
// the account cannot write). Keep that text so the reason survives into the
// summary instead of only scrolling past in the log.
function publish(pkg, publishArgs) {
  const result = spawnSync('npm', publishArgs, {
    cwd: path.join(repoRoot, pkg.dir),
    stdio: ['inherit', 'inherit', 'pipe'],
    encoding: 'utf8',
  })
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if (result.status !== 0) {
    const stderr = result.stderr ?? ''
    const hint = !otp && /EOTP|one-time password/i.test(stderr)
      ? ' This package requires 2FA: re-run with `--otp <code>` or NPM_OTP=<code>.'
      : ''
    throw new Error(`npm publish exited ${result.status}.${hint}`)
  }
}

function runIn(pkg, command, args) {
  execFileSync(command, args, {
    cwd: path.join(repoRoot, pkg.dir),
    stdio: 'inherit',
  })
}

function isPublished(pkg) {
  try {
    execFileSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version', '--json'], {
      cwd: path.join(repoRoot, pkg.dir),
      stdio: 'pipe',
    })
    return true
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    if (output.includes('E404') || output.includes('is not in this registry')) {
      return false
    }
    throw new Error(`Could not check whether ${pkg.name}@${pkg.version} exists: ${output.trim() || error.message}`)
  }
}
