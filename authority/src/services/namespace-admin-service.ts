import { getDatabase } from '../db/client.js'
import { namespaceAuthorizations, namespaceRequests, servers, users } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import {
  getConfiguredAuthorityOrigins,
  getNamespaceFromServerName,
  getNamespaceOwnershipKey,
  isNamespaceReserved,
  splitServerName,
} from './routing-service.js'

export interface NamespaceRequest {
  id: string
  requesterId: string
  requesterName: string
  requestedOrigin: string
  requestedNamespace: string
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  approvedAt?: Date
  approvedBy?: string
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface NamespaceAvailability {
  origin: string
  namespace: string
  available: boolean
  reason?: 'invalid_namespace' | 'namespace_reserved' | 'taken' | 'pending_request'
  ownerGoogleSub?: string
}

export interface NamespaceAuthorizationEntry {
  origin: string
  namespace: string
  subpath: string
  email: string
  addedByGoogleSub: string
  createdAt: Date
}

export interface AssignedNamespace {
  origin: string
  namespace: string
  ownerGoogleSub: string
  ownerName: string
  assignedAt: Date
}

export class NamespaceAdminService {
  private readonly freeNamespaceLimit = Number(process.env.FREE_NAMESPACE_MAX_PER_USER || '1')
  private readonly autoAssignEnabled = (process.env.FREE_NAMESPACE_AUTO_ASSIGN || 'true').toLowerCase() !== 'false'

  private normalizeScope(scope: string, explicitOrigin?: string): { origin: string; namespace: string; subpath: string } {
    const parsed = splitServerName(scope)
    const namespace = this.normalizeNamespace(parsed[0] || '')
    const subpath = parsed.slice(1).join('/')
    const origin = this.normalizeOrigin(explicitOrigin || '')
    return { origin, namespace, subpath }
  }

  private normalizeEmail(email: string): string {
    const normalized = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new Error('email must be a valid address')
    }
    return normalized
  }

  private async assertNamespaceOwnedBy(ownerId: string, origin: string, namespace: string): Promise<void> {
    const db = await getDatabase()
    const key = getNamespaceOwnershipKey(origin, namespace)
    const ownershipRow = await db.query.servers.findFirst({
      where: and(eq(servers.ownerId, ownerId), eq(servers.serverName, key)),
      columns: { id: true },
    })

    if (!ownershipRow) {
      throw new Error(`Namespace "${namespace}" on origin "${origin}" is not owned by this user`)
    }
  }

  private normalizeNamespace(namespace: string): string {
    const normalized = namespace.trim().toLowerCase()
    if (!normalized || normalized.includes('/')) {
      throw new Error('namespace must be a non-empty top-level name (no slashes)')
    }
    if (isNamespaceReserved(normalized)) {
      throw new Error(`namespace "${normalized}" is reserved`)
    }
    return normalized
  }

  private normalizeOrigin(origin: string): string {
    const normalized = origin.trim().toLowerCase()
    if (!normalized || normalized.includes('/')) {
      throw new Error('origin must be a host name')
    }

    const configured = getConfiguredAuthorityOrigins()
    if (configured.length > 0 && !configured.includes(normalized)) {
      throw new Error(`origin "${normalized}" is not allowed by AUTHORITY_ALLOWED_ORIGINS`)
    }
    return normalized
  }

  private async getUserByGoogleSub(googleSub: string) {
    const db = await getDatabase()
    const user = await db.query.users.findFirst({ where: eq(users.googleSub, googleSub) })
    if (!user) {
      throw new Error('User not found')
    }
    return user
  }

  private mapServerNameToNamespace(serverName: string, newNamespace: string): string {
    const parts = splitServerName(serverName)
    if (parts.length === 0) {
      throw new Error(`Invalid server name: ${serverName}`)
    }
    return [newNamespace, ...parts.slice(1)].join('/')
  }

  private parseOwnershipKey(serverName: string): { origin: string; namespace: string } {
    const separatorIndex = serverName.indexOf('::')
    if (separatorIndex < 0) {
      return { origin: '', namespace: serverName.trim().toLowerCase() }
    }

    return {
      origin: serverName.slice(0, separatorIndex).trim().toLowerCase(),
      namespace: serverName.slice(separatorIndex + 2).trim().toLowerCase(),
    }
  }

