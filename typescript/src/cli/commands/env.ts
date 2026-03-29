/**
 * Environment management commands
 * Handles .env file initialization and JWT secret generation
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * Parse env file into key-value object
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.substring(0, eqIndex).trim()
    const value = trimmed.substring(eqIndex + 1).trim()

    // Remove quotes if present
    result[key] = value.replace(/^["']|["']$/g, '')
  }

  return result
}

/**
 * Format env file with comments preserved
 */
export function formatEnvFile(
  sample: string,
  existing: Record<string, string>
): string {
  let result = ''
  const lines = sample.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Preserve comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      result += line + '\n'
      continue
    }

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) {
      result += line + '\n'
      continue
    }

    const key = trimmed.substring(0, eqIndex).trim()

    // Use existing value if available, otherwise use sample value
    if (existing.hasOwnProperty(key)) {
      const indent = line.substring(0, line.indexOf(key))
      result += `${indent}${key}=${existing[key]}\n`
    } else {
      result += line + '\n'
    }
  }

  return result
}

/**
 * Update or create env file with a key-value pair
 */
export function updateEnvFile(
  filePath: string,
  key: string,
  value: string
): void {
  let content = ''

  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8')
  }

  const lines = content.split('\n')
  let found = false

  const updatedLines = lines.map(line => {
    const trimmed = line.trim()
    if (trimmed.startsWith(key + '=')) {
      found = true
      return `${key}=${value}`
    }
    return line
  })

  // If not found, add it
  if (!found) {
    updatedLines.push(`${key}=${value}`)
  }

  // Remove trailing empty lines and add one newline at end
  let result = updatedLines.join('\n').trim() + '\n'

  fs.writeFileSync(filePath, result)
}

/**
 * Generate cryptographically secure random string
 */
export function generateSecret(length: number): string {
  return crypto.randomBytes(length / 2).toString('hex')
}

/**
 * Initialize .env file from .env.sample
 * - Copies .env.sample to .env if .env doesn't exist
 * - If .env exists, merges in new variables from .env.sample
 * - Preserves existing values
 */
export function envUpsert(cwd: string): void {
  const envPath = path.join(cwd, '.env')
  const samplePath = path.join(cwd, '.env.sample')

  // Check if .env.sample exists
  if (!fs.existsSync(samplePath)) {
    console.error('❌ Error: .env.sample not found')
    process.exit(1)
  }

  try {
    const sampleContent = fs.readFileSync(samplePath, 'utf-8')
    let existingVars: Record<string, string> = {}

    if (fs.existsSync(envPath)) {
      const existingContent = fs.readFileSync(envPath, 'utf-8')
      existingVars = parseEnvFile(existingContent)
      console.log('📝 Merging .env with new variables from .env.sample...')
    } else {
      console.log('📝 Creating .env from .env.sample...')
    }

    const newContent = formatEnvFile(sampleContent, existingVars)
    fs.writeFileSync(envPath, newContent)

    console.log('✅ .env file initialized successfully')
    console.log('')
    console.log('Next steps:')
    console.log('  1. Edit .env with your configuration')
    console.log('  2. Run: plat env roll')
    console.log('  3. Start the server: npm run dev')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

/**
 * Generate and update JWT_SECRET in .env
 */
export function envRoll(cwd: string, length?: number): void {
  const envPath = path.join(cwd, '.env')
  const secretLength = length ?? 64

  try {
    const secret = generateSecret(secretLength)

    updateEnvFile(envPath, 'JWT_SECRET', secret)

    console.log('✅ JWT_SECRET updated successfully')
    console.log('')
    console.log('New Secret (length: ' + secret.length + '):')
    console.log(secret)
    console.log('')
    console.log('Location: .env')
    console.log('')
    console.log('⚠️  Keep this secret safe!')
    console.log('   - Do not commit .env to version control')
    console.log('   - Use a .gitignore entry: .env')
    console.log('   - In production, use secure secret management')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}
