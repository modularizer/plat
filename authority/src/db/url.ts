export function resolveDatabaseUrl(): string | null {
  const direct = process.env.DATABASE_URL
  if (direct) return direct

  const user = process.env.POSTGRES_USER
  const password = process.env.POSTGRES_PASSWORD
  const db = process.env.POSTGRES_DB
  if (!user || !password || !db) return null

  const host = process.env.POSTGRES_HOST || 'localhost'
  const port = process.env.POSTGRES_PORT || '5432'
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}`
}

export function requireDatabaseUrl(): string {
  const url = resolveDatabaseUrl()
  if (!url) {
    throw new Error(
      'No database connection configured. Set DATABASE_URL, or set POSTGRES_USER + POSTGRES_PASSWORD + POSTGRES_DB (with optional POSTGRES_HOST and POSTGRES_PORT).',
    )
  }
  return url
}
