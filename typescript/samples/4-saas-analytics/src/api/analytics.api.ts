import { Controller, GET, POST } from 'plat'
import type { RouteContext } from 'plat'
import type {
  User, AnalyticsEvent, PageView, Analytics,
  TrackEventInput, TrackPageViewInput, GetAnalyticsInput, ListEventsInput,
} from '../../shared/types'

const events: AnalyticsEvent[] = [
  { id: '1', userId: 'user123', eventType: 'pageView', timestamp: new Date(Date.now() - 86400000).toISOString() },
  { id: '2', userId: 'user456', eventType: 'click', properties: { target: 'button' }, timestamp: new Date(Date.now() - 3600000).toISOString() },
]

const pageViews: PageView[] = [
  { id: '1', userId: 'user123', page: '/dashboard', timestamp: new Date().toISOString() },
  { id: '2', userId: 'user456', page: '/home', timestamp: new Date().toISOString() },
]

const users: Map<string, User> = new Map([
  ['user123', { id: 'user123', email: 'alice@example.com', name: 'Alice', role: 'admin' }],
  ['user456', { id: 'user456', email: 'bob@example.com', name: 'Bob', role: 'analyst' }],
])

@Controller()
export class AnalyticsApi {
  @POST()
  async trackEvent(input: TrackEventInput, ctx: RouteContext): Promise<AnalyticsEvent> {
    const event: AnalyticsEvent = {
      id: String(events.length + 1),
      userId: input.userId,
      eventType: input.eventType,
      properties: input.properties,
      timestamp: new Date().toISOString(),
    }
    events.push(event)
    return event
  }

  @POST()
  async trackPageView(input: TrackPageViewInput, ctx: RouteContext): Promise<PageView> {
    const pageView: PageView = {
      id: String(pageViews.length + 1),
      userId: input.userId,
      page: input.page,
      referrer: input.referrer,
      timestamp: new Date().toISOString(),
    }
    pageViews.push(pageView)
    return pageView
  }

  @GET()
  async getAnalytics(input: GetAnalyticsInput = {}, ctx: RouteContext): Promise<Analytics> {
    const fromDate = input.from ? new Date(input.from) : new Date(Date.now() - 7 * 86400000)
    const toDate = input.to ? new Date(input.to) : new Date()

    const filtered = events.filter(e => {
      const d = new Date(e.timestamp)
      return d >= fromDate && d <= toDate
    })

    const uniqueUsers = new Set(filtered.map(e => e.userId)).size
    const eventTypes: Record<string, number> = {}
    filtered.forEach(e => { eventTypes[e.eventType] = (eventTypes[e.eventType] || 0) + 1 })

    const pageMap: Record<string, number> = {}
    pageViews
      .filter(pv => { const d = new Date(pv.timestamp); return d >= fromDate && d <= toDate })
      .forEach(pv => { pageMap[pv.page] = (pageMap[pv.page] || 0) + 1 })

    const topPages = Object.entries(pageMap)
      .map(([page, views]) => ({ page, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10)

    return { totalEvents: filtered.length, uniqueUsers, eventTypes, topPages }
  }

  @GET({ auth: 'public' })
  async getProfile(input: { id: string }, ctx: RouteContext): Promise<User> {
    const user = users.get(input.id)
    if (!user) throw new Error(`User ${input.id} not found`)
    return user
  }

  @GET()
  async listEvents(input: ListEventsInput = {}, ctx: RouteContext) {
    const { userId, eventType, limit = 10, offset = 0 } = input
    let filtered = [...events]
    if (userId) filtered = filtered.filter(e => e.userId === userId)
    if (eventType) filtered = filtered.filter(e => e.eventType === eventType)

    return {
      events: filtered.slice(offset, offset + limit),
      total: filtered.length,
    }
  }
}
