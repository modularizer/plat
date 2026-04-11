export interface PlatSecureSessionKeys {
  aeadKey: CryptoKey
  sessionId: string
}

export interface PlatEphemeralKeyPair {
  publicKeyJwk: JsonWebKey
  privateKey: CryptoKey
}

const HKDF_INFO = utf8('plat-css-sealed-signaling-v1')
const PADDING_BUCKETS = [1024, 4096, 16384, 65536] as const

export async function generateEphemeralX25519KeyPair(): Promise<PlatEphemeralKeyPair> {
  const subtle = await resolveSubtle()
  const keyPair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveKey', 'deriveBits']) as CryptoKeyPair
  return {
    publicKeyJwk: await subtle.exportKey('jwk', keyPair.publicKey),
    privateKey: keyPair.privateKey,
  }
}

export async function importX25519PublicKeyJwk(publicKeyJwk: JsonWebKey): Promise<CryptoKey> {
  const subtle = await resolveSubtle()
  return subtle.importKey('jwk', publicKeyJwk, { name: 'X25519' }, false, [])
}

export async function importX25519PrivateKeyJwk(privateKeyJwk: JsonWebKey): Promise<CryptoKey> {
  const subtle = await resolveSubtle()
  return subtle.importKey('jwk', privateKeyJwk, { name: 'X25519' }, false, ['deriveKey', 'deriveBits'])
}

export async function deriveAeadKeyFromX25519(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  info: Uint8Array,
): Promise<CryptoKey> {
  const subtle = await resolveSubtle()
  const sharedSecret = await subtle.deriveBits(
    {
      name: 'X25519',
      public: publicKey,
    } as any,
    privateKey,
    256,
  )
  const hkdfKey = await subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: toArrayBuffer(info),
    },
    hkdfKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJsonAead(
  key: CryptoKey,
  plaintext: unknown,
  aad: Uint8Array,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  const subtle = await resolveSubtle()
  const encoded = utf8(stableJson(plaintext))
  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(aad),
    },
    key,
    toArrayBuffer(encoded),
  )
  return new Uint8Array(ciphertext)
}

export async function decryptJsonAead<T>(
  key: CryptoKey,
  ciphertext: Uint8Array,
  aad: Uint8Array,
  nonce: Uint8Array,
): Promise<T> {
  const subtle = await resolveSubtle()
  const plaintext = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(aad),
    },
    key,
    toArrayBuffer(ciphertext),
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}

export function randomNonce12(): Uint8Array {
  const nonce = new Uint8Array(12)
  resolveCrypto().getRandomValues(nonce)
  return nonce
}

export function encodeBase64Url(data: Uint8Array): string {
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(data).toString('base64')
    : bytesToBase64(data)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'))
  }
  return base64ToBytes(padded)
}

export function utf8(data: string): Uint8Array {
  return new TextEncoder().encode(data)
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

export function choosePaddingBucket(length: number): number {
  const paddedLength = length + 4
  for (const bucket of PADDING_BUCKETS) {
    if (paddedLength <= bucket) return bucket
  }
  throw new Error(`Ciphertext length ${length} exceeds the maximum sealed signaling size`)
}

export function padCiphertext(ciphertext: Uint8Array, bucketSize: number): Uint8Array {
  if (bucketSize < 4 || bucketSize < ciphertext.byteLength + 4) {
    throw new Error(`Padding bucket ${bucketSize} is too small for ciphertext length ${ciphertext.byteLength}`)
  }
  const padded = new Uint8Array(bucketSize)
  const view = new DataView(padded.buffer)
  view.setUint32(0, ciphertext.byteLength, false)
  padded.set(ciphertext, 4)
  return padded
}

export function unpadCiphertext(padded: Uint8Array): Uint8Array {
  if (padded.byteLength < 4) {
    throw new Error('Padded ciphertext is too short')
  }
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength)
  const ciphertextLength = view.getUint32(0, false)
  if (ciphertextLength > padded.byteLength - 4) {
    throw new Error('Padded ciphertext contains an invalid embedded length')
  }
  return padded.slice(4, 4 + ciphertextLength)
}

export async function computeSessionId(fields: {
  clientEphemeralPublicKeyJwk: JsonWebKey
  serverEncryptionPublicKeyJwk: JsonWebKey
  nonceB64u: string
}): Promise<string> {
  const subtle = await resolveSubtle()
  const digest = await subtle.digest('SHA-256', toArrayBuffer(utf8(stableJson(fields))))
  return encodeBase64Url(new Uint8Array(digest))
}

export async function createPlatSecureSessionKeys(fields: {
  privateKey: CryptoKey
  peerPublicKey: CryptoKey
  clientEphemeralPublicKeyJwk: JsonWebKey
  serverEncryptionPublicKeyJwk: JsonWebKey
  nonceB64u: string
}): Promise<PlatSecureSessionKeys> {
  return {
    aeadKey: await deriveAeadKeyFromX25519(fields.privateKey, fields.peerPublicKey, HKDF_INFO),
    sessionId: await computeSessionId({
      clientEphemeralPublicKeyJwk: fields.clientEphemeralPublicKeyJwk,
      serverEncryptionPublicKeyJwk: fields.serverEncryptionPublicKeyJwk,
      nonceB64u: fields.nonceB64u,
    }),
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortValue(child)]),
    )
  }
  return value
}

function toArrayBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

function resolveCrypto(): Crypto {
  if (globalThis.crypto) return globalThis.crypto
  throw new Error('Web Crypto API is not available in this environment')
}

async function resolveSubtle(): Promise<SubtleCrypto> {
  if (globalThis.crypto?.subtle) return globalThis.crypto.subtle
  const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>
  const cryptoModule = await dynamicImport('node:crypto')
  if (cryptoModule.webcrypto) {
    if (!globalThis.crypto) {
      ;(globalThis as any).crypto = cryptoModule.webcrypto
    }
    return cryptoModule.webcrypto.subtle as SubtleCrypto
  }
  throw new Error('Web Crypto subtle API is not available in this environment')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

