import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AuthorityValidationError,
  parseAuthorityConnectRequest,
  parseAuthorityHostMessage,
  parseAuthorityPresenceMessage,
} from '../dist/index.js'

test('parseAuthorityConnectRequest accepts a minimal valid request', () => {
  const request = parseAuthorityConnectRequest({
    server_name: 'team/alice/notebook',
    offer: { type: 'offer', sdp: 'v=0' },
    auth: { mode: 'public', credentials: null },
    client: { request_id: 'req-1', user_agent: 'test-agent' },
  })

  assert.equal(request.server_name, 'team/alice/notebook')
  assert.equal(request.offer.type, 'offer')
  assert.equal(request.auth?.mode, 'public')
  assert.equal(request.client?.request_id, 'req-1')
})

test('parseAuthorityConnectRequest rejects unknown fields', () => {
  assert.throws(
    () => parseAuthorityConnectRequest({
      server_name: 'team/alice/notebook',
      offer: { type: 'offer', sdp: 'v=0' },
      extra: true,
    }),
    (error) => error instanceof AuthorityValidationError
      && error.message.includes('unknown field'),
  )
})

test('parseAuthorityHostMessage parses register_online messages', () => {
  const message = parseAuthorityHostMessage({
    type: 'register_online',
    servers: [
      { server_name: 'team/alice/notebook', auth_mode: 'public' },
    ],
  })

  assert.equal(message.type, 'register_online')
  assert.equal(message.servers.length, 1)
  assert.equal(message.servers[0].server_name, 'team/alice/notebook')
})

test('parseAuthorityPresenceMessage parses subscribe messages', () => {
  const message = parseAuthorityPresenceMessage({
    type: 'subscribe',
    server_names: ['team/alice/notebook'],
  })

  assert.equal(message.type, 'subscribe')
  assert.deepEqual(message.server_names, ['team/alice/notebook'])
})

