import { createServer, createJwtAuth } from 'plat'
import { AnalyticsApi } from './api/analytics.api'

const server = createServer(
  {
    port: 3000,
    cors: true,
    auth: createJwtAuth({ secret: process.env.JWT_SECRET || 'dev-secret-change-in-production' }),
  },
  AnalyticsApi,
)

server.listen()
console.log('Analytics API running on http://localhost:3000')
console.log('')
console.log('Public (no auth):')
console.log('  curl http://localhost:3000/getProfile?id=user123')
console.log('')
console.log('Protected (JWT required):')
console.log('  plat jwt generate --user-id=user123 --role=analyst')
console.log('  curl -H "Authorization: Bearer TOKEN" http://localhost:3000/getAnalytics')
