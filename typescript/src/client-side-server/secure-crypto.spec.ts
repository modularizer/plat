import {
  choosePaddingBucket,
  decryptJsonAead,
  deriveAeadKeyFromX25519,
  encryptJsonAead,
  generateEphemeralX25519KeyPair,
  importX25519PublicKeyJwk,
  padCiphertext,
  randomNonce12,
  unpadCiphertext,
  utf8,
} from './secure-crypto'

describe('client-side-server secure crypto', () => {
  it('derives matching shared AEAD keys on both sides', async () => {
    const alice = await generateEphemeralX25519KeyPair()
    const bob = await generateEphemeralX25519KeyPair()
    const alicePeer = await importX25519PublicKeyJwk(bob.publicKeyJwk)
    const bobPeer = await importX25519PublicKeyJwk(alice.publicKeyJwk)
    const info = utf8('plat-css-sealed-signaling-v1')

    const aliceKey = await deriveAeadKeyFromX25519(alice.privateKey, alicePeer, info)
    const bobKey = await deriveAeadKeyFromX25519(bob.privateKey, bobPeer, info)
    const aad = utf8('{"platcss":"sealed"}')
    const nonce = randomNonce12()
    const plaintext = { hello: 'world', n: 1 }

    const ciphertext = await encryptJsonAead(aliceKey, plaintext, aad, nonce)
    const roundTrip = await decryptJsonAead<typeof plaintext>(bobKey, ciphertext, aad, nonce)

    expect(roundTrip).toEqual(plaintext)
  })

  it('fails decryption with bad AAD', async () => {
    const alice = await generateEphemeralX25519KeyPair()
    const bob = await generateEphemeralX25519KeyPair()
    const alicePeer = await importX25519PublicKeyJwk(bob.publicKeyJwk)
    const bobPeer = await importX25519PublicKeyJwk(alice.publicKeyJwk)
    const info = utf8('plat-css-sealed-signaling-v1')
    const aliceKey = await deriveAeadKeyFromX25519(alice.privateKey, alicePeer, info)
    const bobKey = await deriveAeadKeyFromX25519(bob.privateKey, bobPeer, info)
    const nonce = randomNonce12()

    const ciphertext = await encryptJsonAead(aliceKey, { ok: true }, utf8('good-aad'), nonce)

    await expect(decryptJsonAead(bobKey, ciphertext, utf8('bad-aad'), nonce)).rejects.toThrow()
  })

  it('pads and unpads ciphertext round-trip', () => {
    const ciphertext = Uint8Array.from([1, 2, 3, 4, 5])
    const bucket = choosePaddingBucket(ciphertext.byteLength)
    const padded = padCiphertext(ciphertext, bucket)

    expect(padded.byteLength).toBe(1024)
    expect(Array.from(unpadCiphertext(padded))).toEqual(Array.from(ciphertext))
  })

  it('throws for oversized ciphertext', () => {
    expect(() => choosePaddingBucket(65537)).toThrow(/exceeds the maximum sealed signaling size/i)
  })
})

