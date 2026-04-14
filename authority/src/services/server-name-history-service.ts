import { eq, desc } from 'drizzle-orm'
import { getDatabase } from '../db/client.js'
import { serverNames, users } from '../db/schema.js'
import { parseServerNameScope } from './routing-service.js'

export interface ServerNameHistoryEntry {
  serverName: string
  origin: string
  namespace: string
  ownerGoogleSub: string
  ownerName: string | null
  firstSeenAt: number
  lastSeenAt: number
}

export class ServerNameHistoryService {
  async recordSeen(serverName: string, ownerGoogleSub: string): Promise<void> {
    try {
      const db = await getDatabase()
      const owner = await db.query.users.findFirst({
        where: eq(users.googleSub, ownerGoogleSub),
        columns: { id: true },
      })
      if (!owner) return

      let origin = ''
      let namespace = ''
      try {
        const parsed = parseServerNameScope(serverName)
        origin = parsed.origin
        namespace = parsed.namespace
      } catch {
        namespace = serverName.split('/')[0] || serverName
      }

      await db
        .insert(serverNames)
        .values({
          serverName,
          origin,
          namespace,
          ownerId: owner.id,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: serverNames.serverName,
          set: { lastSeenAt: new Date(), ownerId: owner.id },
        })
    } catch (error) {
      console.error('[server-name-history] record failed:', (error as Error).message)
    }
  }

  async list(): Promise<ServerNameHistoryEntry[]> {
    const db = await getDatabase()
    const rows = await db.query.serverNames.findMany({
      with: { owner: { columns: { googleSub: true, name: true } } },
      orderBy: desc(serverNames.lastSeenAt),
    })
    return rows.map((r) => ({
      serverName: r.serverName,
      origin: r.origin,
      namespace: r.namespace,
      ownerGoogleSub: r.owner.googleSub,
      ownerName: r.owner.name,
      firstSeenAt: r.firstSeenAt?.getTime() ?? 0,
      lastSeenAt: r.lastSeenAt?.getTime() ?? 0,
    }))
  }
}
