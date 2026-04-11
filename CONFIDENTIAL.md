Yes — it should be refined before handoff.

Below is a **much more execution-ready rewrite** aimed at a mediocre, low-effort agent. It removes ambiguous choices, pins down exact module boundaries, gives exact TypeScript types, and tells the agent what **not** to change.

---

# PLAT Client-Side Server Secure Signaling Rewrite Spec

## Purpose

Add **confidential MQTT signaling** to the existing client-side-server implementation without replacing the current identity model or WebRTC data-channel model.

The current code already has:

* long-term **server signing identity** in `identity.ts`
* MQTT/WebRTC signaling and discovery in `mqtt-webrtc.ts`
* signaling/control message types in `protocol.ts`

The main problem is that signaling messages are currently readable by all MQTT subscribers.

The goal of this rewrite is:

1. Keep the existing **server identity trust model**
2. Keep the existing **WebRTC connection model**
3. Encrypt all MQTT signaling payloads so only the intended server/client can read them
4. Support an optional **single shared topic** mode (`plat`) so observers cannot tell which server is being targeted

---

# Existing code assumptions that must remain true

## Do not remove or redesign these

Do **not** redesign the existing server identity trust model in `identity.ts`.

Keep these concepts and functions:

* `ClientSideServerPublicIdentity`
* `ClientSideServerSignedAuthorityRecord`
* `buildClientSideServerIdentityChallenge()`
* `signClientSideServerChallenge()`
* `verifyClientSideServerChallenge()`
* `verifySignedClientSideServerAuthorityRecord()`
* trust-on-first-use logic
* authority resolution logic

These are still needed.

## Important distinction

After this rewrite:

* **ECDSA P-256 identity keys** remain the long-term **identity/signing keys**
* a new **X25519 encryption keypair** is added for **MQTT signaling confidentiality**

Do **not** try to use the existing ECDSA key for ECDH encryption. That is a bad shortcut. Use separate keys.

---

# Final security model

## Long-term server identity

Each server has two long-term keypairs:

### 1. Identity keypair

Used for:

* challenge signing
* TOFU
* authority records

Algorithm:

* `ECDSA-P256`

This already exists.

### 2. Encryption keypair

Used for:

* decrypting initial client MQTT signaling messages
* deriving shared secrets for MQTT signaling confidentiality

Algorithm:

* `X25519`

This is new.

## Trust Authority behavior

The trust authority must now bind `serverName` to:

* existing identity public key
* new encryption public key

The client uses the authority record to obtain both.

---

# Required file changes

## 1. `src/client-side-server/identity.ts`

### Keep existing types

Do not remove or rename current identity types.

### Add new types

Add:

```ts
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
```

### Extend existing public identity shape

Do **not** remove `ClientSideServerPublicIdentity`. Instead extend the authority-facing identity data with an optional encryption key field.

Add:

```ts
export interface ClientSideServerResolvedIdentityBundle {
  signing: ClientSideServerPublicIdentity
  encryption: ClientSideServerEncryptionPublicIdentity
}
```

### Extend trusted host records

Add encryption key info to the authority/trusted-host model.

Add:

```ts
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
```

Do **not** remove the old trusted-host record type yet. Support migration.

### Extend signed authority record

Add a new versioned authority record instead of mutating the old one in place.

Add:

```ts
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
```

### Add functions

Add these exact functions:

```ts
export async function generateClientSideServerEncryptionKeyPair(
  options?: { keyId?: string }
): Promise<ClientSideServerEncryptionKeyPair>

export async function createClientSideServerEncryptionKeyId(
  publicKeyJwk: JsonWebKey
): Promise<string>

export async function getClientSideServerEncryptionPublicKeyFingerprint(
  publicKeyJwk: JsonWebKey
): Promise<string>

export async function toClientSideServerEncryptionPublicIdentity(
  keyPair: ClientSideServerEncryptionKeyPair
): Promise<ClientSideServerEncryptionPublicIdentity>

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
  }
): Promise<ClientSideServerSignedAuthorityRecordV2>

export async function verifySignedClientSideServerAuthorityRecordV2(
  record: ClientSideServerSignedAuthorityRecordV2,
  authorityPublicKeyJwk: JsonWebKey
): Promise<boolean>
```

### Storage rules

Add storage helpers for encryption keypairs:

```ts
export function saveClientSideServerEncryptionKeyPair(...)
export function loadClientSideServerEncryptionKeyPair(...)
export async function getOrCreateClientSideServerEncryptionKeyPair(...)
```

Use storage key:

