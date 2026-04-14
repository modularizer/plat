import test from 'node:test'
import assert from 'node:assert/strict'

import { AdminSessionService } from '../dist/index.js'

test('AdminSessionService issues and verifies sessions', async () => {
  const service = new AdminSessionService({ ttlSeconds: 60, secret: 'test-secret' })

  const session = service.issueSession('google-sub-admin')
  const verified = service.verifySession(session.token)

  assert.equal(verified?.googleSub, 'google-sub-admin')
  assert.equal(verified?.roles.includes('admin'), true)
})

test('AdminSessionService expires sessions', async () => {
  const service = new AdminSessionService({ ttlSeconds: 1, secret: 'test-secret' })

  const session = service.issueSession('google-sub-admin')
  assert.equal(service.verifySession(session.token)?.googleSub, 'google-sub-admin')

  await new Promise((resolve) => setTimeout(resolve, 1100))
  assert.equal(service.verifySession(session.token), null)
})

test('AdminSessionService rejects tampered sessions', async () => {
  const service = new AdminSessionService({ ttlSeconds: 60, secret: 'test-secret' })

  const session = service.issueSession('google-sub-admin')
  const tampered = `${session.token.slice(0, -1)}x`

  assert.equal(service.verifySession(tampered), null)
})
