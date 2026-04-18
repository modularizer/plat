import { z } from 'zod'

export interface NamespaceRequest {
  id: string
  requesterId: string
  requesterName: string
  requestedOrigin: string
  requestedNamespace: string
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  createdAt: string
}

export interface AssignedNamespace {
  origin: string
  namespace: string
  ownerGoogleSub: string
  ownerName: string
  assignedAt: string
}

type ApproveInput = { requestId: string }
type RejectInput = { requestId: string; reason: string }

const namespaceRequestSchema = z.object({
  id: z.string(),
  requesterId: z.string(),
  requesterName: z.string(),
  requestedOrigin: z.string(),
  requestedNamespace: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  rejectionReason: z.string().optional(),
  createdAt: z.string(),
})

const assignedNamespaceSchema = z.object({
  origin: z.string(),
  namespace: z.string(),
  ownerGoogleSub: z.string(),
  ownerName: z.string(),
  assignedAt: z.string(),
})

const approveInputSchema = z.object({
  requestId: z.string(),
})

const rejectInputSchema = z.object({
  requestId: z.string(),
  reason: z.string(),
})

const okSchema = z.object({ ok: z.boolean() }).passthrough()

const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'

function getHeaders(): Record<string, string> {
  const token = localStorage.getItem('admin_token')
  return token
    ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    : { 'content-type': 'application/json' }
}

async function requestJson<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init)
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${path}`)
  }
  const payload = await response.json()
  return schema.parse(payload)
}

export interface ActivityServer {
  serverName: string
  origin: string
  namespace: string
  ownerGoogleSub: string
  ownerName: string | null
  firstSeenAt: number
  lastSeenAt: number
  online: boolean
}

export interface ActivityEvent {
  ts: number
  type: string
  serverName: string
  hostSessionId?: string
  googleSub?: string
  clientKey?: string
  reason?: string
  authMode?: string
}

export interface ActivityServerSnapshot {
  serverName: string
  online: boolean
  hostSessionId?: string
  authMode?: string
  host?: {
    hostSessionId: string
    googleSub: string
    ip: string
    connectedAt: number
    lastPongAt: number
  }
  events: ActivityEvent[]
}

const activityServerSchema = z.object({
  serverName: z.string(),
  origin: z.string(),
  namespace: z.string(),
  ownerGoogleSub: z.string(),
  ownerName: z.string().nullable(),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  online: z.boolean(),
})

const activityEventSchema = z.object({
  ts: z.number(),
  type: z.string(),
  serverName: z.string(),
  hostSessionId: z.string().optional(),
  googleSub: z.string().optional(),
  clientKey: z.string().optional(),
  reason: z.string().optional(),
  authMode: z.string().optional(),
})

const activityServerSnapshotSchema = z.object({
  serverName: z.string(),
  online: z.boolean(),
  hostSessionId: z.string().optional(),
  authMode: z.string().optional(),
  host: z.object({
    hostSessionId: z.string(),
    googleSub: z.string(),
    ip: z.string(),
    connectedAt: z.number(),
    lastPongAt: z.number(),
  }).optional(),
  events: z.array(activityEventSchema),
})

export interface AuthSessionResult {
  session_token: string
  google_sub: string
  roles: string[]
  profile: { sub: string; email?: string; name?: string; picture?: string }
  picture_data?: string
}

const authSessionSchema = z.object({
  ok: z.literal(true),
  session_token: z.string(),
  google_sub: z.string(),
  roles: z.array(z.string()),
  profile: z.object({
    sub: z.string(),
    email: z.string().optional(),
    name: z.string().optional(),
    picture: z.string().optional(),
  }).passthrough(),
  picture_data: z.string().optional(),
})

export async function exchangeGoogleIdToken(idToken: string, role: 'admin' | 'user' = 'admin'): Promise<AuthSessionResult> {
  const response = await fetch(`${baseUrl}/authSession`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id_token: idToken, role }),
  })
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Sign-in failed (${response.status})`
    throw new Error(message)
  }
  return authSessionSchema.parse(payload)
}

export const api = {
  requests: async (_input: Record<string, never>) => {
    return requestJson('/adminRequests', { method: 'GET', headers: getHeaders() }, z.array(namespaceRequestSchema))
  },
  assignedNamespaces: async (_input: Record<string, never>) => {
    return requestJson('/assignedNamespaces', { method: 'GET', headers: getHeaders() }, z.array(assignedNamespaceSchema))
  },
  approve: async (input: ApproveInput) => {
    const payload = approveInputSchema.parse(input)
    return requestJson('/approve', { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) }, okSchema)
  },
  reject: async (input: RejectInput) => {
    const payload = rejectInputSchema.parse(input)
    return requestJson('/reject', { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) }, okSchema)
  },
  activityServers: async () => {
    const schema = z.object({ servers: z.array(activityServerSchema) })
    const res = await requestJson('/activityServers', { method: 'GET', headers: getHeaders() }, schema)
    return res.servers
  },
  activityServer: async (serverName: string) => {
    const schema = z.object({ snapshot: activityServerSnapshotSchema })
    const res = await requestJson(
      `/activityServer?serverName=${encodeURIComponent(serverName)}`,
      { method: 'GET', headers: getHeaders() },
      schema,
    )
    return res.snapshot
  },
  activityRecent: async (limit = 100) => {
    const schema = z.object({ events: z.array(activityEventSchema) })
    const res = await requestJson(
      `/activityRecent?limit=${limit}`,
      { method: 'GET', headers: getHeaders() },
      schema,
    )
    return res.events
  },
}
