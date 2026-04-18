import {
  Controller,
  POST,
  GET,
  createServer,
  type RouteContext,
  HttpError,
  WebSocketController,
  WebSocketMessage,
  createWebSocketProtocolPlugin,
  type WebSocketSession,
  createJwtAuth,
  signToken,
} from '@modularizer/plat'
import 'dotenv/config'
import {
  parseAuthorityConnectRequest,
  parseAuthorityHostMessage,
  parseAuthorityPresenceMessage,
  AuthorityValidationError,
  AuthorityHostSession,
  RegistrationService,
  HostAuthService,
  RateLimitService,
  StrikeService,
  BlockService,
  GoogleIdTokenService,
  GoogleOAuthError,
  getAuthorityModeForServerName,
  ActivityService,
  ServerNameHistoryService,
} from './index.js'
import { initializeDatabase } from './init.js'
import { Admin } from './api/admin-controller.js'
import { NamespaceAdminService } from './services/namespace-admin-service.js'
import { getServerOwnershipService } from './storage/index.js'
import { getConfiguredAuthorityOrigins } from './services/routing-service.js'

// Configuration
const PORT = parseInt(process.env.PORT || '3000')
const HOST = process.env.HOST || '0.0.0.0'
const AUTHORITY_URL = process.env.AUTHORITY_URL || `http://localhost:${PORT}`
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-token-change-me'
const CONNECT_TIMEOUT_MS = 15_000
const PENDING_CLEANUP_MS = 20_000
const RATE_LIMIT_PER_30S = Number(process.env.CONNECT_RATE_LIMIT_PER_30S || '500')
const WS_HOST_MSG_RATE_LIMIT_PER_30S = Number(process.env.WS_HOST_MSG_RATE_LIMIT_PER_30S || '300')
const WS_PRESENCE_MSG_RATE_LIMIT_PER_30S = Number(process.env.WS_PRESENCE_MSG_RATE_LIMIT_PER_30S || '300')
const OAUTH_RATE_LIMIT_PER_30S = Number(process.env.OAUTH_RATE_LIMIT_PER_30S || '30')
const ADMIN_SESSION_TTL_SECONDS = Number(process.env.ADMIN_SESSION_TTL_SECONDS || `${12 * 60 * 60}`)
const TRACEBACK_MAX_LINES = Math.max(0, Number(process.env.TRACEBACK_MAX_LINES || '0'))

