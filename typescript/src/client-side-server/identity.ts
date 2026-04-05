export interface ClientSideServerStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface ClientSideServerExportedKeyPair {
  algorithm: 'ECDSA-P256'
  publicKeyJwk: JsonWebKey
  privateKeyJwk: JsonWebKey
  keyId: string
  createdAt: number
}

export interface ClientSideServerPublicIdentity {
  algorithm: 'ECDSA-P256'
  publicKeyJwk: JsonWebKey
  keyId: string
  fingerprint: string
  createdAt?: number
}

export interface ClientSideServerTrustedServerRecord {
  serverName: string
  publicKeyJwk: JsonWebKey
  keyId?: string
  fingerprint: string
  trustedAt: number
  source: 'first-use' | 'authority' | 'manual'
}

export interface ClientSideServerSignedAuthorityRecord {
  protocol: 'plat-css-authority-v1'
  serverName: string
  publicKeyJwk: JsonWebKey
  keyId?: string
  authorityName?: string
  issuedAt: number
  signature: string
}

export interface GenerateClientSideServerKeyPairOptions {
  keyId?: string
}

export interface ClientSideServerKnownHostsStoreOptions {
  storage?: ClientSideServerStorageLike
  storageKey?: string
}

export interface ClientSideServerKeyPairStoreOptions {
  storage?: ClientSideServerStorageLike
  storageKey?: string
}

export interface ClientSideServerAuthorityStoreOptions {
  storage?: ClientSideServerStorageLike
  storageKey?: string
}

export interface ClientSideServerAuthorityResolverOptions extends ClientSideServerAuthorityStoreOptions {
  authorityPublicKeyJwk: JsonWebKey
  knownHostsStorage?: ClientSideServerStorageLike
  knownHostsStorageKey?: string
}

export interface ClientSideServerAuthorityServer {
  authorityName?: string
  publicKeyJwk: JsonWebKey
  resolve(serverName: string): Promise<ClientSideServerSignedAuthorityRecord | null>
}

export interface StaticClientSideServerAuthorityRegistryOptions {
  authorityKeyPair: ClientSideServerExportedKeyPair
  authorityName?: string
  records?: Record<string, JsonWebKey | ClientSideServerPublicIdentity | ClientSideServerTrustedServerRecord>
}

export interface FetchClientSideServerAuthorityServerOptions {
  baseUrl: string
  publicKeyJwk: JsonWebKey
  authorityName?: string
  resolvePath?: string
  fetchImpl?: typeof fetch
}

export function createInMemoryClientSideServerStorage(
  initial: Record<string, string> = {},
): ClientSideServerStorageLike {
  const store = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key, value) {
      store.set(key, value)
    },
    removeItem(key) {
      store.delete(key)
    },
  }
}

export function saveTrustedClientSideServerRecordToMap(
  knownHosts: Record<string, ClientSideServerTrustedServerRecord>,
  record: ClientSideServerTrustedServerRecord,
): void {
  knownHosts[record.serverName] = record
}

export function loadTrustedClientSideServerRecordFromMap(
  knownHosts: Record<string, ClientSideServerTrustedServerRecord> | undefined,
  serverName: string,
): ClientSideServerTrustedServerRecord | null {
  if (!knownHosts) return null
  return knownHosts[serverName] ?? null
}

export async function generateClientSideServerIdentityKeyPair(
  options: GenerateClientSideServerKeyPairOptions = {},
): Promise<ClientSideServerExportedKeyPair> {
  const subtle = await resolveSubtle()
  const keyPair = await subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify'],
  )
  const publicKeyJwk = await subtle.exportKey('jwk', keyPair.publicKey)
  const privateKeyJwk = await subtle.exportKey('jwk', keyPair.privateKey)
  return {
    algorithm: 'ECDSA-P256',
    publicKeyJwk,
    privateKeyJwk,
    keyId: options.keyId ?? await createClientSideServerKeyId(publicKeyJwk),
    createdAt: Date.now(),
  }
}

export async function createClientSideServerKeyId(publicKeyJwk: JsonWebKey): Promise<string> {
  const fingerprint = await getClientSideServerPublicKeyFingerprint(publicKeyJwk)
  return `cssk-${fingerprint.slice(0, 16)}`
}