  async checkNamespaceAvailability(originInput: string, namespaceInput: string): Promise<NamespaceAvailability> {
    const origin = this.normalizeOrigin(originInput)
    const namespace = getNamespaceFromServerName(namespaceInput).trim().toLowerCase()
    if (!namespace) {
      return {
        origin,
        namespace: '',
        available: false,
        reason: 'invalid_namespace',
      }
    }

    if (isNamespaceReserved(namespace)) {
      return {
        origin,
        namespace,
        available: false,
        reason: 'namespace_reserved',
      }
    }

    const db = await getDatabase()

    const existing = await db.query.servers.findFirst({
      where: eq(servers.serverName, getNamespaceOwnershipKey(origin, namespace)),
      with: { owner: { columns: { googleSub: true } } },
      columns: { id: true },
    })
    if (existing) {
      return {
        origin,
        namespace,
        available: false,
        reason: 'taken',
        ownerGoogleSub: existing.owner.googleSub,
      }
    }

    const pending = await db.query.namespaceRequests.findFirst({
      where: and(
        eq(namespaceRequests.requestedOrigin, origin),
        eq(namespaceRequests.requestedNamespace, namespace),
        eq(namespaceRequests.status, 'pending'),
      ),
      columns: { id: true },
    })

    if (pending) {
      return {
        origin,
        namespace,
        available: false,
        reason: 'pending_request',
      }
    }

    return {
      origin,
      namespace,
      available: true,
    }
  }

  async addAuthorizedUserByEmail(
    ownerGoogleSub: string,
    originInput: string,
    scope: string,
    email: string,
  ): Promise<NamespaceAuthorizationEntry> {
    const origin = this.normalizeOrigin(originInput)
    const { namespace, subpath } = this.normalizeScope(scope, origin)
    const normalizedEmail = this.normalizeEmail(email)
    const db = await getDatabase()
    const owner = await this.getUserByGoogleSub(ownerGoogleSub)
    await this.assertNamespaceOwnedBy(owner.id, origin, namespace)

    const existing = await db.query.namespaceAuthorizations.findFirst({
      where: and(
        eq(namespaceAuthorizations.namespace, namespace),
        eq(namespaceAuthorizations.origin, origin),
        eq(namespaceAuthorizations.subpath, subpath),
        eq(namespaceAuthorizations.authorizedEmail, normalizedEmail),
      ),
    })

    if (existing) {
      return {
        namespace,
        origin,
        subpath,
        email: normalizedEmail,
        addedByGoogleSub: ownerGoogleSub,
        createdAt: existing.createdAt || new Date(),
      }
    }

    const [created] = await db
      .insert(namespaceAuthorizations)
      .values({
        namespace,
        origin,
        subpath,
        authorizedEmail: normalizedEmail,
        addedBy: owner.id,
      })
      .returning()

    if (!created) {
      throw new Error('Failed to add namespace authorization')
    }

    return {
      namespace,
      origin,
      subpath,
      email: normalizedEmail,
      addedByGoogleSub: ownerGoogleSub,
      createdAt: created.createdAt || new Date(),
    }
  }

  async removeAuthorizedUserByEmail(
    ownerGoogleSub: string,
    originInput: string,
    scope: string,
    email: string,
  ): Promise<{ removed: boolean }> {
    const origin = this.normalizeOrigin(originInput)
    const { namespace, subpath } = this.normalizeScope(scope, origin)
    const normalizedEmail = this.normalizeEmail(email)
    const db = await getDatabase()
    const owner = await this.getUserByGoogleSub(ownerGoogleSub)
    await this.assertNamespaceOwnedBy(owner.id, origin, namespace)

    const removed = await db
      .delete(namespaceAuthorizations)
      .where(
        and(
          eq(namespaceAuthorizations.namespace, namespace),
          eq(namespaceAuthorizations.origin, origin),
          eq(namespaceAuthorizations.subpath, subpath),
          eq(namespaceAuthorizations.authorizedEmail, normalizedEmail),
        ),
      )
      .returning({ id: namespaceAuthorizations.id })

    return { removed: removed.length > 0 }
  }

  async listAuthorizedUsersByEmail(ownerGoogleSub: string, originInput: string, scope: string): Promise<NamespaceAuthorizationEntry[]> {
    const origin = this.normalizeOrigin(originInput)
    const { namespace, subpath } = this.normalizeScope(scope, origin)
    const db = await getDatabase()
    const owner = await this.getUserByGoogleSub(ownerGoogleSub)
    await this.assertNamespaceOwnedBy(owner.id, origin, namespace)

    const rows = await db.query.namespaceAuthorizations.findMany({
      where: and(
        eq(namespaceAuthorizations.namespace, namespace),
        eq(namespaceAuthorizations.origin, origin),
        eq(namespaceAuthorizations.subpath, subpath),
      ),
      columns: {
        authorizedEmail: true,
        createdAt: true,
      },
      with: {
        addedBy: {
          columns: {
            googleSub: true,
          },
        },
      },
    })

    return rows
      .map((row) => ({
        namespace,
        origin,
        subpath,
        email: row.authorizedEmail,
        addedByGoogleSub: row.addedBy.googleSub,
        createdAt: row.createdAt || new Date(),
      }))
      .sort((a, b) => a.email.localeCompare(b.email))
  }