// Canonical Google client ID used across host auth and Google Identity
// Services (GIS) ID-token verification.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
// Optional additional audiences (comma-separated). Useful when a CLI/service-account
// flow mints ID tokens with a different aud than the browser client ID.
const EXTRA_GOOGLE_AUDIENCES = (process.env.GOOGLE_ID_TOKEN_AUDIENCES || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const ALLOWED_GOOGLE_HOSTED_DOMAINS = (process.env.GOOGLE_ALLOWED_HOSTED_DOMAINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const sharedRedisUrl = process.env.REDIS_URL
const hostAuthService = new HostAuthService({
  mode: (process.env.HOST_AUTH_MODE as 'insecure_token_sub' | 'google_tokeninfo' | undefined) ?? 'insecure_token_sub',
  googleClientId: GOOGLE_CLIENT_ID,
  verifySessionToken(token) {
    try {
      const payload = jwtAuth.verify('jwt', {
        headers: { authorization: `Bearer ${token}` },
      }, {}) as { sub?: string }
      if (typeof payload?.sub === 'string' && payload.sub.trim()) {
        return { googleSub: payload.sub.trim() }
      }
      return null
    } catch {
      return null
    }
  },
})
const rateLimitService = new RateLimitService({
  redisUrl: sharedRedisUrl,
  connectLimitPerWindow: RATE_LIMIT_PER_30S,
})
const strikeService = new StrikeService({ redisUrl: sharedRedisUrl })
const blockService = new BlockService({ redisUrl: sharedRedisUrl })
const activityService = new ActivityService({ redisUrl: sharedRedisUrl })
const serverNameHistoryService = new ServerNameHistoryService()

const JWT_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_TOKEN
const jwtConfig = { secret: JWT_SECRET, expiresIn: `${ADMIN_SESSION_TTL_SECONDS}s` }
const jwtAuth = createJwtAuth(jwtConfig)
const adminGoogleSubs = new Set(
  (process.env.ADMIN_GOOGLE_SUBS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)

const googleIdTokenService = GOOGLE_CLIENT_ID
  ? new GoogleIdTokenService({
      audience: [GOOGLE_CLIENT_ID, ...EXTRA_GOOGLE_AUDIENCES],
      ...(ALLOWED_GOOGLE_HOSTED_DOMAINS.length
        ? { allowedHostedDomains: ALLOWED_GOOGLE_HOSTED_DOMAINS }
        : {}),
    })
  : null

// In-memory state (v1 — replace with Redis/Postgres later)
const liveSessions = new Map<string, AuthorityHostSession>()
const pendingConnections = new Map<string, PendingConnection>()
const serverNameToSession = new Map<string, string>()
const presenceSubscriptions = new Map<WebSocketSession, Set<string>>()

type OAuthErrorResponse = {
  status: number
  code: string
  message: string
}

function isServerOnline(serverName: string): boolean {
  const hostSessionId = serverNameToSession.get(serverName)
  return !!hostSessionId && liveSessions.has(hostSessionId)
}

function publishPresenceUpdate(serverName: string, online: boolean): void {
  for (const [session, subscriptions] of presenceSubscriptions.entries()) {
    if (!session.isOpen()) {
      presenceSubscriptions.delete(session)
      continue
    }
    if (!subscriptions.has(serverName)) {
      continue
    }
    session.send({ type: 'presence_update', server_name: serverName, online })
  }
}

function getIpFromContext(ctx: RouteContext, ipHint?: string): string {
  const req = ctx.request as any
  const forwardedFor = req?.headers?.['x-forwarded-for']
  const forwardedIp = Array.isArray(forwardedFor)
    ? String(forwardedFor[0] || '')
    : typeof forwardedFor === 'string'
      ? forwardedFor.split(',')[0] || ''
      : ''
  return (forwardedIp || req?.ip || ipHint || 'unknown').trim()
}

function getSessionIp(session: WebSocketSession): string {
  const forwardedFor = session.headers['x-forwarded-for']
  if (Array.isArray(forwardedFor)) {
    return String(forwardedFor[0] || 'unknown').trim()
  }
  if (typeof forwardedFor === 'string') {
    return (forwardedFor.split(',')[0] || 'unknown').trim()
  }
  return 'unknown'
}

function getAdminAuthToken(req: any): string | null {
  const fromHeader = req?.headers?.['x-admin-token']
  if (typeof fromHeader === 'string' && fromHeader.trim()) {
    return fromHeader.trim()
  }

  const fromSessionHeader = req?.headers?.['x-admin-session']
  if (typeof fromSessionHeader === 'string' && fromSessionHeader.trim()) {
    return fromSessionHeader.trim()
  }

  const authHeader = req?.headers?.authorization
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim()
  }

  return null
}

function getRequesterKey(input: ConnectRequest, ctx: RouteContext): string {
  const creds = input.auth?.credentials as Record<string, unknown> | undefined
  if (creds && typeof creds.google_sub === 'string' && creds.google_sub.trim()) {
    return `acct:${creds.google_sub.trim()}`
  }

  const ip = getIpFromContext(ctx, input.client?.ip_hint)
  return `ip:${ip}`
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'Unknown error'
}

function normalizeOAuthError(error: unknown): OAuthErrorResponse {
  if (error instanceof HttpError) {
    return {
      status: (error as any).statusCode ?? 500,
      code: error.message || 'oauth_http_error',
      message: getErrorMessage(error),
    }
  }

  if (error instanceof AuthorityValidationError) {
    return {
      status: 400,
      code: 'oauth_validation_error',
      message: error.message,
    }
  }

  if (error instanceof GoogleOAuthError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    }
  }

  return {
    status: 500,
    code: 'oauth_internal_error',
    message: getErrorMessage(error),
  }
}

function isAdminGoogleSub(googleSub: string): boolean {
  return adminGoogleSubs.size === 0 || adminGoogleSubs.has(googleSub)
}

function getBoundedTraceback(stack?: string): { traceback?: string; tracebackLines?: number; tracebackTruncated?: boolean } {
  if (!stack || TRACEBACK_MAX_LINES <= 0) {
    return {}
  }

  const lines = stack.split('\n')
  const maxLines = Number.isFinite(TRACEBACK_MAX_LINES) ? TRACEBACK_MAX_LINES : 0
  if (maxLines <= 0) {
    return {}
  }

  const trimmed = lines.slice(0, maxLines)
  return {
    traceback: trimmed.join('\n'),
    tracebackLines: trimmed.length,
    tracebackTruncated: lines.length > trimmed.length,
  }
}

function sanitizeErrorForLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { error }
  }

  const httpError = error instanceof HttpError ? error : null
  return {
    name: error.name,
    message: error.message,
    ...getBoundedTraceback(error.stack),
    ...(httpError ? { statusCode: httpError.statusCode, data: httpError.data } : {}),
  }
}

