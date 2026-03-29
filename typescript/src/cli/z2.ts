#!/usr/bin/env node
/**
 * plat Unified CLI Tool
 * Main entry point with routing for all subcommands
 */

import { envUpsert, envRoll } from './commands/env'
import { runGen } from './commands/gen'
import { jwtGenerate } from './commands/jwt-cmd'
import { apiProxy } from './commands/api-proxy'
import { initProject } from './commands/init-project'
import { watch } from './commands/watch'
import { runOpenApi } from './commands/run'
import { serveControllers } from './commands/serve'
import { getLogger } from '../logging'

const cwd = process.cwd()
const args = process.argv.slice(2)
const logger = getLogger('plat.cli')

if (args.length === 0) {
  logger.info(`plat - Unified CLI Tool for plat API Framework

Usage:
  plat init                                # Setup plat in current project
  plat serve [--src <glob>] --port <n>     # Serve controllers without server.ts
  plat run [--src <spec>] <command> ...    # Run an OpenAPI-backed CLI
  plat env upsert                          # Initialize .env file
  plat env roll [--length=N]               # Generate new JWT secret
  plat gen openapi [--src <glob>] [--dst <file>]
  plat gen client [--src <spec>] [--dst <file>]
  plat gen cli [--src <spec>] [--dst <file>]
  plat watch                               # Watch *.api.ts and regenerate on changes
  plat jwt generate [--key=value ...]      # Generate JWT token
  plat <operationId> [--key=value ...]     # Call API endpoint
`)
  process.exit(0)
}

const firstArg = args[0]

// Route based on first argument
if (firstArg === 'run') {
  runOpenApi(cwd, args.slice(1)).catch(err => {
    logger.error('❌ Error: %s', err.message)
    process.exit(1)
  })
} else if (firstArg === 'init') {
  initProject(cwd)
} else if (firstArg === 'env') {
  const subcommand = args[1]
  if (subcommand === 'upsert') {
    envUpsert(cwd)
  } else if (subcommand === 'roll') {
    const lengthMatch = args.find(arg => arg && arg.startsWith('--length='))
    const length = lengthMatch ? parseInt(lengthMatch.split('=')[1]!, 10) : undefined
    envRoll(cwd, length)
  } else {
    logger.error('❌ Error: Unknown env subcommand: %s', subcommand)
    logger.error('Supported: upsert, roll')
    process.exit(1)
  }
} else if (firstArg === 'gen') {
  const subcommand = args[1]
  runGen(cwd, subcommand, args.slice(2))
} else if (firstArg === 'serve') {
  serveControllers(cwd, args.slice(1))
} else if (firstArg === 'watch') {
  watch(cwd)
} else if (firstArg === 'jwt') {
  if (args[1] === 'generate') {
    jwtGenerate(cwd, args.slice(2)).catch(err => {
      logger.error('❌ Error: %s', err.message)
      process.exit(1)
    })
  } else {
    logger.error('❌ Error: Unknown jwt subcommand: %s', args[1])
    logger.error('Supported: generate')
    process.exit(1)
  }
} else {
  // Treat as API operation
  apiProxy(cwd, args).catch(err => {
    logger.error('❌ Error: %s', err.message)
    process.exit(1)
  })
}