* `plat-css:enc-keypair:${serverName}`

Do not mix signing and encryption keypairs into one storage blob.

---

## 2. New file: `src/client-side-server/secure-crypto.ts`

Create this file. It must be a standalone module containing all low-level crypto.

Do not spread Web Crypto calls across multiple files.

### Export these exact helpers

```ts
export interface PlatSecureSessionKeys {
  aeadKey: CryptoKey
  sessionId: string
}

export interface PlatEphemeralKeyPair {
  publicKeyJwk: JsonWebKey
  privateKey: CryptoKey
}

export async function generateEphemeralX25519KeyPair(): Promise<PlatEphemeralKeyPair>

export async function importX25519PublicKeyJwk(publicKeyJwk: JsonWebKey): Promise<CryptoKey>

export async function importX25519PrivateKeyJwk(privateKeyJwk: JsonWebKey): Promise<CryptoKey>

export async function deriveAeadKeyFromX25519(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  info: Uint8Array
): Promise<CryptoKey>

export async function encryptJsonAead(
  key: CryptoKey,
  plaintext: unknown,
  aad: Uint8Array,
  nonce: Uint8Array
): Promise<Uint8Array>

export async function decryptJsonAead<T>(
  key: CryptoKey,
  ciphertext: Uint8Array,
  aad: Uint8Array,
  nonce: Uint8Array
): Promise<T>

export function randomNonce12(): Uint8Array

export function encodeBase64Url(data: Uint8Array): string
export function decodeBase64Url(value: string): Uint8Array

export function utf8(data: string): Uint8Array
export function stableJson(value: unknown): string

export function choosePaddingBucket(length: number): number
export function padCiphertext(ciphertext: Uint8Array, bucketSize: number): Uint8Array
export function unpadCiphertext(padded: Uint8Array): Uint8Array

export async function computeSessionId(fields: {
  clientEphemeralPublicKeyJwk: JsonWebKey
  serverEncryptionPublicKeyJwk: JsonWebKey
  nonceB64u: string
}): Promise<string>
```

### Exact crypto choices

Use these exact primitives:

* key agreement: `X25519`
* key derivation: `HKDF` with `SHA-256`
* content encryption: `AES-GCM`
* AEAD nonce length: `12 bytes`
* associated data: canonical UTF-8 JSON string of fixed outer header fields

Do not use:

* ECDSA for encryption
* custom KDFs
* raw XOR or custom stream ciphers

### Exact HKDF info string

Use:

```ts
utf8('plat-css-sealed-signaling-v1')
```

### Exact padding buckets

Use exactly:

* 1024
* 4096
* 16384
* 65536

If ciphertext length exceeds 65536, throw an error. Do not silently split in this first version.

---

## 3. `src/client-side-server/protocol.ts`

Do not delete the existing public message types yet. Add new types.

### Add new outer MQTT envelope

```ts
export interface ClientSideServerSealedEnvelope {
  platcss: 'sealed'
  version: 1
  senderId: string
  at: number
  nonce: string
  clientEphemeralPublicKeyJwk: JsonWebKey
  ciphertext: string
}
```

Notes:

* `nonce` is base64url of 12 bytes
* `ciphertext` is base64url of the padded encrypted bytes
* there is intentionally **no** `serverName` and **no** `targetId` in the outer envelope

### Add new inner encrypted payload union

```ts
export interface ClientSideServerSealedDiscoverPayload {
  type: 'discover'
  connectionId: string
  serverName: string
  challengeNonce?: string
  requirePrivateChallenge?: boolean
  clientIdentity?: ClientSideServerPublicIdentity
  auth?: {
    username: string
    password: string
  }
  at: number
}

export interface ClientSideServerSealedOfferPayload {
  type: 'offer'
  connectionId: string
  serverName: string
  description: RTCSessionDescriptionInit
  challengeNonce?: string
  requirePrivateChallenge?: boolean
  clientIdentity?: ClientSideServerPublicIdentity
  auth?: {
    username: string
    password: string
  }
  at: number
}

export interface ClientSideServerSealedAnswerPayload {
  type: 'answer'
  connectionId: string
  serverName: string
  description: RTCSessionDescriptionInit
  identity?: ClientSideServerPublicIdentity
  authorityRecord?: ClientSideServerSignedAuthorityRecord | ClientSideServerSignedAuthorityRecordV2
  challengeNonce?: string
  challengeSignature?: string
  at: number
}

export interface ClientSideServerSealedIcePayload {
  type: 'ice'
  connectionId: string
  serverName: string
  candidate: RTCIceCandidateInit
  at: number
}

export interface ClientSideServerSealedRejectPayload {
  type: 'reject'
  connectionId: string
  serverName: string
  reason:
    | 'auth-required'
    | 'auth-failed'
    | 'server-not-accepting'
    | 'bad-message'
    | 'timeout'
  at: number
}
```