function logServerError(label: string, error: unknown, details?: Record<string, unknown>): void {
  console.error(label, {
    ...(details || {}),
    error: sanitizeErrorForLog(error),
  })
}

@Controller()
class AuthController {
  /**
   * Exchange a Google Identity Services ID token (from the browser GIS SDK,
   * a service-account JWT→ID-token flow, or any other Google-issued ID token)
   * for an authority-issued session JWT.
   */
  @POST()
  async authSession(
    input: { id_token?: string; role?: 'admin' | 'user' },
    ctx: RouteContext,
  ) {
    try {
      if (!googleIdTokenService) {
        throw new HttpError(503, 'oauth_not_configured')
      }

      const clientKey = `ip:${getIpFromContext(ctx)}`
      const decision = await rateLimitService.checkAllowance('auth_session', clientKey, OAUTH_RATE_LIMIT_PER_30S)
      if (!decision.allowed) {
        throw new HttpError(429, 'oauth_rate_limited', {
          retryAfterMs: decision.retryAfterMs,
        })
      }

      const idToken = typeof input.id_token === 'string' ? input.id_token.trim() : ''
      if (!idToken) {
        throw new HttpError(400, 'missing_id_token')
      }

      const profile = await googleIdTokenService.verifyIdToken(idToken)
      const requestedRole = input.role === 'admin' ? 'admin' : 'user'
      const roles = requestedRole === 'admin'
        ? ['admin']
        : isAdminGoogleSub(profile.sub)
          ? ['user', 'admin']
          : ['user']

      if (requestedRole === 'admin' && !isAdminGoogleSub(profile.sub)) {
        throw new HttpError(403, 'not_admin')
      }

      const token = signToken({
        sub: profile.sub,
        roles,
        ...(profile.email ? { email: profile.email } : {}),
        ...(profile.name ? { name: profile.name } : {}),
        ...(profile.picture ? { picture: profile.picture } : {}),
      }, jwtConfig)

      // Fetch profile picture bytes so the client doesn't hit Google's rate-limited URLs
      let pictureDataUrl = ''
      if (profile.picture) {
        try {
          const picResponse = await fetch(profile.picture)
          if (picResponse.ok) {
            const contentType = picResponse.headers.get('content-type') || 'image/jpeg'
            const buffer = Buffer.from(await picResponse.arrayBuffer())
            pictureDataUrl = `data:${contentType};base64,${buffer.toString('base64')}`
          }
        } catch { /* non-fatal — client falls back to initial avatar */ }
      }

      return {
        ok: true,
        session_token: token,
        google_sub: profile.sub,
        roles,
        profile,
        ...(pictureDataUrl ? { picture_data: pictureDataUrl } : {}),
      }
    } catch (error) {
      const normalized = normalizeOAuthError(error)
      logServerError('[auth:session]', error, {
        normalizedError: normalized,
        role: input.role || 'user',
      })
      if (ctx.response) {
        ;(ctx.response as any).status(normalized.status).json({
          ok: false,
          error: normalized.code,
          message: normalized.message,
        })
        return
      }
      throw new HttpError(normalized.status, normalized.code, { message: normalized.message })
    }
  }
}

interface PendingConnection {
  connectionId: string
  serverName: string
  offer: any
  auth?: any
  client?: any
  resolve?: (answer: any) => void
  reject?: (error: any) => void
  timer?: NodeJS.Timeout
}

