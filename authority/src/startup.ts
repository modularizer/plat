import 'dotenv/config'
import { Client } from 'pg'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

function getDatabaseConfig() {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  const url = new URL(raw)
  const dbName = (url.pathname || '').replace(/^\//, '')
  if (!dbName) {
    throw new Error('DATABASE_URL must include a database name')
  }

  const adminUrl = new URL(raw)
  adminUrl.pathname = '/postgres'
  return { dbName, adminUrl: adminUrl.toString() }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

async function ensureDatabaseExists(): Promise<void> {
  const { dbName, adminUrl } = getDatabaseConfig()
  const client = new Client({ connectionString: adminUrl })

  await client.connect()
  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (result.rowCount && result.rowCount > 0) {
      console.log(`✅ Database exists: ${dbName}`)
      return
    }

    const sql = `CREATE DATABASE ${quoteIdentifier(dbName)}`
    await client.query(sql)
    console.log(`✅ Database created: ${dbName}`)
  } finally {
    await client.end()
  }
}

function runMigrationsIfNeeded(): void {
  const storageType = (process.env.STORAGE_TYPE || 'drizzle').toLowerCase()
  if (storageType !== 'drizzle') {
    console.log(`ℹ️  Skipping DB migrations for STORAGE_TYPE=${storageType}`)
    return
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  const schemaPath = existsSync('./src/db/schema.ts') ? './src/db/schema.ts' : './dist/db/schema.js'
  console.log(`⏳ Running database migrations (drizzle-kit push) using ${schemaPath}...`)
  execFileSync(
    'npx',
    ['drizzle-kit', 'push', '--dialect=postgresql', `--schema=${schemaPath}`, `--url=${databaseUrl}`],
    { stdio: 'inherit' },
  )
  console.log('✅ Database migrations complete')
}

async function main(): Promise<void> {
  await ensureDatabaseExists()
  runMigrationsIfNeeded()

  await import('./server.js')
}

main().catch((error) => {
  console.error('❌ Startup bootstrap failed:', error)
  process.exit(1)
})



