// ── Users ─────────────────────────────────────────────────

export type UserRole = 'admin' | 'analyst' | 'user'

export interface User {
  id: string
  email: string     // format: email
  name: string      // min: 1
  role: UserRole
}

// ── Events ────────────────────────────────────────────────

export interface AnalyticsEvent {
  id: string
  userId: string
  eventType: string // min: 1
  properties?: Record<string, unknown>
  timestamp: string // format: date-time
}

export interface PageView {
  id: string
  userId: string
  page: string      // min: 1
  referrer?: string
  timestamp: string // format: date-time
}

// ── Analytics ─────────────────────────────────────────────

export interface Analytics {
  totalEvents: number   // integer, min: 0
  uniqueUsers: number   // integer, min: 0
  eventTypes: Record<string, number>
  topPages: { page: string; views: number }[]
}

// ── Inputs ────────────────────────────────────────────────

export interface TrackEventInput {
  eventType: string // min: 1
  userId: string
  properties?: Record<string, unknown>
}

export interface TrackPageViewInput {
  userId: string
  page: string      // min: 1
  referrer?: string
}

export interface GetAnalyticsInput {
  from?: string     // format: date-time
  to?: string       // format: date-time
}

export interface ListEventsInput {
  userId?: string
  eventType?: string
  limit?: number    // integer, min: 1, max: 100, default: 10
  offset?: number   // integer, min: 0, default: 0
}