export async function getClientSideServerPublicKeyFingerprint(publicKeyJwk: JsonWebKey): Promise<string> {
  const subtle = await resolveSubtle()
  const digest = await subtle.digest('SHA-256', toBufferSource(encodeUtf8(stableStringify(publicKeyJwk))))
  return base64UrlEncode(new Uint8Array(digest))
}

export async function signClientSideServerChallenge(
  keyPair: ClientSideServerExportedKeyPair,
  challenge: string,
): Promise<string> {
  const subtle = await resolveSubtle()
  const privateKey = await subtle.importKey(
    'jwk',
    keyPair.privateKeyJwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false,
    ['sign'],
  )
  const signature = await subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    privateKey,
    toBufferSource(encodeUtf8(challenge)),
  )
  return base64UrlEncode(new Uint8Array(signature))
}

export async function verifyClientSideServerChallenge(
  publicKeyJwk: JsonWebKey,
  challenge: string,
  signature: string,
): Promise<boolean> {
  const subtle = await resolveSubtle()
  const publicKey = await subtle.importKey(
    'jwk',
    publicKeyJwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false,
    ['verify'],
  )
  return subtle.verify(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    publicKey,
    base64UrlDecode(signature),
    toBufferSource(encodeUtf8(challenge)),
  )
}

export function buildClientSideServerIdentityChallenge(input: {
  serverName: string
  connectionId: string
  challengeNonce: string
}): string {
  return `plat-css-identity-v1:${input.serverName}:${input.connectionId}:${input.challengeNonce}`
}

export async function createSignedClientSideServerAuthorityRecord(
  authorityKeyPair: ClientSideServerExportedKeyPair,
  input: {
    serverName: string
    publicKeyJwk: JsonWebKey
    keyId?: string
    authorityName?: string
    issuedAt?: number
  },
): Promise<ClientSideServerSignedAuthorityRecord> {
  const payload = {
    protocol: 'plat-css-authority-v1' as const,
    serverName: input.serverName,
    publicKeyJwk: input.publicKeyJwk,
    keyId: input.keyId,
    authorityName: input.authorityName,
    issuedAt: input.issuedAt ?? Date.now(),
  }
  const signature = await signClientSideServerChallenge(authorityKeyPair, stableStringify(payload))
  return {
    ...payload,
    signature,
  }
}

export async function verifySignedClientSideServerAuthorityRecord(
  record: ClientSideServerSignedAuthorityRecord,
  authorityPublicKeyJwk: JsonWebKey,
): Promise<boolean> {
  const { signature, ...payload } = record
  if (payload.protocol !== 'plat-css-authority-v1') return false
  return verifyClientSideServerChallenge(authorityPublicKeyJwk, stableStringify(payload), signature)
}

export async function toClientSideServerPublicIdentity(
  keyPair: ClientSideServerExportedKeyPair,
): Promise<ClientSideServerPublicIdentity> {
  return {
    algorithm: keyPair.algorithm,
    publicKeyJwk: keyPair.publicKeyJwk,
    keyId: keyPair.keyId,
    createdAt: keyPair.createdAt,
    fingerprint: await getClientSideServerPublicKeyFingerprint(keyPair.publicKeyJwk),
  }
}

export function saveClientSideServerIdentityKeyPair(
  keyPair: ClientSideServerExportedKeyPair,
  options: ClientSideServerKeyPairStoreOptions = {},
): void {
  const storage = resolveStorage(options.storage)
  if (!storage) throw new Error('No storage available to save a client-side server key pair')
  storage.setItem(options.storageKey ?? 'plat-css:keypair', JSON.stringify(keyPair))
}

export function loadClientSideServerIdentityKeyPair(
  options: ClientSideServerKeyPairStoreOptions = {},
): ClientSideServerExportedKeyPair | null {
  const storage = resolveStorage(options.storage)
  if (!storage) return null
  const raw = storage.getItem(options.storageKey ?? 'plat-css:keypair')
  if (!raw) return null
  return JSON.parse(raw) as ClientSideServerExportedKeyPair
}

export async function getOrCreateClientSideServerIdentityKeyPair(
  options: ClientSideServerKeyPairStoreOptions & GenerateClientSideServerKeyPairOptions = {},
): Promise<ClientSideServerExportedKeyPair> {
  const existing = loadClientSideServerIdentityKeyPair(options)
  if (existing) return existing
  const created = await generateClientSideServerIdentityKeyPair(options)
  const storage = resolveStorage(options.storage)
  if (storage) {
    storage.setItem(options.storageKey ?? 'plat-css:keypair', JSON.stringify(created))
  }
  return created
}

