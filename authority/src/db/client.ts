import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'

let db: NodePgDatabase<typeof schema> | null = null

export async function getDatabase() {
  if (db) return db

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  const pool = new Pool({
    connectionString: databaseUrl,
  })

  db = drizzle(pool, { schema })

  console.log('✅ Connected to PostgreSQL database')

  return db
}

export async function closeDatabase() {
  if (db) {
    // Drizzle doesn't expose the pool directly, so we can't close it here
    // The pool will be closed when the process exits
    db = null
  }
}

