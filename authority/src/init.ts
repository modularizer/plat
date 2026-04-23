import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { getDatabase } from './db/client.js'
import { namespaceRequests, servers } from './db/schema.js'
import { getNamespaceOwnershipKey } from './services/routing-service.js'

export async function initializeDatabase() {
  try {
    const db = await getDatabase()
    console.log('✅ Database connection verified')
    await reconcileApprovedNamespaces(db)
    return db
  } catch (error: any) {
    console.error('❌ Database initialization failed:', error.message)
    throw error
  }
}

async function reconcileApprovedNamespaces(db: Awaited<ReturnType<typeof getDatabase>>) {
  const approved = await db.query.namespaceRequests.findMany({
    where: eq(namespaceRequests.status, 'approved'),
    columns: {
      requesterId: true,
      requestedOrigin: true,
      requestedNamespace: true,
    },
  })

  if (approved.length === 0) return

  const rows = approved.map((r) => ({
    serverName: getNamespaceOwnershipKey(r.requestedOrigin, r.requestedNamespace),
    ownerId: r.requesterId,
  }))

  const result = await db
    .insert(servers)
    .values(rows)
    .onConflictDoNothing({ target: servers.serverName })
    .returning({ serverName: servers.serverName })

  if (result.length > 0) {
    console.log(`✅ Reconciled ${result.length} approved namespace(s) into servers: ${result.map((r) => r.serverName).join(', ')}`)
  }
}

