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

export interface ClientSideServerEncryptionKeyPair {
  algorithm: 'X25519'
  publicKeyJwk: JsonWebKey
  privateKeyJwk: JsonWebKey
  keyId: string
  createdAt: number
}

export interface ClientSideServerEncryptionPublicIdentity {
  algorithm: 'X25519'
  publicKeyJwk: JsonWebKey
  keyId: string
  fingerprint: string
  createdAt?: number
}

export interface ClientSideServerResolvedIdentityBundle {
  signing: ClientSideServerPublicIdentity
  encryption: ClientSideServerEncryptionPublicIdentity
}

export interface ClientSideServerTrustedServerRecord {
  serverName: string
  publicKeyJwk: JsonWebKey
  keyId?: string
  fingerprint: string
  trustedAt: number
  source: 'first-use' | 'authority' | 'manual'
}

export interface ClientSideServerTrustedServerRecordV2 {
  serverName: string
  signingPublicKeyJwk: JsonWebKey
  encryptionPublicKeyJwk: JsonWebKey
  signingKeyId?: string
  encryptionKeyId?: string
  signingFingerprint: string
  encryptionFingerprint: string
  trustedAt: number
  source: 'first-use' | 'authority' | 'manual'
}

export type ClientSideServerAnyTrustedServerRecord =
  | ClientSideServerTrustedServerRecord
  | ClientSideServerTrustedServerRecordV2

export interface ClientSideServerSignedAuthorityRecord {
  protocol: 'plat-css-authority-v1'
  serverName: string
  publicKeyJwk: JsonWebKey
  keyId?: string
  authorityName?: string
  issuedAt: number
  signature: string
}

export interface ClientSideServerSignedAuthorityRecordV2 {
  protocol: 'plat-css-authority-v2'
  serverName: string
  signingPublicKeyJwk: JsonWebKey
  encryptionPublicKeyJwk: JsonWebKey
  signingKeyId?: string
  encryptionKeyId?: string
  authorityName?: string
  issuedAt: number
  signature: string
}

export type ClientSideServerAnyAuthorityRecord =
  | ClientSideServerSignedAuthorityRecord
  | ClientSideServerSignedAuthorityRecordV2

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
  resolve(serverName: string): Promise<ClientSideServerAnyAuthorityRecord | null>
}

export interface StaticClientSideServerAuthorityRegistryOptions {
  authorityKeyPair: ClientSideServerExportedKeyPair
  authorityName?: string
  records?: Record<
    string,
    | JsonWebKey
    | ClientSideServerPublicIdentity
    | ClientSideServerTrustedServerRecord
    | ClientSideServerTrustedServerRecordV2
    | ClientSideServerResolvedIdentityBundle
  >
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
  knownHosts: Record<string, ClientSideServerAnyTrustedServerRecord | ClientSideServerAnyTrustedServerRecord[]>,
  record: ClientSideServerAnyTrustedServerRecord,
): void {
  const existing = knownHosts[record.serverName]
  if (!existing) {
    knownHosts[record.serverName] = record
    return
  }

  const list = Array.isArray(existing) ? existing : [existing]
  const idx = list.findIndex((r) => clientSideServerPublicKeysEqual(getSigningPublicKeyJwk(r), getSigningPublicKeyJwk(record)))
  if (idx >= 0) {
    list[idx] = record
  } else {
    list.push(record)
  }
  knownHosts[record.serverName] = list.length === 1 ? list[0]! : list
}

export function loadTrustedClientSideServerRecordFromMap(
  knownHosts: Record<string, ClientSideServerAnyTrustedServerRecord | ClientSideServerAnyTrustedServerRecord[]> | undefined,
  serverName: string,
): ClientSideServerAnyTrustedServerRecord | null {
  if (!knownHosts) return null
  const entry = knownHosts[serverName]
  if (!entry) return null
  return Array.isArray(entry) ? entry[0] ?? null : entry
}

