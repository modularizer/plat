import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BlockService,
  StrikeService,
  RateLimitService,
} from '../dist/index.js'

test('StrikeService escalates malformed traffic recommendations', async () => {
  const strikes = new StrikeService()

  const a = await strikes.recordMalformedRequest('ip:127.0.0.1')
  const b = await strikes.recordMalformedRequest('ip:127.0.0.1')
  const c = await strikes.recordMalformedRequest('ip:127.0.0.1')

  assert.equal(a.recommendedBanSeconds, undefined)
  assert.equal(b.recommendedBanSeconds, undefined)
  assert.equal(c.recommendedBanSeconds, 300)
})

test('BlockService stores and expires suppressions in memory fallback', async () => {
  const blocks = new BlockService()

  await blocks.suppressClient('team/alice/notebook', 'ip:127.0.0.1', 1, 'test')
  assert.equal(await blocks.isClientSuppressed('team/alice/notebook', 'ip:127.0.0.1'), true)

  await new Promise((resolve) => setTimeout(resolve, 1100))
  assert.equal(await blocks.isClientSuppressed('team/alice/notebook', 'ip:127.0.0.1'), false)
})

test('RateLimitService enforces per-window allowance', async () => {
  const rate = new RateLimitService({ connectLimitPerWindow: 2, bucketWindowMs: 5000 })

  const first = await rate.checkConnectAllowance('ip:127.0.0.1')
  const second = await rate.checkConnectAllowance('ip:127.0.0.1')
  const third = await rate.checkConnectAllowance('ip:127.0.0.1')

  assert.equal(first.allowed, true)
  assert.equal(second.allowed, true)
  assert.equal(third.allowed, false)
  assert.equal(typeof third.retryAfterMs, 'number')
})