Then add:

```ts
export type ClientSideServerSealedPayload =
  | ClientSideServerSealedDiscoverPayload
  | ClientSideServerSealedOfferPayload
  | ClientSideServerSealedAnswerPayload
  | ClientSideServerSealedIcePayload
  | ClientSideServerSealedRejectPayload
```

### Add validators

Add:

```ts
export function isClientSideServerSealedEnvelope(value: unknown): value is ClientSideServerSealedEnvelope
export function isClientSideServerSealedPayload(value: unknown): value is ClientSideServerSealedPayload
```

Do not use loose duck typing. Use explicit shape checks.

---

## 4. `src/client-side-server/mqtt-webrtc.ts`

This is the main file to change.

The goal is:

* keep old plaintext mode behind a flag
* add a new default-capable secure mode

### Extend options

Add to `ClientSideServerMQTTWebRTCOptions`:

```ts
secureSignaling?: boolean
anonymousRouting?: boolean
sealedTopic?: string
maxSealedMessageBytes?: number
replayWindowMs?: number
clockSkewToleranceMs?: number
serverEncryptionKeyPair?: ClientSideServerEncryptionKeyPair
```

Defaults:

* `secureSignaling: true`
* `anonymousRouting: true`
* `sealedTopic: 'plat'`
* `maxSealedMessageBytes: 65536`
* `replayWindowMs: 5 * 60_000`
* `clockSkewToleranceMs: 30_000`

### Server startup identity

`ClientSideServerMQTTWebRTCServer` currently only calls `ensureIdentity()` for signing identity.

Add a second method:

```ts
private encryptionKeyPair?: ClientSideServerEncryptionKeyPair
private encryptionPublicIdentity?: ClientSideServerEncryptionPublicIdentity

private async ensureEncryptionIdentity(): Promise<void>
```

This must:

* load from `options.serverEncryptionKeyPair`, else
* load from storage `plat-css:enc-keypair:${serverName}`, else
* generate and save

### Server publish topic

When `secureSignaling !== false` and `anonymousRouting !== false`, all signaling must use:

```ts
const topic = options.sealedTopic ?? 'plat'
```

Do not use per-server topic in sealed mode.

### Do not seal `announce` yet

Keep `announce` plaintext in v1 of this rewrite.

Reason:

* discovery and worker pool logic currently depends on announce fanout
* changing it too now would cause too much churn

So the rule is:

* keep `announce` plaintext for now
* seal `discover`, `offer`, `answer`, `ice`, and `reject`

This means anonymous routing only applies to the connection path, not to passive announce presence. That is acceptable for the first implementation.

### Exact behavior for sealed client connect

In `createClientSideServerMQTTWebRTCPeerSession()`:

1. Resolve server authority/trusted record
2. Obtain server encryption public key
3. Generate ephemeral X25519 client keypair
4. Create `connectionId`
5. Create inner payload of type `discover` or `offer`
6. Derive AEAD key from:

    * client ephemeral private key
    * server encryption public key
7. Serialize payload to canonical JSON
8. Encrypt
9. Pad
10. Publish `ClientSideServerSealedEnvelope` on `sealedTopic`

### Exact behavior for server inbound sealed message

In server `onMessage()`:

* first try parsing plaintext signaling message
* if that fails, try parsing `ClientSideServerSealedEnvelope`
* if it is a sealed envelope:

    1. import client ephemeral public key
    2. derive AEAD key using server encryption private key
    3. build AAD from outer fields:

       ```ts
       {
         platcss: 'sealed',
         version: 1,
         senderId,
         at,
         nonce,
         clientEphemeralPublicKeyJwk
       }
       ```
    4. decrypt
    5. unpad
    6. parse inner payload
    7. reject if replay or bad timestamp
    8. dispatch by inner payload `type`

### Replay protection

Add to server instance:

```ts
private readonly seenSealedNonces = new Map<string, number>()
```

On successful decrypt:

* compute session replay key = `${senderId}:${nonce}`
* if already seen inside replay window, ignore
* else store timestamp
* periodically prune old entries opportunistically

### Timestamp rules

Reject inner payload if:

```ts
Math.abs(Date.now() - payload.at) > clockSkewToleranceMs + replayWindowMs
```

Default values are above.