interface ConnectRequest {
  server_name: string
  offer: { type: string; sdp?: string }
  auth?: { mode: string; credentials: any }
  client?: { ip_hint?: string; request_id?: string; user_agent?: string }
}

interface ConnectResponse {
  ok: boolean
  answer?: { type: string; sdp?: string }
  /** Matched canonical server name (may be a prefix of the requested name). */
  server_name?: string
  /** Leftover path after prefix match; begins with '/' when non-empty. */
  path?: string
  error?: string
  message?: string
}

/**
 * Given a requested server_name, find the longest registered prefix that maps
 * to a live host session. Returns the matched name plus the remaining path
 * (with leading slash, or '' for an exact match). Returns null if no prefix
 * has a live host.
 *
 * Prefix walk is done on '/' segments. normalizeServerNameInput trims/lowercases
 * the input and strips scheme/trailing slash.
 */
function resolveLongestPrefixHost(requested: string): { matched: string; path: string; hostSessionId: string } | null {
  const normalized = requested.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/+$/, '')
  if (!normalized) return null
  const segments = normalized.split('/').filter(Boolean)
  const tried: string[] = []
  for (let count = segments.length; count > 0; count--) {
    const candidate = segments.slice(0, count).join('/')
    tried.push(candidate)
    const hostSessionId = serverNameToSession.get(candidate)
    if (!hostSessionId) continue
    if (!liveSessions.has(hostSessionId)) continue
    const remainderSegments = segments.slice(count)
    const path = remainderSegments.length === 0 ? '' : '/' + remainderSegments.join('/')
    console.log(`[prefix] requested=${JSON.stringify(requested)} matched=${candidate} path=${path}`)
    return { matched: candidate, path, hostSessionId }
  }
  console.log(
    `[prefix] MISS requested=${JSON.stringify(requested)} normalized=${JSON.stringify(normalized)} ` +
    `tried=${JSON.stringify(tried)} registered=${JSON.stringify([...serverNameToSession.keys()])} ` +
    `live=${JSON.stringify([...liveSessions.keys()])}`,
  )
  return null
}

// HTTP Controllers
@Controller()
class UserController {
  private service = new NamespaceAdminService()

  @GET({ auth: 'jwt' })
  async namespaces(_input: unknown, ctx: RouteContext) {
    return await this.service.getNamespacesForUser(ctx.auth!.user.sub)
  }

  @GET({ auth: 'jwt' })
  async requests(_input: unknown, ctx: RouteContext) {
    return await this.service.getRequestsForUser(ctx.auth!.user.sub)
  }

  @POST({ auth: 'jwt' })
  async requestNamespace(input: { namespace: string; metadata?: Record<string, any> }, ctx: RouteContext) {
    const sub = ctx.auth!.user.sub
    if (!input.namespace) throw new HttpError(400, 'missing namespace')
    const origin = new URL(AUTHORITY_URL).hostname
    const req = await this.service.requestNamespace(sub, origin, input.namespace, input.metadata)
    return { ok: true, request: req }
  }
}

@Controller()
class HealthController {
  @GET()
  async healthz() {
    return { status: 'ok', timestamp: new Date().toISOString() }
  }

  @GET()
  async readyz() {
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
      services: { postgres: true, redis: true },
    }
  }
}

