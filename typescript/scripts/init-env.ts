#!/usr/bin/env node
/**
 * Initialize .env file from .env.sample
 *
 * - Copies .env.sample to .env if .env doesn't exist
 * - If .env exists, merges in new variables from .env.sample
 * - Preserves existing values
 * - Usage: npx tsx scripts/init-env.ts
 */

import { envUpsert } from '../typpescript/src/cli/commands/env'

envUpsert(process.cwd())