  async requestNamespace(
    googleSub: string,
    originInput: string,
    namespace: string,
    metadata?: Record<string, any>,
  ): Promise<NamespaceRequest> {
    const db = await getDatabase()
    const origin = this.normalizeOrigin(originInput)
    const normalizedNamespace = this.normalizeNamespace(namespace)

    // Get or create user
    let user = await db.query.users.findFirst({
      where: eq(users.googleSub, googleSub),
    })

    if (!user) {
      const [newUser] = await db
        .insert(users)
        .values({ googleSub })
        .returning()
      if (!newUser) {
        throw new Error('Failed to create requester user')
      }
      user = newUser
    }

    // Check if namespace already requested
    const existing = await db.query.namespaceRequests.findFirst({
      where: and(
        eq(namespaceRequests.requestedOrigin, origin),
        eq(namespaceRequests.requestedNamespace, normalizedNamespace),
        eq(namespaceRequests.status, 'pending'),
      ),
    })

    if (existing) {
      throw new Error(`Namespace "${normalizedNamespace}" already has a pending request on origin ${origin}`)
    }

    const existingOwner = await db.query.servers.findFirst({
      where: eq(servers.serverName, getNamespaceOwnershipKey(origin, normalizedNamespace)),
      columns: { id: true },
    })
    if (existingOwner) {
      throw new Error(`Namespace "${normalizedNamespace}" is already taken on origin ${origin}`)
    }

    let status: 'pending' | 'approved' | 'rejected' = 'pending'
    let rejectionReason: string | undefined

    if (isNamespaceReserved(normalizedNamespace)) {
      status = 'rejected'
      rejectionReason = 'namespace_reserved'
    } else if (this.autoAssignEnabled) {
      const allOwnedKeys = await db.query.servers.findMany({
        where: eq(servers.ownerId, user.id),
        columns: { serverName: true },
      })
      const ownedNamespaceCount = allOwnedKeys.filter((row) => row.serverName.includes('::')).length
      if (ownedNamespaceCount < this.freeNamespaceLimit) {
        status = 'approved'
      }
    }

    // Create request
    const [request] = await db
      .insert(namespaceRequests)
      .values({
        requesterId: user.id,
        requestedOrigin: origin,
        requestedNamespace: normalizedNamespace,
        status,
        rejectionReason,
        approvedAt: status === 'approved' ? new Date() : undefined,
        metadata,
      })
      .returning()

    if (!request) {
      throw new Error('Failed to create namespace request')
    }

    if (status === 'approved') {
      await db
        .insert(servers)
        .values({
          serverName: getNamespaceOwnershipKey(origin, normalizedNamespace),
          ownerId: user.id,
        })
        .onConflictDoNothing()
    }

    return {
      id: request.id,
      requesterId: request.requesterId,
      requesterName: user.name || 'Unknown',
      requestedOrigin: request.requestedOrigin,
      requestedNamespace: request.requestedNamespace,
      status: request.status as NamespaceRequest['status'],
      rejectionReason: request.rejectionReason ?? undefined,
      metadata: (request.metadata ?? undefined) as Record<string, any> | undefined,
      createdAt: request.createdAt!,
      updatedAt: request.updatedAt!,
    }
  }

  async getPendingRequests(): Promise<NamespaceRequest[]> {
    const db = await getDatabase()

    const requests = await db.query.namespaceRequests.findMany({
      where: eq(namespaceRequests.status, 'pending'),
      with: {
        requester: true,
      },
      orderBy: desc(namespaceRequests.createdAt),
    })

    return requests.map((r) => ({
      id: r.id,
      requesterId: r.requesterId,
      requesterName: r.requester?.name || 'Unknown',
      requestedOrigin: r.requestedOrigin,
      requestedNamespace: r.requestedNamespace,
      status: r.status as NamespaceRequest['status'],
      metadata: (r.metadata ?? undefined) as Record<string, any> | undefined,
      createdAt: r.createdAt!,
      updatedAt: r.updatedAt!,
    }))
  }