@Controller()
class ConnectController {
  @POST()
  async connect(input: ConnectRequest, ctx: RouteContext): Promise<ConnectResponse> {
    const requesterKey = getRequesterKey(input, ctx)

    try {
      if (await blockService.isClientBanned(requesterKey)) {
        return { ok: false, error: 'rate_limited', message: 'Temporarily blocked due to malformed or abusive traffic' }
      }

      let connectRequest
      try {
        connectRequest = parseAuthorityConnectRequest(input)
      } catch (error) {
        if (error instanceof AuthorityValidationError) {
          const strike = await strikeService.recordMalformedRequest(requesterKey)
          if (strike.recommendedBanSeconds) {
            await blockService.banClient(requesterKey, strike.recommendedBanSeconds, 'malformed')
          }
          return { ok: false, error: 'malformed', message: error.message }
        }
        throw error
      }

      const { server_name, offer, auth, client } = connectRequest

      const rateDecision = await rateLimitService.checkConnectAllowance(requesterKey)
      if (!rateDecision.allowed) {
        return {
          ok: false,
          error: 'rate_limited',
          message: `Rate limited. Retry in ${Math.ceil((rateDecision.retryAfterMs || 0) / 1000)}s`,
        }
      }

      if (getAuthorityModeForServerName(server_name) === 'dmz') {
        return {
          ok: false,
          error: 'rejected',
          message: 'DMZ names must use MQTT signaling, not authority mode',
        }
      }

      const resolved = resolveLongestPrefixHost(server_name)
      if (!resolved) {
        return { ok: false, error: 'server_offline', message: `No online host for "${server_name}"` }
      }
      const matchedServerName = resolved.matched
      const remainderPath = resolved.path

      if (await blockService.isClientSuppressed(matchedServerName, requesterKey)) {
        return { ok: false, error: 'rejected', message: 'Client is temporarily suppressed for this server' }
      }

      const hostSession = liveSessions.get(resolved.hostSessionId)!
      const hostWs = (hostSession as any).__ws as WebSocketSession | undefined
      if (!hostWs || !hostWs.isOpen()) {
        return { ok: false, error: 'server_offline', message: `Host for "${matchedServerName}" is not connected` }
      }

      const connectionId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      const pending: PendingConnection = { connectionId, serverName: matchedServerName, offer, auth, client }

      pending.timer = setTimeout(() => {
        pendingConnections.delete(connectionId)
      }, PENDING_CLEANUP_MS)

      const answerPromise = new Promise<any>((resolve, reject) => {
        pending.resolve = resolve
        pending.reject = reject
      })

      pendingConnections.set(connectionId, pending)

      hostWs.send({
        type: 'connect_request',
        connection_id: connectionId,
        server_name: matchedServerName,
        offer,
        auth,
        client,
      })

      const timeoutPromise = new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT_MS),
      )

      try {
        const answer = await Promise.race([answerPromise, timeoutPromise])
        clearTimeout(pending.timer)
        pendingConnections.delete(connectionId)
        void activityService.recordClientConnect(matchedServerName, 'ok', requesterKey)
        return { ok: true, answer, server_name: matchedServerName, path: remainderPath }
      } catch (error: any) {
        clearTimeout(pending.timer)
        pendingConnections.delete(connectionId)
        const outcome = String(error?.message || '').includes('timeout') ? 'timeout' : 'rejected'
        void activityService.recordClientConnect(matchedServerName, outcome, requesterKey, String(error?.message || ''))
        if (outcome === 'timeout') {
          return { ok: false, error: 'timed_out', message: 'Host did not respond in time' }
        }
        return { ok: false, error: 'rejected', message: String(error?.message || 'rejected') }
      }
    } catch (error: any) {
      logServerError('/connect error', error)
      return { ok: false, error: 'rejected', message: error.message }
    }
  }
}

