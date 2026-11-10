#!/usr/bin/env node

// Cuts a release of every package in the repo: bumps them all to one version,
// commits the version files, tags a GitHub release, and (with --publish) publishes
// them: npm from this machine (npm trusted publishing is not configured for this
// repo, so CI cannot do it) and the Python packages through the workflow that the
// release triggers.
//
// The release commit deliberately contains only version files, so anything left
// uncommitted would be silently absent from the build that ships. That is why an
// untidy working tree is refused unless --allow-dirty says otherwise.

import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { applyVersionBump, getCurrentVersion, planVersionBump, resolveNextVersion } from './bump-version.mjs'
import { buildPublishPlan } from './packages.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLAGS = new Set(['--publish', '--dry-run', '--allow-dirty'])
const args = process.argv.slice(2)
const shouldPublish = args.includes('--publish')
const dryRun = args.includes('--dry-run')
const allowDirty = args.includes('--allow-dirty')
const positional = args.filter((arg) => !FLAGS.has(arg))
const releaseMessage = positional[0]?.trim()
const versionSpec = positional[1]

if (!releaseMessage) {
  console.error('Usage: node scripts/release.mjs <message> [--patch|--minor|<semver>] [--publish] [--dry-run] [--allow-dirty]')
  process.exit(1)
}

try {
  const nextVersion = resolveNextVersion(versionSpec)
  const changes = planVersionBump(nextVersion)

  // Versions are sometimes bumped in the commit that is about to be released.
  // In that case there is nothing left to bump, so tag the current tree — but
  // only if it is clean, since the tagged commit is what gets published.
  const versionFiles = changes.map((change) => change.file)
  if (versionFiles.length === 0) {
    const currentVersion = getCurrentVersion()
    if (currentVersion !== nextVersion) {
      throw new Error(`Packages are at ${currentVersion}, not ${nextVersion}; pick ${currentVersion} or bump with --patch/--minor.`)
    }
  }

  const dirtyFiles = uncommittedFiles().filter((file) => !versionFiles.includes(file))

  if (dirtyFiles.length > 0) {
    const detail = dirtyFiles.map((file) => `  ${file}`).join('\n')
    if (!allowDirty && !dryRun) {
      throw new Error(
        `Refusing to release with uncommitted work, because the release commit only contains version files:\n${detail}\n` +
          'Commit (or stash) these first, or pass --allow-dirty to release anyway.',
      )
    }
    console.warn(`Warning: releasing with uncommitted work that will not be in the tagged build:\n${detail}`)
  }

  const plan = buildPublishPlan()
  console.log(`Release ${nextVersion}${dryRun ? ' (dry run)' : ''}`)
  if (versionFiles.length === 0) {
    console.log('Version files: none (already bumped and committed)')
  } else {
    console.log('Version files:')
    for (const file of versionFiles) {
      console.log(`- ${file}`)
    }
  }
  console.log(`Packages (${plan.npm.length} npm, ${plan.pypi.length} PyPI):`)
  for (const pkg of plan.npm) {
    console.log(`- npm  ${pkg.name}@${pkg.version}`)
  }
  for (const pkg of plan.pypi) {
    console.log(`- pypi ${pkg.name}@${pkg.version}`)
  }

  if (dryRun) {
    const commitPlan = versionFiles.length > 0 ? `commit ${versionFiles.length} version file(s), ` : ''
    const publishPlan = shouldPublish ? 'publish the npm packages from this machine, then ' : ''
    console.log(`Would ${commitPlan}push, ${publishPlan}create GitHub release v${nextVersion} (${shouldPublish ? 'published' : 'draft'}).`)
    process.exit(0)
  }

  if (versionFiles.length > 0) {
    applyVersionBump(changes)
    run('git', ['add', ...versionFiles])
    run('git', ['commit', '-m', `release: ${nextVersion}`, '-m', releaseMessage])
  }

  run('git', ['push'])

  // npm before the release: if publishing fails (not logged in, a version already
  // taken) the tag is not created, so nobody sees a release that is missing
  // packages. PyPI is the workflow's job, triggered by the release below.
  if (shouldPublish) {
    run('node', ['scripts/publish-npm.mjs'])
  }

  run('gh', [
    'release',
    'create',
    `v${nextVersion}`,
    ...(shouldPublish ? [] : ['--draft']),
    '--title',
    `v${nextVersion}`,
    '--notes',
    releaseMessage,
  ])

  console.log(`Release flow prepared for ${nextVersion}`)
  console.log(`notes: ${releaseMessage}`)
  console.log(`published: ${shouldPublish ? 'yes' : 'draft'}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

function uncommittedFiles() {
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return status
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
    .map((file) => file.replace(/^.* -> /, ''))
    .map((file) => file.replace(/^"(.*)"$/, '$1'))
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}
