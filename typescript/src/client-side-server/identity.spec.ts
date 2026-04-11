import {
  createSignedClientSideServerAuthorityRecordV2,
  generateClientSideServerEncryptionKeyPair,
  generateClientSideServerIdentityKeyPair,
  getClientSideServerEncryptionPublicKeyFingerprint,
  verifySignedClientSideServerAuthorityRecordV2,
} from './identity'

describe('client-side-server identity secure extensions', () => {
  it('generates an X25519 encryption keypair', async () => {
    const keyPair = await generateClientSideServerEncryptionKeyPair()

    expect(keyPair.algorithm).toBe('X25519')
    expect(keyPair.publicKeyJwk.kty).toBe('OKP')
    expect(keyPair.publicKeyJwk.crv).toBe('X25519')
    expect(typeof keyPair.keyId).toBe('string')
    expect(keyPair.createdAt).toBeGreaterThan(0)
  })

  it('produces a stable encryption fingerprint for the same public JWK', async () => {
    const keyPair = await generateClientSideServerEncryptionKeyPair()

    const first = await getClientSideServerEncryptionPublicKeyFingerprint(keyPair.publicKeyJwk)
    const second = await getClientSideServerEncryptionPublicKeyFingerprint({ ...keyPair.publicKeyJwk })

    expect(first).toBe(second)
  })

  it('signs and verifies authority v2 records', async () => {
    const authorityKeyPair = await generateClientSideServerIdentityKeyPair()
    const serverSigningKeyPair = await generateClientSideServerIdentityKeyPair()
    const serverEncryptionKeyPair = await generateClientSideServerEncryptionKeyPair()

    const record = await createSignedClientSideServerAuthorityRecordV2(authorityKeyPair, {
      serverName: 'alpha',
      signingPublicKeyJwk: serverSigningKeyPair.publicKeyJwk,
      encryptionPublicKeyJwk: serverEncryptionKeyPair.publicKeyJwk,
      signingKeyId: serverSigningKeyPair.keyId,
      encryptionKeyId: serverEncryptionKeyPair.keyId,
      authorityName: 'test-authority',
    })

    await expect(
      verifySignedClientSideServerAuthorityRecordV2(record, authorityKeyPair.publicKeyJwk),
    ).resolves.toBe(true)

    await expect(
      verifySignedClientSideServerAuthorityRecordV2(
        {
          ...record,
          serverName: 'beta',
        },
        authorityKeyPair.publicKeyJwk,
      ),
    ).resolves.toBe(false)
  })
})