### Sealed response behavior

Server response messages (`answer`, `ice`, `reject`) must be encrypted back to the same client using:

* server long-term X25519 encryption private key
* client ephemeral X25519 public key from the incoming envelope

Do **not** generate a new server ephemeral key in v1. Keep server side simple.

That means the client can decrypt responses using:

* client ephemeral private key
* server long-term encryption public key

This is simpler and acceptable for the first implementation.

---

## 5. `src/client-side-server/signaling.ts`

Do not redesign address parsing.

But add support so a resolved server address can carry an authority-resolved encryption public key if already available.

If there is a typed resolver object already in use, add an optional field:

```ts
encryptionPublicKeyJwk?: JsonWebKey
```

Only add if it naturally fits existing code. Do not force a large redesign here.

---

# Exact state machine

A low-effort agent needs this spelled out.

## Client connection state machine

### State `idle`

No session exists.

### State `resolving-server`

Resolve trusted server record from:

* authority
* known hosts
* TOFU logic if enabled

Must result in:

* signing public key
* encryption public key

If not available, fail.

### State `creating-offer`

* create `RTCPeerConnection`
* create data channel
* create SDP offer
* gather initial ICE candidates
* create client ephemeral X25519 keypair

### State `sending-initial-sealed-message`

Build and publish sealed `offer` payload.

### State `waiting-for-answer`

Subscribe to MQTT messages on sealed topic.
For each incoming sealed envelope:

* derive response key
* try decrypt
* if decrypt fails, ignore
* if decrypt succeeds and `connectionId` mismatches, ignore
* if payload type is `reject`, fail
* if payload type is `answer`, accept answer and continue
* if payload type is `ice`, queue/add candidate

### State `verifying-server-identity`

If `challengeNonce` was used or `requirePrivateChallenge === true`:

* verify returned challenge signature against trusted server signing key
* fail if invalid

### State `connected`

WebRTC channel opens.

### State `closed`

Cleanup MQTT listeners and RTCPeerConnection.

---

## Server connection state machine

### State `listening`

Subscribed to:

* plaintext announce topic
* sealed topic

### State `received-sealed-envelope`

* parse outer envelope
* derive AEAD key
* decrypt inner payload
* replay/timestamp validation

### State `auth-check`

If auth required:

* verify credentials
* if invalid, publish sealed `reject`
* stop

### State `offer-processing`

If payload is `offer`:

* create RTCPeerConnection
* set remote description
* create answer
* publish sealed `answer`

### State `ice-processing`

If payload is `ice`:

* add or queue candidate

### State `connected`

Serve channel as before.

---

# Exact wire format rules

## Outer envelope serialization

The outer envelope is always JSON with fields in this exact logical order:

1. `platcss`
2. `version`
3. `senderId`
4. `at`
5. `nonce`
6. `clientEphemeralPublicKeyJwk`
7. `ciphertext`

Field order is not relied on by JSON parsers, but use this order when serializing in your own helper for consistency.

## AAD contents

AAD must be:

```ts
stableJson({
  platcss: 'sealed',
  version: 1,
  senderId: envelope.senderId,
  at: envelope.at,
  nonce: envelope.nonce,
  clientEphemeralPublicKeyJwk: envelope.clientEphemeralPublicKeyJwk,
})
```

UTF-8 encode that exact string.

## Payload serialization

Payload must be:

* canonical JSON string using stable key ordering
* UTF-8 encoded
* encrypted
* padded after encryption

## Padding rule

Use zero bytes for padding suffix.

Store original ciphertext length in the first 4 bytes of the padded blob as unsigned big-endian length.

So padded blob format is:

* bytes 0..3 = original ciphertext length
* bytes 4..(4+len-1) = ciphertext
* remaining bytes = zeros

This avoids ambiguity when unpadding.

---

# Discovery and announce behavior

This part needs to be conservative.

## Keep existing plaintext `announce`

Do not encrypt `announce` yet.

Existing discovery behavior is still allowed:

* clients can still discover available servers
* worker-pool ranking still works

## New sealed direct-connect mode

Once the client decides to connect to a specific server:

* subsequent `offer`, `answer`, `ice`, `reject` are sealed

## Optional future work

Do **not** implement now:

* sealed announce
* sealed worker ranking metadata
* opaque discovery fanout

That can come later.

---

# Backward compatibility plan

## Phase 1

Add new sealed signaling mode behind flags.

Behavior:

* if `secureSignaling === false`, preserve old behavior exactly
* if `secureSignaling !== false`, use sealed signaling for offer/answer/ice

