export interface ClientSideServerStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem?(key: string): void;
}
export interface ClientSideServerExportedKeyPair {
    algorithm: 'ECDSA-P256';
    publicKeyJwk: JsonWebKey;
    privateKeyJwk: JsonWebKey;
    keyId: string;
    createdAt: number;
}
export interface ClientSideServerPublicIdentity {
    algorithm: 'ECDSA-P256';
    publicKeyJwk: JsonWebKey;
    keyId: string;
    fingerprint: string;
    createdAt?: number;
}
export interface ClientSideServerEncryptionKeyPair {
    algorithm: 'X25519';
    publicKeyJwk: JsonWebKey;
    privateKeyJwk: JsonWebKey;
    keyId: string;
    createdAt: number;
}
export interface ClientSideServerEncryptionPublicIdentity {
    algorithm: 'X25519';
    publicKeyJwk: JsonWebKey;
    keyId: string;
    fingerprint: string;
    createdAt?: number;
}
export interface ClientSideServerResolvedIdentityBundle {
    signing: ClientSideServerPublicIdentity;
    encryption: ClientSideServerEncryptionPublicIdentity;
}
export interface ClientSideServerTrustedServerRecord {
    serverName: string;
    publicKeyJwk: JsonWebKey;
    keyId?: string;
    fingerprint: string;
    trustedAt: number;
    source: 'first-use' | 'authority' | 'manual';
}
export interface ClientSideServerTrustedServerRecordV2 {
    serverName: string;
    signingPublicKeyJwk: JsonWebKey;
    encryptionPublicKeyJwk: JsonWebKey;
    signingKeyId?: string;
    encryptionKeyId?: string;
    signingFingerprint: string;
    encryptionFingerprint: string;
    trustedAt: number;
    source: 'first-use' | 'authority' | 'manual';
}
export type ClientSideServerAnyTrustedServerRecord = ClientSideServerTrustedServerRecord | ClientSideServerTrustedServerRecordV2;
export interface ClientSideServerSignedAuthorityRecord {
    protocol: 'plat-css-authority-v1';
    serverName: string;
    publicKeyJwk: JsonWebKey;
    keyId?: string;
    authorityName?: string;
    issuedAt: number;
    signature: string;
}
export interface ClientSideServerSignedAuthorityRecordV2 {
    protocol: 'plat-css-authority-v2';
    serverName: string;
    signingPublicKeyJwk: JsonWebKey;
    encryptionPublicKeyJwk: JsonWebKey;
    signingKeyId?: string;
    encryptionKeyId?: string;
    authorityName?: string;
    issuedAt: number;
    signature: string;
}
export type ClientSideServerAnyAuthorityRecord = ClientSideServerSignedAuthorityRecord | ClientSideServerSignedAuthorityRecordV2;
export interface GenerateClientSideServerKeyPairOptions {
    keyId?: string;
}
export interface ClientSideServerKnownHostsStoreOptions {
    storage?: ClientSideServerStorageLike;
    storageKey?: string;
}
export interface ClientSideServerKeyPairStoreOptions {
    storage?: ClientSideServerStorageLike;
    storageKey?: string;
}
export interface ClientSideServerAuthorityStoreOptions {
    storage?: ClientSideServerStorageLike;
    storageKey?: string;
}
export interface ClientSideServerAuthorityResolverOptions extends ClientSideServerAuthorityStoreOptions {
    authorityPublicKeyJwk: JsonWebKey;
    knownHostsStorage?: ClientSideServerStorageLike;
    knownHostsStorageKey?: string;
}
export interface ClientSideServerAuthorityServer {
    authorityName?: string;
    publicKeyJwk: JsonWebKey;
    resolve(serverName: string): Promise<ClientSideServerAnyAuthorityRecord | null>;
}
export interface StaticClientSideServerAuthorityRegistryOptions {
    authorityKeyPair: ClientSideServerExportedKeyPair;
    authorityName?: string;
    records?: Record<string, JsonWebKey | ClientSideServerPublicIdentity | ClientSideServerTrustedServerRecord | ClientSideServerTrustedServerRecordV2 | ClientSideServerResolvedIdentityBundle>;
}
export interface FetchClientSideServerAuthorityServerOptions {
    baseUrl: string;
    publicKeyJwk: JsonWebKey;
    authorityName?: string;
    resolvePath?: string;
    fetchImpl?: typeof fetch;
}
export declare function createInMemoryClientSideServerStorage(initial?: Record<string, string>): ClientSideServerStorageLike;
export declare function saveTrustedClientSideServerRecordToMap(knownHosts: Record<string, ClientSideServerAnyTrustedServerRecord | ClientSideServerAnyTrustedServerRecord[]>, record: ClientSideServerAnyTrustedServerRecord): void;
export declare function loadTrustedClientSideServerRecordFromMap(knownHosts: Record<string, ClientSideServerAnyTrustedServerRecord | ClientSideServerAnyTrustedServerRecord[]> | undefined, serverName: string): ClientSideServerAnyTrustedServerRecord | null;
export declare function loadAllTrustedClientSideServerRecordsForName(knownHosts: Record<string, ClientSideServerAnyTrustedServerRecord | ClientSideServerAnyTrustedServerRecord[]> | undefined, serverName: string): ClientSideServerAnyTrustedServerRecord[];
export declare function isTrustedPublicKeyForServer(knownHosts: Record<string, ClientSideServerAnyTrustedServerRecord | ClientSideServerAnyTrustedServerRecord[]> | undefined, serverName: string, publicKeyJwk: JsonWebKey): boolean;
export declare function generateClientSideServerIdentityKeyPair(options?: GenerateClientSideServerKeyPairOptions): Promise<ClientSideServerExportedKeyPair>;
export declare function createClientSideServerKeyId(publicKeyJwk: JsonWebKey): Promise<string>;
export declare function generateClientSideServerEncryptionKeyPair(options?: GenerateClientSideServerKeyPairOptions): Promise<ClientSideServerEncryptionKeyPair>;
export declare function createClientSideServerEncryptionKeyId(publicKeyJwk: JsonWebKey): Promise<string>;
export declare function getClientSideServerPublicKeyFingerprint(publicKeyJwk: JsonWebKey): Promise<string>;
export declare function getClientSideServerEncryptionPublicKeyFingerprint(publicKeyJwk: JsonWebKey): Promise<string>;
export declare function signClientSideServerChallenge(keyPair: ClientSideServerExportedKeyPair, challenge: string): Promise<string>;
export declare function verifyClientSideServerChallenge(publicKeyJwk: JsonWebKey, challenge: string, signature: string): Promise<boolean>;
export declare function buildClientSideServerIdentityChallenge(input: {
    serverName: string;
    connectionId: string;
    challengeNonce: string;
}): string;
export declare function createSignedClientSideServerAuthorityRecord(authorityKeyPair: ClientSideServerExportedKeyPair, input: {
    serverName: string;
    publicKeyJwk: JsonWebKey;
    keyId?: string;
    authorityName?: string;
    issuedAt?: number;
}): Promise<ClientSideServerSignedAuthorityRecord>;
export declare function verifySignedClientSideServerAuthorityRecord(record: ClientSideServerSignedAuthorityRecord, authorityPublicKeyJwk: JsonWebKey): Promise<boolean>;
export declare function createSignedClientSideServerAuthorityRecordV2(authorityKeyPair: ClientSideServerExportedKeyPair, input: {
    serverName: string;
    signingPublicKeyJwk: JsonWebKey;
    encryptionPublicKeyJwk: JsonWebKey;
    signingKeyId?: string;
    encryptionKeyId?: string;
    authorityName?: string;
    issuedAt?: number;
}): Promise<ClientSideServerSignedAuthorityRecordV2>;
export declare function verifySignedClientSideServerAuthorityRecordV2(record: ClientSideServerSignedAuthorityRecordV2, authorityPublicKeyJwk: JsonWebKey): Promise<boolean>;
export declare function verifyAnySignedClientSideServerAuthorityRecord(record: ClientSideServerAnyAuthorityRecord, authorityPublicKeyJwk: JsonWebKey): Promise<boolean>;
export declare function toClientSideServerPublicIdentity(keyPair: ClientSideServerExportedKeyPair): Promise<ClientSideServerPublicIdentity>;
export declare function toClientSideServerEncryptionPublicIdentity(keyPair: ClientSideServerEncryptionKeyPair): Promise<ClientSideServerEncryptionPublicIdentity>;
export declare function saveClientSideServerIdentityKeyPair(keyPair: ClientSideServerExportedKeyPair, options?: ClientSideServerKeyPairStoreOptions): void;
export declare function loadClientSideServerIdentityKeyPair(options?: ClientSideServerKeyPairStoreOptions): ClientSideServerExportedKeyPair | null;
export declare function getOrCreateClientSideServerIdentityKeyPair(options?: ClientSideServerKeyPairStoreOptions & GenerateClientSideServerKeyPairOptions): Promise<ClientSideServerExportedKeyPair>;
export declare function saveClientSideServerEncryptionKeyPair(keyPair: ClientSideServerEncryptionKeyPair, options?: ClientSideServerKeyPairStoreOptions): void;
export declare function loadClientSideServerEncryptionKeyPair(options?: ClientSideServerKeyPairStoreOptions): ClientSideServerEncryptionKeyPair | null;
export declare function getOrCreateClientSideServerEncryptionKeyPair(options?: ClientSideServerKeyPairStoreOptions & GenerateClientSideServerKeyPairOptions): Promise<ClientSideServerEncryptionKeyPair>;
export declare function saveTrustedClientSideServerRecord(record: ClientSideServerAnyTrustedServerRecord, options?: ClientSideServerKnownHostsStoreOptions): void;
export declare function loadTrustedClientSideServerRecord(serverName: string, options?: ClientSideServerKnownHostsStoreOptions): ClientSideServerAnyTrustedServerRecord | null;
export declare function loadAllTrustedClientSideServerRecords(options?: ClientSideServerKnownHostsStoreOptions): Record<string, ClientSideServerAnyTrustedServerRecord>;
export declare function saveClientSideServerAuthorityRecord(record: ClientSideServerAnyAuthorityRecord, options?: ClientSideServerAuthorityStoreOptions): void;
export declare function loadClientSideServerAuthorityRecord(serverName: string, options?: ClientSideServerAuthorityStoreOptions): ClientSideServerAnyAuthorityRecord | null;
export declare function loadAllClientSideServerAuthorityRecords(options?: ClientSideServerAuthorityStoreOptions): Record<string, ClientSideServerAnyAuthorityRecord>;
export declare function trustClientSideServerOnFirstUse(serverName: string, identity: ClientSideServerPublicIdentity, options?: ClientSideServerKnownHostsStoreOptions): Promise<ClientSideServerTrustedServerRecord>;
export declare function trustClientSideServerFromAuthorityRecord(record: ClientSideServerAnyAuthorityRecord, authorityPublicKeyJwk: JsonWebKey, options?: ClientSideServerKnownHostsStoreOptions): Promise<ClientSideServerAnyTrustedServerRecord>;
export declare function createClientSideServerAuthorityResolver(options: ClientSideServerAuthorityResolverOptions): (serverName: string) => Promise<ClientSideServerAnyTrustedServerRecord | null>;
export declare function createStaticClientSideServerAuthorityRegistry(options: StaticClientSideServerAuthorityRegistryOptions): {
    register(serverName: string, value: JsonWebKey | ClientSideServerPublicIdentity | ClientSideServerTrustedServerRecord | ClientSideServerTrustedServerRecordV2 | ClientSideServerResolvedIdentityBundle): void;
    resolve(serverName: string): Promise<ClientSideServerAnyAuthorityRecord | null>;
    createServer(): ClientSideServerAuthorityServer;
};
export declare function createFetchClientSideServerAuthorityServer(options: FetchClientSideServerAuthorityServerOptions): ClientSideServerAuthorityServer;
export declare function resolveTrustedClientSideServerFromAuthorities(serverName: string, authorityServers: ClientSideServerAuthorityServer[], options?: ClientSideServerKnownHostsStoreOptions): Promise<ClientSideServerAnyTrustedServerRecord | null>;
export declare function clientSideServerPublicKeysEqual(a: JsonWebKey, b: JsonWebKey): boolean;
export declare function isClientSideServerTrustedServerRecordV2(value: ClientSideServerAnyTrustedServerRecord | unknown): value is ClientSideServerTrustedServerRecordV2;
export declare function isClientSideServerSignedAuthorityRecordV2(value: ClientSideServerAnyAuthorityRecord | unknown): value is ClientSideServerSignedAuthorityRecordV2;
export declare function trustedClientSideServerRecordToResolvedIdentityBundle(record: ClientSideServerAnyTrustedServerRecord): Promise<ClientSideServerResolvedIdentityBundle | null>;
//# sourceMappingURL=identity.d.ts.map