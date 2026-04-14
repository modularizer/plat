import { Controller, GET, POST, type RouteContext } from '@modularizer/plat'
import { NamespaceAdminService } from '../services/namespace-admin-service.js'
import { ActivityService } from '../services/activity-service.js'
import { ServerNameHistoryService } from '../services/server-name-history-service.js'

@Controller()
class Admin {
  private service = new NamespaceAdminService()
  private activity = new ActivityService({ redisUrl: process.env.REDIS_URL })
  private historyService = new ServerNameHistoryService()

  private resolveActorGoogleSub(ctx?: RouteContext): string {
    const sub = (ctx?.auth?.user as any)?.sub
    if (!sub) {
      throw new Error('authenticated session required')
    }
    return sub
  }

  @GET({ auth: 'admin' })
  async pending() {
    return await this.service.getPendingRequests()
  }

  @GET({ auth: 'admin' })
  async adminRequests() {
    return await this.service.getAllRequests()
  }

  @GET({ auth: 'admin' })
  async assignedNamespaces() {
    return await this.service.getAssignedNamespaces()
  }

  @GET({ auth: 'admin' })
  async history(origin: string, namespace: string) {
    return await this.service.getNamespaceRequestHistory(origin, namespace)
  }

  @GET()
  async availability(origin: string, namespace: string) {
    return await this.service.checkNamespaceAvailability(origin, namespace)
  }

  @POST({ auth: 'admin' })
  async approve(requestId: string, ctx?: RouteContext) {
    await this.service.approveNamespace(requestId, this.resolveActorGoogleSub(ctx))
    return { ok: true }
  }

  @POST({ auth: 'admin' })
  async reject(requestId: string, reason: string, ctx?: RouteContext) {
    await this.service.rejectNamespace(requestId, this.resolveActorGoogleSub(ctx), reason)
    return { ok: true }
  }

  @POST()
  async request(origin: string, namespace: string, userGoogleSub: string, metadata?: Record<string, any>) {
    const service = new NamespaceAdminService()
    const req = await service.requestNamespace(userGoogleSub, origin, namespace, metadata)
    return { ok: true, request: req }
  }

  @POST({ auth: 'admin' })
  async forfeit(origin: string, namespace: string, ctx?: RouteContext) {
    const ownerGoogleSub = this.resolveActorGoogleSub(ctx)
    const result = await this.service.forfeitNamespace(ownerGoogleSub, origin, namespace)
    return { ok: true, ...result }
  }

  @POST({ auth: 'admin' })
  async rename(origin: string, namespace: string, newNamespace: string, ctx?: RouteContext) {
    const ownerGoogleSub = this.resolveActorGoogleSub(ctx)
    const result = await this.service.renameNamespace(ownerGoogleSub, origin, namespace, newNamespace)
    return { ok: true, ...result }
  }

  @GET({ auth: 'admin' })
  async authorized(origin: string, scope: string, ctx?: RouteContext) {
    const ownerGoogleSub = this.resolveActorGoogleSub(ctx)
    const entries = await this.service.listAuthorizedUsersByEmail(ownerGoogleSub, origin, scope)
    return { ok: true, authorized: entries }
  }

  @POST({ auth: 'admin' })
  async authorize(origin: string, scope: string, email: string, ctx?: RouteContext) {
    const ownerGoogleSub = this.resolveActorGoogleSub(ctx)
    const entry = await this.service.addAuthorizedUserByEmail(ownerGoogleSub, origin, scope, email)
    return { ok: true, authorization: entry }
  }

  @POST({ auth: 'admin' })
  async unauthorize(origin: string, scope: string, email: string, ctx?: RouteContext) {
    const ownerGoogleSub = this.resolveActorGoogleSub(ctx)
    const result = await this.service.removeAuthorizedUserByEmail(ownerGoogleSub, origin, scope, email)
    return { ok: true, ...result }
  }

  @GET({ auth: 'admin' })
  async activityServers() {
    const [allHistory, online] = await Promise.all([
      this.historyService.list(),
      this.activity.getOnlineServers(),
    ])
    const onlineSet = new Set(online)
    const historyNames = new Set(allHistory.map((h: any) => h.serverName))
    const merged = allHistory.map((entry: any) => ({ ...entry, online: onlineSet.has(entry.serverName) }))
    for (const name of online) {
      if (!historyNames.has(name)) {
        merged.unshift({
          serverName: name,
          origin: '',
          namespace: name.split('/')[0] || name,
          ownerGoogleSub: '',
          ownerName: null,
          firstSeenAt: 0,
          lastSeenAt: Date.now(),
          online: true,
        })
      }
    }
    return { servers: merged }
  }

  @GET({ auth: 'admin' })
  async activityServer(serverName: string) {
    const snapshot = await this.activity.getServerSnapshot(serverName)
    return { snapshot }
  }

  @GET({ auth: 'admin' })
  async activityRecent(limit?: number) {
    const events = await this.activity.getRecent(limit ?? 100)
    return { events }
  }
}

export { Admin }