export function saveTrustedClientSideServerRecord(
  record: ClientSideServerTrustedServerRecord,
  options: ClientSideServerKnownHostsStoreOptions = {},
): void {
  const storage = resolveStorage(options.storage)
  if (!storage) throw new Error('No storage available to save a trusted client-side server record')
  const all = loadAllTrustedClientSideServerRecords(options)
  all[record.serverName] = record
  storage.setItem(options.storageKey ?? 'plat-css:known-hosts', JSON.stringify(all))
}

export function loadTrustedClientSideServerRecord(
  serverName: string,
  options: ClientSideServerKnownHostsStoreOptions = {},
): ClientSideServerTrustedServerRecord | null {
  const all = loadAllTrustedClientSideServerRecords(options)
  return all[serverName] ?? null
}

export function loadAllTrustedClientSideServerRecords(
  options: ClientSideServerKnownHostsStoreOptions = {},
): Record<string, ClientSideServerTrustedServerRecord> {
  const storage = resolveStorage(options.storage)
  if (!storage) return {}
  const raw = storage.getItem(options.storageKey ?? 'plat-css:known-hosts')
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, ClientSideServerTrustedServerRecord>
}

export function saveClientSideServerAuthorityRecord(
  record: ClientSideServerSignedAuthorityRecord,
  options: ClientSideServerAuthorityStoreOptions = {},
): void {
  const storage = resolveStorage(options.storage)
  if (!storage) throw new Error('No storage available to save a client-side server authority record')
  const all = loadAllClientSideServerAuthorityRecords(options)
  all[record.serverName] = record
  storage.setItem(options.storageKey ?? 'plat-css:authority-records', JSON.stringify(all))
}

export function loadClientSideServerAuthorityRecord(
  serverName: string,
  options: ClientSideServerAuthorityStoreOptions = {},
): ClientSideServerSignedAuthorityRecord | null {
  const all = loadAllClientSideServerAuthorityRecords(options)
  return all[serverName] ?? null
}

export function loadAllClientSideServerAuthorityRecords(
  options: ClientSideServerAuthorityStoreOptions = {},
): Record<string, ClientSideServerSignedAuthorityRecord> {
  const storage = resolveStorage(options.storage)
  if (!storage) return {}
  const raw = storage.getItem(options.storageKey ?? 'plat-css:authority-records')
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, ClientSideServerSignedAuthorityRecord>
}

export async function trustClientSideServerOnFirstUse(
  serverName: string,
  identity: ClientSideServerPublicIdentity,
  options: ClientSideServerKnownHostsStoreOptions = {},
): Promise<ClientSideServerTrustedServerRecord> {
  const record: ClientSideServerTrustedServerRecord = {
    serverName,
    publicKeyJwk: identity.publicKeyJwk,
    keyId: identity.keyId,
    fingerprint: identity.fingerprint,
    trustedAt: Date.now(),
    source: 'first-use',
  }
  saveTrustedClientSideServerRecord(record, options)
  return record
}

export async function trustClientSideServerFromAuthorityRecord(
  record: ClientSideServerSignedAuthorityRecord,
  authorityPublicKeyJwk: JsonWebKey,
  options: ClientSideServerKnownHostsStoreOptions = {},
): Promise<ClientSideServerTrustedServerRecord> {
  const valid = await verifySignedClientSideServerAuthorityRecord(record, authorityPublicKeyJwk)
  if (!valid) {
    throw new Error(`Authority record for ${record.serverName} failed signature verification`)
  }
  const trusted: ClientSideServerTrustedServerRecord = {
    serverName: record.serverName,
    publicKeyJwk: record.publicKeyJwk,
    keyId: record.keyId,
    fingerprint: await getClientSideServerPublicKeyFingerprint(record.publicKeyJwk),
    trustedAt: Date.now(),
    source: 'authority',
  }
  saveTrustedClientSideServerRecord(trusted, options)
  return trusted
}

export function createClientSideServerAuthorityResolver(
  options: ClientSideServerAuthorityResolverOptions,
): (serverName: string) => Promise<ClientSideServerTrustedServerRecord | null> {
  return async (serverName: string) => {
    const record = loadClientSideServerAuthorityRecord(serverName, options)
    if (!record) return null
    return trustClientSideServerFromAuthorityRecord(
      record,
      options.authorityPublicKeyJwk,
      {
        storage: options.knownHostsStorage,
        storageKey: options.knownHostsStorageKey,
      },
    )
  }
}

