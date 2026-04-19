const HKDF_INFO = utf8('plat-css-sealed-signaling-v1');
const PADDING_BUCKETS = [1024, 4096, 16384, 65536];
export async function generateEphemeralX25519KeyPair() {
    const subtle = await resolveSubtle();
    const keyPair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveKey', 'deriveBits']);
    return {
        publicKeyJwk: await subtle.exportKey('jwk', keyPair.publicKey),
        privateKey: keyPair.privateKey,
    };
}
export async function importX25519PublicKeyJwk(publicKeyJwk) {
    const subtle = await resolveSubtle();
    return subtle.importKey('jwk', publicKeyJwk, { name: 'X25519' }, false, []);
}
export async function importX25519PrivateKeyJwk(privateKeyJwk) {
    const subtle = await resolveSubtle();
    return subtle.importKey('jwk', privateKeyJwk, { name: 'X25519' }, false, ['deriveKey', 'deriveBits']);
}
export async function deriveAeadKeyFromX25519(privateKey, publicKey, info) {
    const subtle = await resolveSubtle();
    const sharedSecret = await subtle.deriveBits({
        name: 'X25519',
        public: publicKey,
    }, privateKey, 256);
    const hkdfKey = await subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(),
        info: toArrayBuffer(info),
    }, hkdfKey, {
        name: 'AES-GCM',
        length: 256,
    }, false, ['encrypt', 'decrypt']);
}
export async function encryptJsonAead(key, plaintext, aad, nonce) {
    const subtle = await resolveSubtle();
    const encoded = utf8(stableJson(plaintext));
    const ciphertext = await subtle.encrypt({
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(aad),
    }, key, toArrayBuffer(encoded));
    return new Uint8Array(ciphertext);
}
export async function decryptJsonAead(key, ciphertext, aad, nonce) {
    const subtle = await resolveSubtle();
    const plaintext = await subtle.decrypt({
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(aad),
    }, key, toArrayBuffer(ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext));
}
export function randomNonce12() {
    const nonce = new Uint8Array(12);
    resolveCrypto().getRandomValues(nonce);
    return nonce;
}
export function encodeBase64Url(data) {
    const base64 = typeof Buffer !== 'undefined'
        ? Buffer.from(data).toString('base64')
        : bytesToBase64(data);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function decodeBase64Url(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(padded, 'base64'));
    }
    return base64ToBytes(padded);
}
export function utf8(data) {
    return new TextEncoder().encode(data);
}
export function stableJson(value) {
    return JSON.stringify(sortValue(value));
}
export function choosePaddingBucket(length) {
    const paddedLength = length + 4;
    for (const bucket of PADDING_BUCKETS) {
        if (paddedLength <= bucket)
            return bucket;
    }
    throw new Error(`Ciphertext length ${length} exceeds the maximum sealed signaling size`);
}
export function padCiphertext(ciphertext, bucketSize) {
    if (bucketSize < 4 || bucketSize < ciphertext.byteLength + 4) {
        throw new Error(`Padding bucket ${bucketSize} is too small for ciphertext length ${ciphertext.byteLength}`);
    }
    const padded = new Uint8Array(bucketSize);
    const view = new DataView(padded.buffer);
    view.setUint32(0, ciphertext.byteLength, false);
    padded.set(ciphertext, 4);
    return padded;
}
export function unpadCiphertext(padded) {
    if (padded.byteLength < 4) {
        throw new Error('Padded ciphertext is too short');
    }
    const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
    const ciphertextLength = view.getUint32(0, false);
    if (ciphertextLength > padded.byteLength - 4) {
        throw new Error('Padded ciphertext contains an invalid embedded length');
    }
    return padded.slice(4, 4 + ciphertextLength);
}
export async function computeSessionId(fields) {
    const subtle = await resolveSubtle();
    const digest = await subtle.digest('SHA-256', toArrayBuffer(utf8(stableJson(fields))));
    return encodeBase64Url(new Uint8Array(digest));
}
export async function createPlatSecureSessionKeys(fields) {
    return {
        aeadKey: await deriveAeadKeyFromX25519(fields.privateKey, fields.peerPublicKey, HKDF_INFO),
        sessionId: await computeSessionId({
            clientEphemeralPublicKeyJwk: fields.clientEphemeralPublicKeyJwk,
            serverEncryptionPublicKeyJwk: fields.serverEncryptionPublicKeyJwk,
            nonceB64u: fields.nonceB64u,
        }),
    };
}
function sortValue(value) {
    if (Array.isArray(value))
        return value.map(sortValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, sortValue(child)]));
    }
    return value;
}
function toArrayBuffer(value) {
    if (value instanceof ArrayBuffer)
        return value;
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}
function resolveCrypto() {
    if (globalThis.crypto)
        return globalThis.crypto;
    throw new Error('Web Crypto API is not available in this environment');
}
async function resolveSubtle() {
    if (globalThis.crypto?.subtle)
        return globalThis.crypto.subtle;
    throw new Error('Web Crypto subtle API is not available in this environment');
}
function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary);
}
function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}
//# sourceMappingURL=secure-crypto.js.map