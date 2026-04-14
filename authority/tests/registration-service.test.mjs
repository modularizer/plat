import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AuthorityHostSession,
  InMemoryServerOwnershipService,
  RegistrationService,
} from '../dist/index.js'

test('RegistrationService accepts owned authority names and updates the session snapshot', async () => {
  const ownershipService = new InMemoryServerOwnershipService([
    ['team', 'google-sub-alice'],
  ])
  const registrationService = new RegistrationService({ ownershipService })
  const session = new AuthorityHostSession({
    hostSessionId: 'host-1',
    googleSub: 'google-sub-alice',
    connectedAt: 123,
  })

  const result = await registrationService.registerOnline(session, [
    { server_name: 'team/alice/notebook', auth_mode: 'public' },
  ])

  assert.equal(result.accepted.length, 1)
  assert.equal(result.rejected.length, 0)
  assert.deepEqual(result.snapshot.serverNames, ['team/alice/notebook'])
  assert.equal(result.snapshot.authModes['team/alice/notebook'], 'public')
})

test('RegistrationService rejects reserved dmz names, duplicates, and unowned names', async () => {
  const ownershipService = new InMemoryServerOwnershipService([
    ['team', 'google-sub-alice'],
    ['other', 'google-sub-bob'],
  ])
  const registrationService = new RegistrationService({ ownershipService })
  const session = new AuthorityHostSession({
    hostSessionId: 'host-2',
    googleSub: 'google-sub-alice',
  })

  const result = await registrationService.registerOnline(session, [
    { server_name: 'dmz/legacy-room', auth_mode: 'public' },
    { server_name: 'team/alice/notebook', auth_mode: 'public' },
    { server_name: 'team/alice/notebook', auth_mode: 'private' },
    { server_name: 'other/bob/notebook', auth_mode: 'public' },
  ])

  assert.equal(result.accepted.length, 1)
  assert.equal(result.rejected.length, 3)
  assert.deepEqual(
    result.rejected.map((item) => item.code).sort(),
    ['namespace_reserved', 'duplicate_server_name', 'server_not_owned'].sort(),
  )
  assert.deepEqual(result.snapshot.serverNames, ['team/alice/notebook'])
})

test('RegistrationService rejects always-reserved and glob-disallowed namespaces', async () => {
  process.env.AUTHORITY_DISALLOWED_NAMESPACE_GLOBS = 'blocked-*'

  const ownershipService = new InMemoryServerOwnershipService([
    ['api', 'google-sub-alice'],
    ['blocked-zone', 'google-sub-alice'],
  ])
  const registrationService = new RegistrationService({ ownershipService })
  const session = new AuthorityHostSession({
    hostSessionId: 'host-4',
    googleSub: 'google-sub-alice',
  })

  const result = await registrationService.registerOnline(session, [
    { server_name: 'api/service', auth_mode: 'public' },
    { server_name: 'blocked-zone/app', auth_mode: 'public' },
  ])

  assert.equal(result.accepted.length, 0)
  assert.equal(result.rejected.length, 2)
  assert.deepEqual(result.rejected.map((item) => item.code), ['namespace_reserved', 'namespace_reserved'])
  assert.deepEqual(result.snapshot.serverNames, [])

  delete process.env.AUTHORITY_DISALLOWED_NAMESPACE_GLOBS
})

test('RegistrationService registerOffline removes server names from the session', async () => {
  const ownershipService = new InMemoryServerOwnershipService([
    ['team', 'google-sub-alice'],
  ])
  const registrationService = new RegistrationService({ ownershipService })
  const session = new AuthorityHostSession({
    hostSessionId: 'host-3',
    googleSub: 'google-sub-alice',
  })

  await registrationService.registerOnline(session, [
    { server_name: 'team/alice/notebook', auth_mode: 'public' },
    { server_name: 'team/alice/whiteboard', auth_mode: 'private' },
  ])

  const snapshot = registrationService.registerOffline(session, ['team/alice/notebook'])

  assert.deepEqual(snapshot.serverNames, ['team/alice/whiteboard'])
  assert.equal(snapshot.authModes['team/alice/notebook'], undefined)
})