## Phase 2

Make `secureSignaling` default `true`

## Phase 3

Potentially make `anonymousRouting` default `true`

Do not remove plaintext support in this task.

---

# Exact implementation order

This is the order the agent should work in.

## Step 1

Implement new encryption key types and helpers in `identity.ts`

Acceptance:

* can generate X25519 long-term server encryption keypair
* can export/import JWK
* can compute encryption key fingerprint

## Step 2

Implement `secure-crypto.ts`

Acceptance:

* can generate ephemeral X25519 keypair
* can derive same AEAD key on both sides
* can encrypt/decrypt JSON payloads round-trip
* can pad/unpad correctly

## Step 3

Add protocol types in `protocol.ts`

Acceptance:

* envelope and inner payload types compile
* runtime validators compile

## Step 4

Modify server startup in `mqtt-webrtc.ts`

Acceptance:

* server loads both signing identity and encryption identity
* no regression to existing announce behavior

## Step 5

Implement sealed inbound handling on server

Acceptance:

* server can receive sealed `offer`
* decrypt it
* create answer
* send sealed `answer`

## Step 6

Implement sealed outbound connect flow on client

Acceptance:

* client can connect using sealed `offer`
* client can decrypt sealed `answer`

## Step 7

Implement sealed ICE trickle both directions

Acceptance:

* ICE candidates are no longer plaintext in secure mode

## Step 8

Implement replay/timestamp checks

Acceptance:

* duplicate envelope is ignored
* stale envelope is ignored

## Step 9

Add auth/reject flow

Acceptance:

* restricted server can reject with sealed `reject`

## Step 10

Add tests

---

# Required tests

## Unit tests

### `identity.ts`

* generates X25519 encryption keypair
* fingerprint stable for same public JWK
* authority v2 record signs and verifies

### `secure-crypto.ts`

* X25519 shared secret derivation matches both sides
* AES-GCM round-trip works
* bad AAD fails decryption
* padding/unpadding round-trip works
* oversized ciphertext throws

### `protocol.ts`

* valid sealed envelope parses
* malformed sealed envelope rejected
* valid sealed payloads parse
* unknown payload type rejected

## Integration tests

### client/server secure offer-answer

* client sends sealed offer
* server sends sealed answer
* answer decrypts and sets remote description

### secure ICE

* trickle ICE messages are sealed and accepted

### replay

* same sealed envelope received twice
* second one ignored

### auth reject

* bad credentials in sealed payload
* server sends sealed reject
* client fails cleanly

### backward compatibility

* `secureSignaling: false` still uses old plaintext path

---

# Exact things the agent must not do

Do not do any of these:

1. Do not replace ECDSA identity keys with X25519
2. Do not remove TOFU or authority verification
3. Do not change WebRTC data channel semantics
4. Do not encrypt `announce` messages in this task
5. Do not invent a custom crypto primitive
6. Do not put `serverName` in the outer sealed envelope
7. Do not silently ignore decryption failures without metrics/logging in debug mode
8. Do not remove plaintext compatibility mode

---

# Recommended logging

Add debug-only logging points:

* sealed envelope parse failed
* sealed decrypt failed
* sealed payload stale
* sealed payload replayed
* sealed payload accepted
* sealed reject sent
* secure answer sent
* secure ICE sent/received

Keep logs off by default or behind existing debug mechanisms.

---

# Acceptance criteria for the whole task

The task is complete when all of these are true:

1. Existing plaintext mode still works unchanged
2. Secure mode works with:

    * server long-term signing identity
    * server long-term X25519 encryption identity
    * client ephemeral X25519 session key
3. MQTT observers cannot read:

    * offers
    * answers
    * ICE candidates
    * auth payloads
4. In anonymous routing mode, the outer sealed envelope does not reveal `serverName`
5. Server identity verification still works using the existing signing challenge model
6. Integration tests pass for secure and plaintext modes

---

# Short implementation summary for the agent

If the agent needs the short version:

* Keep existing signing identity system
* Add a second long-term X25519 server encryption keypair
* Add `secure-crypto.ts`
* Add `ClientSideServerSealedEnvelope` and encrypted inner payload types
* In secure mode, keep plaintext `announce`, but encrypt `offer`, `answer`, `ice`, and `reject`
* Use client ephemeral X25519 + server long-term X25519 for MQTT signaling confidentiality
* Keep plaintext mode behind `secureSignaling: false`
* Add replay protection and tests

If you want, I can turn this into an even more literal **agent handoff checklist** with file-by-file subtasks and “copy this exact code skeleton” sections.
