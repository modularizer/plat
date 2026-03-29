#!/usr/bin/env node
/**
 * Update or generate JWT_SECRET in .env file
 *
 * - Generates a cryptographically secure random secret
 * - Updates JWT_SECRET in .env
 * - Creates .env if it doesn't exist
 * - Displays the new secret
 *
 * Usage:
 *   npx tsx scripts/update-jwt-secret.ts           # Generate new secret
 *   npx tsx scripts/update-jwt-secret.ts --length 64  # Custom length
 */

import { envRoll } from '../typpescript/src/cli/commands/env'

// Parse command line arguments
function getSecretLength(): number {
  const lengthArg = process.argv.find(arg => arg.startsWith('--length='))
  if (lengthArg) {
    const length = parseInt(lengthArg.split('=')[1], 10)
    return isNaN(length) || length < 32 ? 64 : length
  }
  return 64
}

const length = getSecretLength()
envRoll(process.cwd(), length)