  async getAllRequests(): Promise<NamespaceRequest[]> {
    const db = await getDatabase()

    const requests = await db.query.namespaceRequests.findMany({
      with: {
        requester: true,
      },
      orderBy: desc(namespaceRequests.createdAt),
    })

    return requests.map((r) => ({
      id: r.id,
      requesterId: r.requesterId,
      requesterName: r.requester?.name || 'Unknown',
      requestedOrigin: r.requestedOrigin,
      requestedNamespace: r.requestedNamespace,
      status: r.status as NamespaceRequest['status'],
      rejectionReason: r.rejectionReason ?? undefined,
      metadata: (r.metadata ?? undefined) as Record<string, any> | undefined,
      createdAt: r.createdAt!,
      updatedAt: r.updatedAt!,
    }))
  }

  async getAssignedNamespaces(): Promise<AssignedNamespace[]> {
    const db = await getDatabase()

    const rows = await db.query.servers.findMany({
      with: {
        owner: {
          columns: {
            googleSub: true,
            name: true,
          },
        },
      },
      orderBy: desc(servers.createdAt),
    })

    return rows.map((row) => {
      const parsed = this.parseOwnershipKey(row.serverName)
      return {
        origin: parsed.origin,
        namespace: parsed.namespace,
        ownerGoogleSub: row.owner.googleSub,
        ownerName: row.owner.name || 'Unknown',
        assignedAt: row.createdAt || new Date(),
      }
    })
  }

  async forfeitNamespace(ownerGoogleSub: string, originInput: string, namespace: string): Promise<{ removed: number; serverNames: string[] }> {
    const origin = this.normalizeOrigin(originInput)
    const normalizedNamespace = this.normalizeNamespace(namespace)
    const db = await getDatabase()
    const owner = await this.getUserByGoogleSub(ownerGoogleSub)

    const key = getNamespaceOwnershipKey(origin, normalizedNamespace)
    const deleted = await db
      .delete(servers)
      .where(and(eq(servers.ownerId, owner.id), eq(servers.serverName, key)))
      .returning({ serverName: servers.serverName })

    return {
      removed: deleted.length,
      serverNames: deleted.map((row) => row.serverName).sort(),
    }
  }

  async renameNamespace(
    ownerGoogleSub: string,
    originInput: string,
    fromNamespace: string,
    toNamespace: string,
  ): Promise<{ renamed: number; fromNamespace: string; toNamespace: string }> {
    const origin = this.normalizeOrigin(originInput)
    const from = this.normalizeNamespace(fromNamespace)
    const to = this.normalizeNamespace(toNamespace)
    if (from === to) {
      return { renamed: 0, fromNamespace: from, toNamespace: to }
    }

    const db = await getDatabase()
    const owner = await this.getUserByGoogleSub(ownerGoogleSub)

    const sourceKey = getNamespaceOwnershipKey(origin, from)
    const targetKey = getNamespaceOwnershipKey(origin, to)

    const source = await db.query.servers.findFirst({
      where: and(eq(servers.ownerId, owner.id), eq(servers.serverName, sourceKey)),
      columns: { id: true },
    })
    if (!source) {
      return { renamed: 0, fromNamespace: from, toNamespace: to }
    }

    const targetExists = await db.query.servers.findFirst({
      where: eq(servers.serverName, targetKey),
      columns: { id: true },
    })
    if (targetExists) {
      throw new Error(`Cannot rename namespace: target namespace already exists (${to}@${origin})`)
    }

    await db.transaction(async (tx) => {
      await tx
        .update(servers)
        .set({
          serverName: targetKey,
          updatedAt: new Date(),
        })
        .where(eq(servers.id, source.id))

      await tx
        .update(namespaceAuthorizations)
        .set({ namespace: to, updatedAt: new Date() })
        .where(and(eq(namespaceAuthorizations.origin, origin), eq(namespaceAuthorizations.namespace, from)))

      await tx
        .update(namespaceRequests)
        .set({ requestedNamespace: to, updatedAt: new Date() })
        .where(and(eq(namespaceRequests.requestedOrigin, origin), eq(namespaceRequests.requestedNamespace, from)))
    })

    return {
      renamed: 1,
      fromNamespace: from,
      toNamespace: to,
    }
  }