export function loadAllTrustedClientSideServerRecordsForName(
  knownHosts: Record<string, ClientSideServerAnyTrustedServerRecord | ClientSideServerAnyTrustedServerRecord[]> | undefined,
  serverName: string,
): ClientSideServerAnyTrustedServerRecord[] {
  if (!knownHosts) return []
  const entry = knownHosts[serverName]
  if (!entry) return []
  return Array.isArray(entry) ? entry : [entry]
}

export function isTrustedPublicKeyForServer(
  knownHosts: Record<string, ClientSideServerAnyTrustedServerRecord | ClientSideServerAnyTrustedServerRecord[]> | undefined,
  serverName: string,
  publicKeyJwk: JsonWebKey,
): boolean {
  const records = loadAllTrustedClientSideServerRecordsForName(knownHosts, serverName)
  return records.some((r) => clientSideServerPublicKeysEqual(getSigningPublicKeyJwk(r), publicKeyJwk))
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

export async function generateClientSideServerEncryptionKeyPair(
  options: GenerateClientSideServerKeyPairOptions = {},
): Promise<ClientSideServerEncryptionKeyPair> {
  const subtle = await resolveSubtle()
  const keyPair = await subtle.generateKey(
    {
      name: 'X25519',
    },
    true,
    ['deriveKey', 'deriveBits'],
  )
  const publicKeyJwk = await subtle.exportKey('jwk', keyPair.publicKey)
  const privateKeyJwk = await subtle.exportKey('jwk', keyPair.privateKey)
  return {
    algorithm: 'X25519',
    publicKeyJwk,
    privateKeyJwk,
    keyId: options.keyId ?? await createClientSideServerEncryptionKeyId(publicKeyJwk),
    createdAt: Date.now(),
  }
}

export async function createClientSideServerEncryptionKeyId(publicKeyJwk: JsonWebKey): Promise<string> {
  const fingerprint = await getClientSideServerEncryptionPublicKeyFingerprint(publicKeyJwk)
  return `csse-${fingerprint.slice(0, 16)}`
}

export async function getClientSideServerPublicKeyFingerprint(publicKeyJwk: JsonWebKey): Promise<string> {
  const subtle = await resolveSubtle()
  const digest = await subtle.digest('SHA-256', toBufferSource(encodeUtf8(stableStringify(publicKeyJwk))))
  return base64UrlEncode(new Uint8Array(digest))
}

export async function getClientSideServerEncryptionPublicKeyFingerprint(publicKeyJwk: JsonWebKey): Promise<string> {
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

export async function createSignedClientSideServerAuthorityRecordV2(
  authorityKeyPair: ClientSideServerExportedKeyPair,
  input: {
    serverName: string
    signingPublicKeyJwk: JsonWebKey
    encryptionPublicKeyJwk: JsonWebKey
    signingKeyId?: string
    encryptionKeyId?: string
    authorityName?: string
    issuedAt?: number
  },
): Promise<ClientSideServerSignedAuthorityRecordV2> {
  const payload = {
    protocol: 'plat-css-authority-v2' as const,
    serverName: input.serverName,
    signingPublicKeyJwk: input.signingPublicKeyJwk,
    encryptionPublicKeyJwk: input.encryptionPublicKeyJwk,
    signingKeyId: input.signingKeyId,
    encryptionKeyId: input.encryptionKeyId,
    authorityName: input.authorityName,
    issuedAt: input.issuedAt ?? Date.now(),
  }
  const signature = await signClientSideServerChallenge(authorityKeyPair, stableStringify(payload))
  return {
    ...payload,
    signature,
  }
}

export async function verifySignedClientSideServerAuthorityRecordV2(
  record: ClientSideServerSignedAuthorityRecordV2,
  authorityPublicKeyJwk: JsonWebKey,
): Promise<boolean> {
  const { signature, ...payload } = record
  if (payload.protocol !== 'plat-css-authority-v2') return false
  return verifyClientSideServerChallenge(authorityPublicKeyJwk, stableStringify(payload), signature)
}

export async function verifyAnySignedClientSideServerAuthorityRecord(
  record: ClientSideServerAnyAuthorityRecord,
  authorityPublicKeyJwk: JsonWebKey,
): Promise<boolean> {
  return isClientSideServerSignedAuthorityRecordV2(record)
    ? verifySignedClientSideServerAuthorityRecordV2(record, authorityPublicKeyJwk)
    : verifySignedClientSideServerAuthorityRecord(record, authorityPublicKeyJwk)
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

export async function toClientSideServerEncryptionPublicIdentity(
  keyPair: ClientSideServerEncryptionKeyPair,
): Promise<ClientSideServerEncryptionPublicIdentity> {
  return {
    algorithm: keyPair.algorithm,
    publicKeyJwk: keyPair.publicKeyJwk,
    keyId: keyPair.keyId,
    createdAt: keyPair.createdAt,
    fingerprint: await getClientSideServerEncryptionPublicKeyFingerprint(keyPair.publicKeyJwk),
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

export function saveClientSideServerEncryptionKeyPair(
  keyPair: ClientSideServerEncryptionKeyPair,
  options: ClientSideServerKeyPairStoreOptions = {},
): void {
  const storage = resolveStorage(options.storage)
  if (!storage) throw new Error('No storage available to save a client-side server encryption key pair')
  storage.setItem(options.storageKey ?? 'plat-css:enc-keypair', JSON.stringify(keyPair))
}

export function loadClientSideServerEncryptionKeyPair(
  options: ClientSideServerKeyPairStoreOptions = {},
): ClientSideServerEncryptionKeyPair | null {
  const storage = resolveStorage(options.storage)
  if (!storage) return null
  const raw = storage.getItem(options.storageKey ?? 'plat-css:enc-keypair')
  if (!raw) return null
  return JSON.parse(raw) as ClientSideServerEncryptionKeyPair
}

export async function getOrCreateClientSideServerEncryptionKeyPair(
  options: ClientSideServerKeyPairStoreOptions & GenerateClientSideServerKeyPairOptions = {},
): Promise<ClientSideServerEncryptionKeyPair> {
  const existing = loadClientSideServerEncryptionKeyPair(options)
  if (existing) return existing
  const created = await generateClientSideServerEncryptionKeyPair(options)
  const storage = resolveStorage(options.storage)
  if (storage) {
    storage.setItem(options.storageKey ?? 'plat-css:enc-keypair', JSON.stringify(created))
  }
  return created
}

export function saveTrustedClientSideServerRecord(
  record: ClientSideServerAnyTrustedServerRecord,
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
): ClientSideServerAnyTrustedServerRecord | null {
  const all = loadAllTrustedClientSideServerRecords(options)
  return all[serverName] ?? null
}

export function loadAllTrustedClientSideServerRecords(
  options: ClientSideServerKnownHostsStoreOptions = {},
): Record<string, ClientSideServerAnyTrustedServerRecord> {
  const storage = resolveStorage(options.storage)
  if (!storage) return {}
  const raw = storage.getItem(options.storageKey ?? 'plat-css:known-hosts')
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, ClientSideServerAnyTrustedServerRecord>
}

export function saveClientSideServerAuthorityRecord(
  record: ClientSideServerAnyAuthorityRecord,
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
): ClientSideServerAnyAuthorityRecord | null {
  const all = loadAllClientSideServerAuthorityRecords(options)
  return all[serverName] ?? null
}

export function loadAllClientSideServerAuthorityRecords(
  options: ClientSideServerAuthorityStoreOptions = {},
): Record<string, ClientSideServerAnyAuthorityRecord> {
  const storage = resolveStorage(options.storage)
  if (!storage) return {}
  const raw = storage.getItem(options.storageKey ?? 'plat-css:authority-records')
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, ClientSideServerAnyAuthorityRecord>
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
  record: ClientSideServerAnyAuthorityRecord,
  authorityPublicKeyJwk: JsonWebKey,
  options: ClientSideServerKnownHostsStoreOptions = {},
): Promise<ClientSideServerAnyTrustedServerRecord> {
  const valid = await verifyAnySignedClientSideServerAuthorityRecord(record, authorityPublicKeyJwk)
  if (!valid) {
    throw new Error(`Authority record for ${record.serverName} failed signature verification`)
  }
  const trusted: ClientSideServerAnyTrustedServerRecord = isClientSideServerSignedAuthorityRecordV2(record)
    ? {
        serverName: record.serverName,
        signingPublicKeyJwk: record.signingPublicKeyJwk,
        encryptionPublicKeyJwk: record.encryptionPublicKeyJwk,
        signingKeyId: record.signingKeyId,
        encryptionKeyId: record.encryptionKeyId,
        signingFingerprint: await getClientSideServerPublicKeyFingerprint(record.signingPublicKeyJwk),
        encryptionFingerprint: await getClientSideServerEncryptionPublicKeyFingerprint(record.encryptionPublicKeyJwk),
        trustedAt: Date.now(),
        source: 'authority',
      }
    : {
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
): (serverName: string) => Promise<ClientSideServerAnyTrustedServerRecord | null> {
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
  register(
    serverName: string,
    value:
      | JsonWebKey
      | ClientSideServerPublicIdentity
      | ClientSideServerTrustedServerRecord
      | ClientSideServerTrustedServerRecordV2
      | ClientSideServerResolvedIdentityBundle,
  ): void
  resolve(serverName: string): Promise<ClientSideServerAnyAuthorityRecord | null>
  createServer(): ClientSideServerAuthorityServer
} {
  const records = new Map<string, NormalizedAuthorityIdentityRecord>()
  for (const [serverName, value] of Object.entries(options.records ?? {})) {
    records.set(serverName, normalizeAuthorityIdentity(value))
  }
  return {
    register(serverName, value) {
      records.set(serverName, normalizeAuthorityIdentity(value))
    },
    async resolve(serverName) {
      const record = records.get(serverName)
      if (!record) return null
      return record.encryptionPublicKeyJwk
        ? createSignedClientSideServerAuthorityRecordV2(options.authorityKeyPair, {
            serverName,
            signingPublicKeyJwk: record.signingPublicKeyJwk,
            encryptionPublicKeyJwk: record.encryptionPublicKeyJwk,
            signingKeyId: record.signingKeyId,
            encryptionKeyId: record.encryptionKeyId,
            authorityName: options.authorityName,
          })
        : createSignedClientSideServerAuthorityRecord(options.authorityKeyPair, {
            serverName,
            publicKeyJwk: record.signingPublicKeyJwk,
            keyId: record.signingKeyId,
            authorityName: options.authorityName,
          })
    },
    createServer() {
      return {
        authorityName: options.authorityName,
        publicKeyJwk: options.authorityKeyPair.publicKeyJwk,
        resolve: async (serverName: string) => {
          const record = records.get(serverName)
          if (!record) return null
          return record.encryptionPublicKeyJwk
            ? createSignedClientSideServerAuthorityRecordV2(options.authorityKeyPair, {
                serverName,
                signingPublicKeyJwk: record.signingPublicKeyJwk,
                encryptionPublicKeyJwk: record.encryptionPublicKeyJwk,
                signingKeyId: record.signingKeyId,
                encryptionKeyId: record.encryptionKeyId,
                authorityName: options.authorityName,
              })
            : createSignedClientSideServerAuthorityRecord(options.authorityKeyPair, {
                serverName,
                publicKeyJwk: record.signingPublicKeyJwk,
                keyId: record.signingKeyId,
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
      const record = await response.json() as ClientSideServerAnyAuthorityRecord | null
      return record
    },
  }
}

export async function resolveTrustedClientSideServerFromAuthorities(
  serverName: string,
  authorityServers: ClientSideServerAuthorityServer[],
  options: ClientSideServerKnownHostsStoreOptions = {},
): Promise<ClientSideServerAnyTrustedServerRecord | null> {
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

export function isClientSideServerTrustedServerRecordV2(
  value: ClientSideServerAnyTrustedServerRecord | unknown,
): value is ClientSideServerTrustedServerRecordV2 {
  return Boolean(
    value
      && typeof value === 'object'
      && 'signingPublicKeyJwk' in value
      && 'encryptionPublicKeyJwk' in value,
  )
}

export function isClientSideServerSignedAuthorityRecordV2(
  value: ClientSideServerAnyAuthorityRecord | unknown,
): value is ClientSideServerSignedAuthorityRecordV2 {
  return Boolean(
    value
      && typeof value === 'object'
      && (value as ClientSideServerSignedAuthorityRecordV2).protocol === 'plat-css-authority-v2'
      && 'signingPublicKeyJwk' in value
      && 'encryptionPublicKeyJwk' in value,
  )
}

export async function trustedClientSideServerRecordToResolvedIdentityBundle(
  record: ClientSideServerAnyTrustedServerRecord,
): Promise<ClientSideServerResolvedIdentityBundle | null> {
  if (!isClientSideServerTrustedServerRecordV2(record)) return null
  return {
    signing: {
      algorithm: 'ECDSA-P256',
      publicKeyJwk: record.signingPublicKeyJwk,
      keyId: record.signingKeyId ?? await createClientSideServerKeyId(record.signingPublicKeyJwk),
      fingerprint: record.signingFingerprint,
    },
    encryption: {
      algorithm: 'X25519',
      publicKeyJwk: record.encryptionPublicKeyJwk,
      keyId: record.encryptionKeyId ?? await createClientSideServerEncryptionKeyId(record.encryptionPublicKeyJwk),
      fingerprint: record.encryptionFingerprint,
    },
  }
}

function resolveStorage(storage?: ClientSideServerStorageLike): ClientSideServerStorageLike | null {
  if (storage) return storage
  if (typeof localStorage !== 'undefined') return localStorage
  return null
}

function getSigningPublicKeyJwk(record: ClientSideServerAnyTrustedServerRecord): JsonWebKey {
  return isClientSideServerTrustedServerRecordV2(record) ? record.signingPublicKeyJwk : record.publicKeyJwk
}

interface NormalizedAuthorityIdentityRecord {
  signingPublicKeyJwk: JsonWebKey
  encryptionPublicKeyJwk?: JsonWebKey
  signingKeyId?: string
  encryptionKeyId?: string
}

function normalizeAuthorityIdentity(
  value:
    | JsonWebKey
    | ClientSideServerPublicIdentity
    | ClientSideServerTrustedServerRecord
    | ClientSideServerTrustedServerRecordV2
    | ClientSideServerResolvedIdentityBundle,
): NormalizedAuthorityIdentityRecord {
  if (isResolvedIdentityBundle(value)) {
    return {
      signingPublicKeyJwk: value.signing.publicKeyJwk,
      encryptionPublicKeyJwk: value.encryption.publicKeyJwk,
      signingKeyId: value.signing.keyId,
      encryptionKeyId: value.encryption.keyId,
    }
  }
  if (isClientSideServerTrustedServerRecordV2(value)) {
    return {
      signingPublicKeyJwk: value.signingPublicKeyJwk,
      encryptionPublicKeyJwk: value.encryptionPublicKeyJwk,
      signingKeyId: value.signingKeyId,
      encryptionKeyId: value.encryptionKeyId,
    }
  }
  if ('publicKeyJwk' in value) {
    return {
      signingPublicKeyJwk: value.publicKeyJwk,
      signingKeyId: 'keyId' in value ? value.keyId : undefined,
    }
  }
  return {
    signingPublicKeyJwk: value,
  }
}

function isResolvedIdentityBundle(value: unknown): value is ClientSideServerResolvedIdentityBundle {
  return Boolean(
    value
      && typeof value === 'object'
      && 'signing' in value
      && 'encryption' in value,
  )
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
