import test from 'node:test'
import assert from 'node:assert/strict'
import fetch from 'node-fetch'
import { signToken } from '../node_modules/@modularizer/plat/dist/server/auth/jwt.js'
import dotenv from 'dotenv'
import { getServerOwnershipService } from '../dist/storage/index.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../.env') })
console.log('DEBUG DATABASE_URL:', process.env.DATABASE_URL)

// Use the correct Authority server base URL and port from .env or default to 3999
const BASE_URL = process.env.AUTHORITY_URL || 'http://localhost:3999'

function getTestJwt(sub, roles) {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_TOKEN || 'dev-token-change-me'
  return signToken({ sub: sub || 'test-user', roles: roles || ['admin'] }, { secret, expiresIn: '1h' })
}

test('CORS enforcement: allowed, disallowed, and missing origin', async (t) => {
  // Setup: register a server with allowed_origins
  const serverName = 'test/cors-demo'
  const allowedOrigin = 'https://allowed.example.com'
  const disallowedOrigin = 'https://evil.com'

  // Set up namespace ownership for the test user
  const ownershipService = await getServerOwnershipService()
  const testSub = 'test-user'
  await ownershipService.setNamespaceOwnerGoogleSub('', 'test', testSub)

  // Register the server (simulate API call)
  const registerRes = await fetch(`${BASE_URL}/api/server/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getTestJwt(testSub)}` },
    body: JSON.stringify({
      server_name: serverName,
      endpoint_type: 'http',
      address: 'http://localhost:9999',
      allowed_origins: [allowedOrigin],
    }),
  })
  if (registerRes.status !== 200) {
    const text = await registerRes.text()
    console.error('Register failed:', registerRes.status, text)
  }
  assert.equal(registerRes.status, 200)
  const regBody = await registerRes.json()
  assert.equal(regBody.ok, true)

  // Allowed origin
  const allowedRes = await fetch(`${BASE_URL}/api/server/lookup?server_name=${encodeURIComponent(serverName)}`, {
    headers: { Origin: allowedOrigin },
  })
  if (allowedRes.status !== 200) {
    const text = await allowedRes.text()
    console.error('Lookup failed:', allowedRes.status, text)
  }
  assert.equal(allowedRes.status, 200)
  assert.equal(allowedRes.headers.get('access-control-allow-origin'), allowedOrigin)

  // Disallowed origin
  const disallowedRes = await fetch(`${BASE_URL}/api/server/lookup?server_name=${encodeURIComponent(serverName)}`, {
    headers: { Origin: disallowedOrigin },
  })
  assert.equal(disallowedRes.status, 200)
  assert.notEqual(disallowedRes.headers.get('access-control-allow-origin'), disallowedOrigin)

  // Missing origin
  const missingOriginRes = await fetch(`${BASE_URL}/api/server/lookup?server_name=${encodeURIComponent(serverName)}`)
  assert.equal(missingOriginRes.status, 200)
  assert.equal(missingOriginRes.headers.get('access-control-allow-origin'), null)
})
