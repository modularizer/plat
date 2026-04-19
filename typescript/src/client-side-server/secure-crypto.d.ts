export interface PlatSecureSessionKeys {
    aeadKey: CryptoKey;
    sessionId: string;
}
export interface PlatEphemeralKeyPair {
    publicKeyJwk: JsonWebKey;
    privateKey: CryptoKey;
}
export declare function generateEphemeralX25519KeyPair(): Promise<PlatEphemeralKeyPair>;
export declare function importX25519PublicKeyJwk(publicKeyJwk: JsonWebKey): Promise<CryptoKey>;
export declare function importX25519PrivateKeyJwk(privateKeyJwk: JsonWebKey): Promise<CryptoKey>;
export declare function deriveAeadKeyFromX25519(privateKey: CryptoKey, publicKey: CryptoKey, info: Uint8Array): Promise<CryptoKey>;
export declare function encryptJsonAead(key: CryptoKey, plaintext: unknown, aad: Uint8Array, nonce: Uint8Array): Promise<Uint8Array>;
export declare function decryptJsonAead<T>(key: CryptoKey, ciphertext: Uint8Array, aad: Uint8Array, nonce: Uint8Array): Promise<T>;
export declare function randomNonce12(): Uint8Array;
export declare function encodeBase64Url(data: Uint8Array): string;
export declare function decodeBase64Url(value: string): Uint8Array;
export declare function utf8(data: string): Uint8Array;
export declare function stableJson(value: unknown): string;
export declare function choosePaddingBucket(length: number): number;
export declare function padCiphertext(ciphertext: Uint8Array, bucketSize: number): Uint8Array;
export declare function unpadCiphertext(padded: Uint8Array): Uint8Array;
export declare function computeSessionId(fields: {
    clientEphemeralPublicKeyJwk: JsonWebKey;
    serverEncryptionPublicKeyJwk: JsonWebKey;
    nonceB64u: string;
}): Promise<string>;
export declare function createPlatSecureSessionKeys(fields: {
    privateKey: CryptoKey;
    peerPublicKey: CryptoKey;
    clientEphemeralPublicKeyJwk: JsonWebKey;
    serverEncryptionPublicKeyJwk: JsonWebKey;
    nonceB64u: string;
}): Promise<PlatSecureSessionKeys>;
//# sourceMappingURL=secure-crypto.d.ts.map