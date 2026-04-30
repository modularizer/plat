/**
 * JWT command for token generation
 * Wrapper around jwt-helper functionality
 */

import dotenv from 'dotenv'
import path from 'path'
import { generateJwtFromCliArgs, getAuthHeader } from '../jwt-helper'

/**
 * Generate JWT token from CLI arguments
 * Usage: plat jwt generate --user-id=1 --role=admin
 */
export async function jwtGenerate(cwd: string, args: string[]): Promise<void> {
  try {
    // Load .env from cwd
    const envPath = path.join(cwd, '.env')
    dotenv.config({ path: envPath })

    // Generate token
    const token = generateJwtFromCliArgs(args)

    console.log('✅ JWT token generated successfully')
    console.log('')
    console.log('Token:')
    console.log(token)
    console.log('')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}
