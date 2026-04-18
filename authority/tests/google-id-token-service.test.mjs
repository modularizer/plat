import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GoogleIdTokenService,
  GoogleOAuthError,
} from '../dist/index.js'

function withMockedVerifier(service, verify) {
  // The service composes an OAuth2Client from google-auth-library; swap its
  // verifyIdToken so tests exercise GoogleIdTokenService logic without hitting
  // Google's public keys endpoint.
  service.client.verifyIdToken = verify
  return service
}

test('GoogleIdTokenService requires at least one audience', () => {
  assert.throws(
    () => new GoogleIdTokenService({ audience: '' }),
    /audience/i,
  )
  assert.throws(
    () => new GoogleIdTokenService({ audience: [] }),
    /audience/i,
  )
})

test('GoogleIdTokenService rejects empty tokens before calling Google', async () => {
  const service = new GoogleIdTokenService({ audience: 'client-id' })
  await assert.rejects(
    () => service.verifyIdToken('   '),
    (error) => error instanceof GoogleOAuthError && error.code === 'oauth_id_token_missing',
  )
})

test('GoogleIdTokenService wraps verification failures as GoogleOAuthError', async () => {
  const service = withMockedVerifier(
    new GoogleIdTokenService({ audience: 'client-id' }),
    async () => {
      throw new Error('Wrong recipient, payload audience != requiredAudience')
    },
  )

  await assert.rejects(
    () => service.verifyIdToken('header.payload.signature'),
    (error) => {
      assert.ok(error instanceof GoogleOAuthError, 'expected GoogleOAuthError')
      assert.equal(error.code, 'oauth_id_token_invalid')
      assert.equal(error.status, 401)
      return true
    },
  )
})

test('GoogleIdTokenService returns profile fields from payload', async () => {
  const service = withMockedVerifier(
    new GoogleIdTokenService({ audience: 'client-id' }),
    async () => ({
      getPayload: () => ({
        sub: 'google-sub-1',
        email: 'user@example.com',
        email_verified: true,
        name: 'Test User',
        picture: 'https://example.com/pic.png',
      }),
    }),
  )

  const profile = await service.verifyIdToken('header.payload.signature')
  assert.equal(profile.sub, 'google-sub-1')
  assert.equal(profile.email, 'user@example.com')
  assert.equal(profile.emailVerified, true)
  assert.equal(profile.name, 'Test User')
  assert.equal(profile.picture, 'https://example.com/pic.png')
})

test('GoogleIdTokenService enforces allowedHostedDomains when configured', async () => {
  const service = withMockedVerifier(
    new GoogleIdTokenService({ audience: 'client-id', allowedHostedDomains: ['example.com'] }),
    async () => ({ getPayload: () => ({ sub: 'google-sub-1', hd: 'other.com' }) }),
  )

  await assert.rejects(
    () => service.verifyIdToken('header.payload.signature'),
    (error) => error instanceof GoogleOAuthError && error.code === 'oauth_id_token_hd_not_allowed',
  )
})

test('GoogleIdTokenService rejects payload without sub', async () => {
  const service = withMockedVerifier(
    new GoogleIdTokenService({ audience: 'client-id' }),
    async () => ({ getPayload: () => ({ email: 'user@example.com' }) }),
  )

  await assert.rejects(
    () => service.verifyIdToken('header.payload.signature'),
    (error) => error instanceof GoogleOAuthError && error.code === 'oauth_id_token_missing_sub',
  )
})
