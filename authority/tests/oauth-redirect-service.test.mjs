import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OAuthRedirectService,
  GoogleOAuthService,
  GoogleOAuthError,
} from '../dist/index.js'

test('OAuthRedirectService issues state and one-time grant', async () => {
  const service = new OAuthRedirectService({
    allowedRedirectOrigins: ['http://localhost:5173'],
  })

  const state = service.createState('http://localhost:5173/callback', 'admin')
  const stateEntry = service.consumeState(state)
  assert.equal(stateEntry.redirectUri, 'http://localhost:5173/callback')
  assert.equal(stateEntry.role, 'admin')
})

test('OAuthRedirectService rejects disallowed redirect origins', async () => {
  const service = new OAuthRedirectService({
    allowedRedirectOrigins: ['https://example.com'],
  })

  assert.throws(
    () => service.createState('http://localhost:5173/callback'),
    /redirect_uri origin is not allowed/,
  )
})

test('GoogleOAuthService builds authorization URL', async () => {
  const oauth = new GoogleOAuthService({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://authority.example.com/oauthCallback',
  })

  const url = new URL(oauth.buildAuthorizationUrl('state-123'))
  assert.equal(url.host, 'accounts.google.com')
  assert.equal(url.searchParams.get('client_id'), 'client-id')
  assert.equal(url.searchParams.get('state'), 'state-123')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://authority.example.com/oauthCallback')
})

test('GoogleOAuthService surfaces token exchange failure details', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'invalid_grant' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })

  try {
    const oauth = new GoogleOAuthService({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://authority.example.com/oauthCallback',
    })

    await assert.rejects(
      () => oauth.exchangeCode('bad-code'),
      (error) => {
        assert.ok(error instanceof GoogleOAuthError)
        assert.equal(error.code, 'oauth_token_exchange_failed')
        assert.equal(error.status, 400)
        assert.match(error.details || '', /invalid_grant/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
