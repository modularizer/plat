import { Controller, POST, GET, type RouteContext, HttpError } from '@modularizer/plat'
import { getServerOwnershipService } from '../storage/index.js'
import { getDatabase } from '../db/client.js'
import { servers } from '../db/schema.js'
import { eq, and, sql } from 'drizzle-orm'

@Controller('/api/server')
class ServerController {
  /**
   * Register or update a server's endpoint address and metadata.
   * Only the owner can register/update their server.
   */
  @POST({ auth: 'jwt' })
  async register(
    input: { server_name: string; endpoint_type: string; address: string; allowed_origins?: string[]; metadata?: Record<string, any> },
    ctx: RouteContext,
  ) {
    const googleSub = ctx.auth?.user?.sub
    if (!googleSub) throw new HttpError(401, 'not_authenticated')
    const ownershipService = await getServerOwnershipService()
    const parsed = input.server_name.trim()
    const ownerGoogleSub = await ownershipService.getNamespaceOwnerGoogleSub('', parsed)
    if (ownerGoogleSub !== googleSub) throw new HttpError(403, 'not_owner')
    // Upsert server record
    const db = await getDatabase()
    await db.insert(servers)
      .values({
        serverName: parsed,
        ownerId: googleSub,
        endpointType: input.endpoint_type,
        address: input.address,
        allowedOrigins: input.allowed_origins ?? [],
        metadata: input.metadata ?? {},
        lastUpdated: new Date(),
      })
      .onConflictDoUpdate({
        target: servers.serverName,
        set: {
          endpointType: input.endpoint_type,
          address: input.address,
          allowedOrigins: input.allowed_origins ?? [],
          metadata: input.metadata ?? {},
          lastUpdated: new Date(),
        },
      })
    return { ok: true }
  }

  /**
   * Lookup a server's endpoint address and metadata by name.
   */
  @GET()
  async lookup(server_name: string) {
    const db = await getDatabase()
    const record = await db.select({
      endpointType: servers.endpointType,
      address: servers.address,
      allowedOrigins: servers.allowedOrigins,
      metadata: servers.metadata,
      lastUpdated: servers.lastUpdated,
    }).from(servers).where(eq(servers.serverName, server_name)).limit(1)
    const row = record[0]
    if (!row) throw new HttpError(404, 'not_found')
    const { endpointType, address, allowedOrigins, metadata, lastUpdated } = row
    return { endpoint_type: endpointType, address, allowed_origins: allowedOrigins, metadata, last_updated: lastUpdated }
  }

  /**
   * List all registered servers, with optional filters.
   */
  @GET()
  async list(
    namespace?: string,
    endpoint_type?: string,
  ) {
    const db = await getDatabase()
    const conditions = []
    if (namespace) {
      // Use SQL LIKE for prefix match
      conditions.push(sql`${servers.serverName} LIKE ${namespace + '%'}`)
    }
    if (endpoint_type) {
      conditions.push(eq(servers.endpointType, endpoint_type))
    }
    const where = conditions.length ? and(...conditions) : undefined
    const records = await db.select({
      serverName: servers.serverName,
      endpointType: servers.endpointType,
      address: servers.address,
      allowedOrigins: servers.allowedOrigins,
      metadata: servers.metadata,
      lastUpdated: servers.lastUpdated,
    }).from(servers).where(where)
    return {
      servers: records.map((r: any) => ({
        server_name: r.serverName,
        endpoint_type: r.endpointType,
        address: r.address,
        allowed_origins: r.allowedOrigins,
        metadata: r.metadata,
        last_updated: r.lastUpdated,
      })),
    }
  }
}

export { ServerController }