// WebSocket Controllers (using PLAT decorators!)
@WebSocketController('/ws/host')
class HostWebSocketController {
  @WebSocketMessage()
  async hello(msg: { token?: string }, session: WebSocketSession) {
    const wsKey = `ip:${getSessionIp(session)}`
    const decision = await rateLimitService.checkAllowance('ws_host_msg', wsKey, WS_HOST_MSG_RATE_LIMIT_PER_30S)
    if (!decision.allowed) {
      session.close(1008, 'Rate limited')
      return
    }

    const parsed = parseAuthorityHostMessage(msg)
    if (parsed.type !== 'hello') {
      session.close(1008, 'Invalid hello message')
      return
    }

    const token = parsed.token
    if (!token) {
      session.close(1008, 'Missing auth token')
      return
    }

    let googleSub: string
    try {
      const verified = await hostAuthService.verifyHostToken(token)
      googleSub = verified.googleSub
    } catch (error: any) {
      session.close(1008, `Invalid host token: ${error?.message || 'verification_failed'}`)
      return
    }
    const hostSessionId = `host_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    const hostSession = new AuthorityHostSession({ hostSessionId, googleSub })
    ;(hostSession as any).__ws = session

    liveSessions.set(hostSessionId, hostSession)
    ;(session as any).__hostSessionId = hostSessionId
    ;(session as any).__hostSession = hostSession

    console.log(`[host] Authenticated: ${hostSessionId} (${googleSub})`)
    void activityService.recordHostConnected({
      hostSessionId,
      googleSub,
      ip: getSessionIp(session),
      connectedAt: Date.now(),
    })
    session.send({ type: 'pong' })
  }

  @WebSocketMessage()
  async register_online(msg: { servers?: any[] }, session: WebSocketSession) {
    const wsKey = `ip:${getSessionIp(session)}`
    const decision = await rateLimitService.checkAllowance('ws_host_msg', wsKey, WS_HOST_MSG_RATE_LIMIT_PER_30S)
    if (!decision.allowed) {
      session.close(1008, 'Rate limited')
      return
    }

    const parsed = parseAuthorityHostMessage(msg)
    if (parsed.type !== 'register_online') {
      session.close(1008, 'Invalid register_online message')
      return
    }

    const hostSession = (session as any).__hostSession as AuthorityHostSession | undefined
    if (!hostSession) {
      session.close(1008, 'Not authenticated')
      return
    }

    try {
      const ownershipService = await getServerOwnershipService()
      const registrationService = new RegistrationService({
        ownershipService,
      })

      const result = await registrationService.registerOnline(hostSession, parsed.servers)

      const hostSessionId = (session as any).__hostSessionId as string
      for (const server of result.accepted) {
        serverNameToSession.set(server.server_name, hostSessionId)
        publishPresenceUpdate(server.server_name, true)
        void activityService.markServerOnline(server.server_name, hostSessionId, server.auth_mode)
        void serverNameHistoryService.recordSeen(server.server_name, hostSession.googleSub)
        console.log(`[host] Registered: ${server.server_name}`)
      }

      session.send({
        type: 'register_response',
        accepted: result.accepted.map((s) => s.server_name),
        rejected: result.rejected,
      })
    } catch (error: any) {
      logServerError('[host] Registration error', error)
      session.send({ type: 'register_error', message: error.message })
    }
  }

  @WebSocketMessage()
  async register_offline(msg: { server_names?: string[] }, session: WebSocketSession) {
    const wsKey = `ip:${getSessionIp(session)}`
    const decision = await rateLimitService.checkAllowance('ws_host_msg', wsKey, WS_HOST_MSG_RATE_LIMIT_PER_30S)
    if (!decision.allowed) {
      session.close(1008, 'Rate limited')
      return
    }

    const parsed = parseAuthorityHostMessage(msg)
    if (parsed.type !== 'register_offline') {
      session.close(1008, 'Invalid register_offline message')
      return
    }

    const hostSession = (session as any).__hostSession as AuthorityHostSession | undefined
    if (!hostSession) {
      session.close(1008, 'Not authenticated')
      return
    }

    for (const serverName of parsed.server_names) {
      serverNameToSession.delete(serverName)
      hostSession.unregisterServers([serverName])
      publishPresenceUpdate(serverName, false)
      void activityService.markServerOffline(serverName)
      console.log(`[host] Unregistered: ${serverName}`)
    }
    session.send({ type: 'pong' })
  }

  @WebSocketMessage()
  async connect_answer(msg: { connection_id?: string; answer?: any }, session: WebSocketSession) {
    const wsKey = `ip:${getSessionIp(session)}`
    const decision = await rateLimitService.checkAllowance('ws_host_msg', wsKey, WS_HOST_MSG_RATE_LIMIT_PER_30S)
    if (!decision.allowed) {
      session.close(1008, 'Rate limited')
      return
    }

    const parsed = parseAuthorityHostMessage(msg)
    if (parsed.type !== 'connect_answer') {
      session.close(1008, 'Invalid connect_answer message')
      return
    }

    const pending = pendingConnections.get(parsed.connection_id)
    if (pending && pending.resolve) {
      pending.resolve(parsed.answer)
      console.log(`[host] Sent answer for connection ${parsed.connection_id}`)
    }
  }

  @WebSocketMessage()
  async connect_reject(msg: { connection_id?: string; reason?: string }, session: WebSocketSession) {
    const wsKey = `ip:${getSessionIp(session)}`
    const decision = await rateLimitService.checkAllowance('ws_host_msg', wsKey, WS_HOST_MSG_RATE_LIMIT_PER_30S)
    if (!decision.allowed) {
      session.close(1008, 'Rate limited')
      return
    }

    const parsed = parseAuthorityHostMessage(msg)
    if (parsed.type !== 'connect_reject') {
      session.close(1008, 'Invalid connect_reject message')
      return
    }

    const pending = pendingConnections.get(parsed.connection_id)
    if (pending && pending.reject) {
      pending.reject(new Error(parsed.reason))
      console.log(`[host] Rejected connection ${parsed.connection_id}: ${parsed.reason}`)
    }
  }

  @WebSocketMessage()
  async ping(msg: any, session: WebSocketSession) {
    const wsKey = `ip:${getSessionIp(session)}`
    const decision = await rateLimitService.checkAllowance('ws_host_msg', wsKey, WS_HOST_MSG_RATE_LIMIT_PER_30S)
    if (!decision.allowed) {
      session.close(1008, 'Rate limited')
      return
    }

    const parsed = parseAuthorityHostMessage(msg)
    if (parsed.type !== 'ping') {
      session.close(1008, 'Invalid ping message')
      return
    }
    const hostSessionId = (session as any).__hostSessionId as string | undefined
    if (hostSessionId) void activityService.recordHostPong(hostSessionId)
    session.send({ type: 'pong' })
  }

  @WebSocketMessage()
  async suppress_client(msg: any, session: WebSocketSession) {
    const wsKey = `ip:${getSessionIp(session)}`
    const decision = await rateLimitService.checkAllowance('ws_host_msg', wsKey, WS_HOST_MSG_RATE_LIMIT_PER_30S)
    if (!decision.allowed) {
      session.close(1008, 'Rate limited')
      return
    }

    const parsed = parseAuthorityHostMessage(msg)
    if (parsed.type !== 'suppress_client') {
      session.close(1008, 'Invalid suppress_client message')
      return
    }

    const hostSession = (session as any).__hostSession as AuthorityHostSession | undefined
    if (!hostSession) {
      session.close(1008, 'Not authenticated')
      return
    }

    if (!hostSession.isRegistered(parsed.server_name)) {
      session.send({ type: 'register_error', message: `Server ${parsed.server_name} is not registered in this host session` })
      return
    }

    await blockService.suppressClient(parsed.server_name, parsed.client_key, parsed.ttl_seconds, parsed.reason)
    session.send({ type: 'pong' })
  }

  async onClose(session: WebSocketSession) {
    const hostSessionId = (session as any).__hostSessionId as string | undefined
    if (hostSessionId) {
      liveSessions.delete(hostSessionId)
      const wentOffline: string[] = []
      for (const [serverName, sessionId] of serverNameToSession.entries()) {
        if (sessionId === hostSessionId) {
          serverNameToSession.delete(serverName)
          wentOffline.push(serverName)
        }
      }
      for (const serverName of wentOffline) {
        publishPresenceUpdate(serverName, false)
        void activityService.markServerOffline(serverName)
      }
      void activityService.recordHostDisconnected(hostSessionId)
      console.log(`[host] Disconnected: ${hostSessionId}`)
    }
  }
}

@WebSocketController('/ws/presence')
class PresenceWebSocketController {
  @WebSocketMessage()
  async subscribe(msg: any, session: WebSocketSession) {
    const wsKey = `ip:${getSessionIp(session)}`
    const decision = await rateLimitService.checkAllowance('ws_presence_msg', wsKey, WS_PRESENCE_MSG_RATE_LIMIT_PER_30S)
    if (!decision.allowed) {
      session.close(1008, 'Rate limited')
      return
    }

    const parsed = parseAuthorityPresenceMessage(msg)
    if (parsed.type !== 'subscribe') {
      session.close(1008, 'Invalid subscribe message')
      return
    }

    const existing = presenceSubscriptions.get(session) ?? new Set<string>()
    for (const serverName of parsed.server_names) {
      if (getAuthorityModeForServerName(serverName) === 'authority') {
        existing.add(serverName)
      }
    }
    presenceSubscriptions.set(session, existing)

    session.send({
      type: 'presence_snapshot',
      servers: Array.from(existing).sort().map((serverName) => ({
        server_name: serverName,
        online: isServerOnline(serverName),
      })),
    })
  }

  @WebSocketMessage()
  async unsubscribe(msg: any, session: WebSocketSession) {
    const wsKey = `ip:${getSessionIp(session)}`
    const decision = await rateLimitService.checkAllowance('ws_presence_msg', wsKey, WS_PRESENCE_MSG_RATE_LIMIT_PER_30S)
    if (!decision.allowed) {
      session.close(1008, 'Rate limited')
      return
    }

    const parsed = parseAuthorityPresenceMessage(msg)
    if (parsed.type !== 'unsubscribe') {
      session.close(1008, 'Invalid unsubscribe message')
      return
    }

    const existing = presenceSubscriptions.get(session)
    if (!existing) return
    for (const serverName of parsed.server_names) {
      existing.delete(serverName)
    }
    if (existing.size === 0) {
      presenceSubscriptions.delete(session)
    }
  }

  @WebSocketMessage()
  async ping(msg: any, session: WebSocketSession) {
    const wsKey = `ip:${getSessionIp(session)}`
    const decision = await rateLimitService.checkAllowance('ws_presence_msg', wsKey, WS_PRESENCE_MSG_RATE_LIMIT_PER_30S)
    if (!decision.allowed) {
      session.close(1008, 'Rate limited')
      return
    }

    const parsed = parseAuthorityPresenceMessage(msg)
    if (parsed.type !== 'ping') {
      session.close(1008, 'Invalid ping message')
      return
    }
    session.send({ type: 'pong' })
  }

  async onClose(session: WebSocketSession) {
    presenceSubscriptions.delete(session)
  }
}

// Bootstrap PLAT server with WebSocket support
const server = createServer(
  {
    port: PORT,
    host: HOST,
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'X-Admin-Token', 'X-Admin-Session'],
    },
    protocolPlugins: [createWebSocketProtocolPlugin([HostWebSocketController, PresenceWebSocketController])],
    async onError(req, _res, err, statusCode) {
      console.error('[http:error]', {
        statusCode,
        method: req.method,
        path: req.originalUrl || req.url,
        query: req.query,
        body: req.body,
        error: sanitizeErrorForLog(err),
      })
    },
    auth: {
      verify(mode, req, ctx) {
        // 'jwt' mode: verify JWT, return decoded payload as user (sub, email, name, roles, etc.)
        // 'admin' mode: also accept static ADMIN_TOKEN, otherwise verify JWT + check admin role
        if (mode === 'jwt' || mode === 'admin') {
          // Static admin token shortcut
          if (mode === 'admin') {
            const token = getAdminAuthToken(req)
            if (token === ADMIN_TOKEN) {
              return { role: 'admin', source: 'static-token' }
            }
          }

          // Delegate to plat's built-in JWT auth (extracts Bearer token, verifies, returns decoded payload)
          const payload = jwtAuth.verify('jwt', req, ctx)

          if (mode === 'admin') {
            const roles = Array.isArray(payload.roles) ? payload.roles : []
            if (!roles.includes('admin')) {
              throw new HttpError(403, 'not_admin')
            }
            if (adminGoogleSubs.size > 0 && !adminGoogleSubs.has(payload.sub)) {
              throw new HttpError(403, 'not_admin')
            }
          }

          return payload
        }

        return { mode: 'public' }
      },
    },
  },
  HealthController,
  ConnectController,
  AuthController,
  UserController,
  Admin,
)

server.listen(PORT, () => {
  console.log(`\n✅ PLAT Authority Server running on port ${PORT}`)
  console.log(`   Health: ${AUTHORITY_URL}/healthz`)
  console.log(`   Ready: ${AUTHORITY_URL}/readyz`)
  console.log(`   Connect: POST ${AUTHORITY_URL}/connect`)
  console.log(`   Host WS: ws://localhost:${PORT}/ws/host`)
  console.log(`   Presence WS: ws://localhost:${PORT}/ws/presence`)
  console.log(`   Docs: ${AUTHORITY_URL}/\n`)
})

// Initialize database on startup
initializeDatabase().catch((error) => {
  logServerError('Failed to initialize database', error)
  process.exit(1)
})