  async approveNamespace(requestId: string, adminGoogleSub: string): Promise<void> {
    const db = await getDatabase()

    // Get the request
    const request = await db.query.namespaceRequests.findFirst({
      where: eq(namespaceRequests.id, requestId),
    })

    if (!request) {
      throw new Error('Request not found')
    }

    if (request.status !== 'pending') {
      throw new Error(`Request is already ${request.status}`)
    }

    // Get admin user
    const adminUser = await db.query.users.findFirst({
      where: eq(users.googleSub, adminGoogleSub),
    })

    if (!adminUser) {
      throw new Error('Admin user not found')
    }

    // Get requester
    const requester = await db.query.users.findFirst({
      where: eq(users.id, request.requesterId),
    })

    if (!requester) {
      throw new Error('Requester not found')
    }

    // Approve and create server registration
    await db
      .update(namespaceRequests)
      .set({
        status: 'approved',
        approvedBy: adminUser.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(namespaceRequests.id, requestId))

    // Create server with requester as owner
    await db.insert(servers).values({
      serverName: getNamespaceOwnershipKey(request.requestedOrigin, request.requestedNamespace),
      ownerId: requester.id,
    })
  }

  async rejectNamespace(
    requestId: string,
    adminGoogleSub: string,
    reason: string,
  ): Promise<void> {
    const db = await getDatabase()

    const request = await db.query.namespaceRequests.findFirst({
      where: eq(namespaceRequests.id, requestId),
    })

    if (!request) {
      throw new Error('Request not found')
    }

    if (request.status !== 'pending') {
      throw new Error(`Request is already ${request.status}`)
    }

    const adminUser = await db.query.users.findFirst({
      where: eq(users.googleSub, adminGoogleSub),
    })

    if (!adminUser) {
      throw new Error('Admin user not found')
    }

    await db
      .update(namespaceRequests)
      .set({
        status: 'rejected',
        rejectionReason: reason,
        approvedBy: adminUser.id,
        updatedAt: new Date(),
      })
      .where(eq(namespaceRequests.id, requestId))
  }

  async getNamespaceRequestHistory(originInput: string, namespace: string): Promise<NamespaceRequest[]> {
    const db = await getDatabase()
    const origin = this.normalizeOrigin(originInput)
    const normalizedNamespace = this.normalizeNamespace(namespace)

    const requests = await db.query.namespaceRequests.findMany({
      where: and(
        eq(namespaceRequests.requestedOrigin, origin),
        eq(namespaceRequests.requestedNamespace, normalizedNamespace),
      ),
      with: {
        requester: true,
      },
      orderBy: desc(namespaceRequests.createdAt),
    })

    return requests.map((r) => ({
      id: r.id,
      requesterId: r.requesterId,
      requesterName: r.requester?.name || 'Unknown',
      requestedOrigin: r.requestedOrigin,
      requestedNamespace: r.requestedNamespace,
      status: r.status as NamespaceRequest['status'],
      rejectionReason: r.rejectionReason ?? undefined,
      metadata: (r.metadata ?? undefined) as Record<string, any> | undefined,
      createdAt: r.createdAt!,
      updatedAt: r.updatedAt!,
    }))
  }

  async getNamespacesForUser(googleSub: string): Promise<{ namespace: string; approvedAt: number }[]> {
    const db = await getDatabase()
    const user = await db.query.users.findFirst({ where: eq(users.googleSub, googleSub) })
    if (!user) return []

    const approved = await db.query.namespaceRequests.findMany({
      where: and(
        eq(namespaceRequests.requesterId, user.id),
        eq(namespaceRequests.status, 'approved'),
      ),
      orderBy: desc(namespaceRequests.approvedAt),
    })

    return approved.map((r) => ({
      namespace: r.requestedNamespace,
      approvedAt: r.approvedAt ? r.approvedAt.getTime() : r.updatedAt?.getTime() ?? 0,
    }))
  }

  async getRequestsForUser(googleSub: string): Promise<NamespaceRequest[]> {
    const db = await getDatabase()
    const user = await db.query.users.findFirst({ where: eq(users.googleSub, googleSub) })
    if (!user) return []

    const requests = await db.query.namespaceRequests.findMany({
      where: eq(namespaceRequests.requesterId, user.id),
      with: { requester: true },
      orderBy: desc(namespaceRequests.createdAt),
    })

    return requests.map((r) => ({
      id: r.id,
      requesterId: r.requesterId,
      requesterName: r.requester?.name || 'Unknown',
      requestedOrigin: r.requestedOrigin,
      requestedNamespace: r.requestedNamespace,
      status: r.status as NamespaceRequest['status'],
      rejectionReason: r.rejectionReason ?? undefined,
      metadata: (r.metadata ?? undefined) as Record<string, any> | undefined,
      createdAt: r.createdAt!,
      updatedAt: r.updatedAt!,
    }))
  }
}