export function createStaticClientSideServerAuthorityRegistry(
  options: StaticClientSideServerAuthorityRegistryOptions,
): {
  register(serverName: string, value: JsonWebKey | ClientSideServerPublicIdentity | ClientSideServerTrustedServerRecord): void
  resolve(serverName: string): Promise<ClientSideServerSignedAuthorityRecord | null>
  createServer(): ClientSideServerAuthorityServer
} {
  const records = new Map<string, JsonWebKey>()
  for (const [serverName, value] of Object.entries(options.records ?? {})) {
    records.set(serverName, normalizePublicKey(value))
  }
  return {
    register(serverName, value) {
      records.set(serverName, normalizePublicKey(value))
    },
    async resolve(serverName) {
      const publicKeyJwk = records.get(serverName)
      if (!publicKeyJwk) return null
      return createSignedClientSideServerAuthorityRecord(options.authorityKeyPair, {
        serverName,
        publicKeyJwk,
        authorityName: options.authorityName,
      })
    },
    createServer() {
      return {
        authorityName: options.authorityName,
        publicKeyJwk: options.authorityKeyPair.publicKeyJwk,
        resolve: async (serverName: string) => {
          const publicKeyJwk = records.get(serverName)
          if (!publicKeyJwk) return null
          return createSignedClientSideServerAuthorityRecord(options.authorityKeyPair, {
            serverName,
            publicKeyJwk,
            authorityName: options.authorityName,
          })
        },
      }
    },
  }
}

export function createFetchClientSideServerAuthorityServer(
  options: FetchClientSideServerAuthorityServerOptions,
): ClientSideServerAuthorityServer {
  const fetchImpl = options.fetchImpl ?? fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to create a fetch-backed authority server')
  }
  return {
    authorityName: options.authorityName,
    publicKeyJwk: options.publicKeyJwk,
    async resolve(serverName: string) {
      const baseUrl = options.baseUrl.replace(/\/+$/, '')
      const resolvePath = (options.resolvePath ?? '/resolveAuthorityHost').replace(/^([^/])/, '/$1')
      const url = new URL(`${baseUrl}${resolvePath}`)
      url.searchParams.set('serverName', serverName)
      const response = await fetchImpl(url.toString(), {
        headers: {
          accept: 'application/json',
        },
      })
      if (!response.ok) {
        throw new Error(`Authority server ${baseUrl} returned ${response.status} ${response.statusText}`)
      }
      const record = await response.json() as ClientSideServerSignedAuthorityRecord | null
      return record
    },
  }
}

export async function resolveTrustedClientSideServerFromAuthorities(
  serverName: string,
  authorityServers: ClientSideServerAuthorityServer[],
  options: ClientSideServerKnownHostsStoreOptions = {},
): Promise<ClientSideServerTrustedServerRecord | null> {
  for (const authorityServer of authorityServers) {
    try {
      const record = await authorityServer.resolve(serverName)
      if (!record) continue
      return await trustClientSideServerFromAuthorityRecord(record, authorityServer.publicKeyJwk, options)
    } catch {
      continue
    }
  }
  return null
}

export function clientSideServerPublicKeysEqual(a: JsonWebKey, b: JsonWebKey): boolean {
  return stableStringify(a) === stableStringify(b)
}

function resolveStorage(storage?: ClientSideServerStorageLike): ClientSideServerStorageLike | null {
  if (storage) return storage
  if (typeof localStorage !== 'undefined') return localStorage
  return null
}

function normalizePublicKey(
  value: JsonWebKey | ClientSideServerPublicIdentity | ClientSideServerTrustedServerRecord,
): JsonWebKey {
  if ('publicKeyJwk' in value) return value.publicKeyJwk
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
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

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = typeof Buffer !== 'undefined'
    ? Buffer.from(bytes).toString('base64')
    : bytesToBase64(bytes)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'))
  }
  return base64ToBytes(padded)
}

async function resolveSubtle(): Promise<any> {
  if (globalThis.crypto?.subtle) return globalThis.crypto.subtle
  const cryptoModule = await import('node:crypto')
  if (cryptoModule.webcrypto?.subtle) return cryptoModule.webcrypto.subtle
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

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
