export type CallEventKind = 'progress' | 'log' | 'chunk' | 'message'
export type CallSessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface CallSessionEvent {
  seq: number
  at: string
  event: CallEventKind
  data?: unknown
}

export interface CallSessionRecord {
  id: string
  operationId: string
  method: string
  path: string
  status: CallSessionStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  statusCode?: number
  result?: unknown
  error?: { message: string; statusCode?: number; data?: unknown }
  events: CallSessionEvent[]
}

export class InMemoryCallSessionController {
  private sessions = new Map<string, CallSessionRecord>()
  private seq = 0
  private activeCancels = new Map<string, () => void>()

  create(args: { operationId: string; method: string; path: string }): CallSessionRecord {
    this.seq += 1
    const now = new Date().toISOString()
    const session: CallSessionRecord = {
      id: `call-${this.seq}`,
      operationId: args.operationId,
      method: args.method,
      path: args.path,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      events: [],
    }
    this.sessions.set(session.id, session)
    return session
  }

  get(id: string): CallSessionRecord | undefined {
    return this.sessions.get(id)
  }

  setCancel(id: string, cancel: () => void): void {
    this.activeCancels.set(id, cancel)
  }

  start(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    const now = new Date().toISOString()
    session.status = 'running'
    session.startedAt = session.startedAt ?? now
    session.updatedAt = now
  }

  appendEvent(id: string, event: CallEventKind, data?: unknown): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.events.push({
      seq: session.events.length + 1,
      at: new Date().toISOString(),
      event,
      data,
    })
    session.updatedAt = new Date().toISOString()
  }

  complete(id: string, result: unknown, statusCode: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    const now = new Date().toISOString()
    session.status = 'completed'
    session.completedAt = now
    session.updatedAt = now
    session.statusCode = statusCode
    session.result = result
    this.activeCancels.delete(id)
  }

  fail(id: string, error: { message: string; statusCode?: number; data?: unknown }): void {
    const session = this.sessions.get(id)
    if (!session) return
    const now = new Date().toISOString()
    session.status = 'failed'
    session.completedAt = now
    session.updatedAt = now
    session.error = error
    this.activeCancels.delete(id)
  }

  cancel(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    this.activeCancels.get(id)?.()
    const now = new Date().toISOString()
    session.status = 'cancelled'
    session.completedAt = now
    session.updatedAt = now
    this.activeCancels.delete(id)
    return true
  }

  listEvents(id: string, since = 0, event?: CallEventKind): CallSessionEvent[] {
    const session = this.sessions.get(id)
    if (!session) return []
    return session.events.filter((item) => item.seq > since && (!event || item.event === event))
  }
}
