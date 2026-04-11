import {
  isClientSideServerSealedEnvelope,
  isClientSideServerSealedPayload,
} from './protocol'

describe('client-side-server sealed protocol validators', () => {
  it('accepts a valid sealed envelope', () => {
    expect(isClientSideServerSealedEnvelope({
      platcss: 'sealed',
      version: 1,
      senderId: 'client:1',
      at: Date.now(),
      nonce: 'abc123',
      clientEphemeralPublicKeyJwk: {
        kty: 'OKP',
        crv: 'X25519',
        x: 'abc',
      },
      ciphertext: 'ciphertext',
    })).toBe(true)
  })

  it('rejects a malformed sealed envelope', () => {
    expect(isClientSideServerSealedEnvelope({
      platcss: 'sealed',
      version: 2,
      senderId: 'client:1',
      nonce: 'abc123',
      ciphertext: 'ciphertext',
    })).toBe(false)
  })

  it('accepts valid sealed payload variants', () => {
    expect(isClientSideServerSealedPayload({
      type: 'offer',
      connectionId: 'conn-1',
      serverName: 'demo',
      description: { type: 'offer', sdp: 'v=0' },
      at: Date.now(),
    })).toBe(true)

    expect(isClientSideServerSealedPayload({
      type: 'reject',
      connectionId: 'conn-1',
      serverName: 'demo',
      reason: 'bad-message',
      at: Date.now(),
    })).toBe(true)
  })

  it('rejects unknown payload types', () => {
    expect(isClientSideServerSealedPayload({
      type: 'mystery',
      connectionId: 'conn-1',
      serverName: 'demo',
      at: Date.now(),
    })).toBe(false)
  })
})

