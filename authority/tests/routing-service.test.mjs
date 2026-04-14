import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getOwnershipKeyFromServerName,
  getNamespaceFromServerName,
  getSubpathFromServerName,
  isNamespaceReserved,
  parseServerNameScope,
  splitServerName,
} from '../dist/index.js'

test('routing-service keeps slash-based namespace parsing', () => {
  assert.deepEqual(splitServerName('team/alice/notebook'), ['team', 'alice', 'notebook'])
  assert.equal(getNamespaceFromServerName('team/alice/notebook'), 'team')
  assert.equal(getSubpathFromServerName('team/alice/notebook'), 'alice/notebook')
})

test('routing-service supports subdomain namespace parsing when base domain is configured', () => {
  process.env.AUTHORITY_SUBDOMAIN_BASE_DOMAIN = 'plat.local'

  assert.deepEqual(splitServerName('whiteboard.alice.plat.local'), ['alice', 'whiteboard'])
  assert.equal(getNamespaceFromServerName('whiteboard.alice.plat.local'), 'alice')
  assert.equal(getSubpathFromServerName('whiteboard.alice.plat.local'), 'whiteboard')

  delete process.env.AUTHORITY_SUBDOMAIN_BASE_DOMAIN
})

test('routing-service maps deeper subdomains to deeper subpaths', () => {
  process.env.AUTHORITY_SUBDOMAIN_BASE_DOMAIN = 'plat.local'

  assert.deepEqual(
    splitServerName('notes.daily.alice.plat.local'),
    ['alice', 'notes', 'daily'],
  )
  assert.equal(getSubpathFromServerName('notes.daily.alice.plat.local'), 'notes/daily')

  delete process.env.AUTHORITY_SUBDOMAIN_BASE_DOMAIN
})

test('routing-service supports origin path namespaces when AUTHORITY_ALLOWED_ORIGINS is set', () => {
  process.env.AUTHORITY_ALLOWED_ORIGINS = 'apple.pear.com,browservable.com'

  const parsed = parseServerNameScope('apple.pear.com/donkey/notebook')
  assert.deepEqual(parsed, {
    origin: 'apple.pear.com',
    namespace: 'donkey',
    subpath: 'notebook',
  })
  assert.equal(getOwnershipKeyFromServerName('apple.pear.com/donkey/notebook'), 'apple.pear.com::donkey')

  delete process.env.AUTHORITY_ALLOWED_ORIGINS
})

test('routing-service supports origin subdomain namespaces when AUTHORITY_ALLOWED_ORIGINS is set', () => {
  process.env.AUTHORITY_ALLOWED_ORIGINS = 'apple.pear.com,browservable.com'

  const parsed = parseServerNameScope('notes.donkey.apple.pear.com')
  assert.deepEqual(parsed, {
    origin: 'apple.pear.com',
    namespace: 'donkey',
    subpath: 'notes',
  })
  assert.equal(getNamespaceFromServerName('donkey.apple.pear.com'), 'donkey')
  assert.equal(getSubpathFromServerName('notes.donkey.apple.pear.com'), 'notes')

  delete process.env.AUTHORITY_ALLOWED_ORIGINS
})

test('routing-service always reserves api namespace', () => {
  assert.equal(isNamespaceReserved('api'), true)
  assert.equal(isNamespaceReserved('API'), true)
})

test('routing-service supports env-configured disallowed namespace globs', () => {
  process.env.AUTHORITY_DISALLOWED_NAMESPACE_GLOBS = 'admin-*,*-internal,exactname'

  assert.equal(isNamespaceReserved('admin-core'), true)
  assert.equal(isNamespaceReserved('my-internal'), true)
  assert.equal(isNamespaceReserved('exactname'), true)
  assert.equal(isNamespaceReserved('public-name'), false)

  delete process.env.AUTHORITY_DISALLOWED_NAMESPACE_GLOBS
})

