# SIGNALING

This document explains the **current** client-side-server signaling flow implemented in:

- `typescript/src/client-side-server/mqtt-webrtc.ts`
- `typescript/src/client-side-server/identity.ts`
- `typescript/src/client-side-server/protocol.ts`
- `typescript/src/client-side-server/signaling.ts`

It covers:

1. how many MQTT messages are exchanged
2. plaintext vs secure signaling
3. the public encryption-key bootstrap flow
4. what identity/trust checks happen
5. when WebRTC takes over and MQTT stops carrying app traffic

---

## Short answer: how many MQTT messages are there?

There are **two different secure-mode cases** now.

### 1. Secure connect when the client already knows the server encryption public key

Minimum MQTT messages:

- `offer`
- `answer`

So:

- **2 MQTT messages minimum**

Then add ICE trickle:

- **`2 + clientIceCount + serverIceCount`**

### 2. Secure connect when the client does _not_ already know the server encryption public key

The client now performs a **public bootstrap** first:

- `discover` bootstrap request
- `announce` bootstrap response
- sealed `offer`
- sealed `answer`

So:

- **4 MQTT messages minimum**

Then add ICE trickle:

- **`4 + clientIceCount + serverIceCount`**

### 3. Plaintext mode

When `secureSignaling: false`, the minimum is still:

- `offer`
- `answer`

So:

- **2 MQTT messages minimum**
- plus ICE if needed

### 4. Rejected connection

If the server rejects instead of answering:

- known-key secure path: **2 messages** (`offer` + `reject`)
- bootstrap secure path: **4 messages** (`discover` + `announce` + `offer` + `reject`)
- plaintext path: **2 messages** if reject exists in that flow

### 5. Discovery before connect

If you use worker discovery first, add:

- **1 client `discover`**
- **+ 1 plaintext `announce` from each matching server instance**

### 6. Background announces

Servers also publish presence announces:

- **1 announce on startup**
- **1 announce every `announceIntervalMs`**

These are outside any single connection attempt.

---

## Current signaling modes

### Plaintext mode

Enabled when:

- `secureSignaling: false`

MQTT carries:

- `announce`
- `discover`
- `offer`
- `answer`
- `ice`

### Secure mode

Enabled when:

- `secureSignaling !== false`

MQTT carries:

- plaintext `announce`
- plaintext bootstrap/discovery `discover`
- sealed `offer`
- sealed `answer`
- sealed `ice`
- sealed `reject`

In anonymous-routing mode, sealed messages go to:

- `options.sealedTopic ?? 'plat'`

The outer sealed envelope intentionally does **not** reveal `serverName`.

---

## MQTT topics

### Plaintext topic

Used for:

- `announce`
- `discover`
- encryption bootstrap request/response
- all signaling in plaintext mode

Topic:

- `options.mqttTopic`
- default: `mrtchat/plat-css`

### Sealed topic

Used in secure mode for:

- `offer`
- `answer`
- `ice`
- `reject`

Topic:

- `options.sealedTopic ?? 'plat'` when anonymous routing is enabled
- otherwise the plaintext topic

---

## End-to-end flow

## Phase 0: server startup

When `ClientSideServerMQTTWebRTCServer.start()` runs, the server:

1. ensures signing identity
2. ensures encryption identity when secure signaling is enabled
3. connects to MQTT
4. subscribes to plaintext topic
5. subscribes to sealed topic if different
6. publishes an initial plaintext `announce`
7. keeps publishing plaintext `announce` periodically

---

## Phase 1: client resolves trust material

Before sending an offer, the client tries to resolve the expected server identity from:

1. `identity.knownHosts`
2. authority servers
3. custom `authorityResolver`
4. stored known-host records

If secure mode already has a trusted encryption public key, it can immediately prepare the sealed offer path.

If not, it now performs a **public encryption bootstrap**.

---

## Phase 2: public encryption bootstrap when the encryption key is unknown

If the client does **not** know the server encryption public key, it sends a public MQTT request.

### Client bootstrap request

The client:

1. generates an ephemeral X25519 keypair
2. generates a public challenge nonce
3. publishes plaintext `discover` containing:
   - target `serverName`
   - `challengeNonce`
   - `requestEncryptionIdentity: true`
   - `bootstrapClientEphemeralPublicKeyJwk`

### Server bootstrap response

The server replies with plaintext `announce` containing:

- signing `identity`
- optional `authorityRecord`
- existing signing `challengeSignature`
- `encryptionIdentity`
- `encryptionChallengeCiphertext`
- `encryptionChallengeNonce`

### What this proves

This proves two different things:

1. **Signing challenge proof**
   - the responder controls the signing private key for the signing public key it presented

2. **Encryption key proof**
   - the responder controls the X25519 private key corresponding to the encryption public key it presented
   - the proof works because the server encrypts a response that only someone holding that X25519 private key could have produced

### What this does _not_ prove by itself

Without authority or prior trust, this bootstrap does **not** prove that the responder is legitimately authorized to own that `serverName`.

It only proves:

- this responder controls the signing/encryption keys it presented
- outsiders cannot read the subsequent sealed signaling

This gives **confidentiality**, but not strong server-name authenticity, unless backed by:

- authority verification, or
- previously pinned trust, or
- TOFU policy

---

## Phase 3: client creates the WebRTC offer

The client then:

1. creates an `RTCPeerConnection`
2. creates a data channel
3. creates an SDP offer
4. sets local description
5. starts emitting ICE candidates

It also has:

- `peerId`
- `connectionId`
- `challengeNonce`

In secure mode, the client uses an ephemeral X25519 keypair for the sealed session.

---

## Phase 4: client sends the offer

### Plaintext mode

The client publishes plaintext `offer` with:

- `senderId`
- `targetId`
- `serverName`
- `connectionId`
- `description`
- `challengeNonce`
- `at`

### Secure mode

The client publishes a sealed envelope whose encrypted inner payload contains:

- `type: 'offer'`
- `connectionId`
- `serverName`
- `description`
- `challengeNonce`
- optional `auth`
- `at`

The client derives the AEAD key from:

- client ephemeral private key
- server encryption public key

---

## Phase 5: server processes the offer

### Plaintext mode

The server:

1. receives `offer`
2. creates peer connection
3. sets remote description
4. creates answer
5. sets local description

### Secure mode

The server:

1. parses sealed envelope
2. imports client ephemeral public key
3. derives AEAD key using its encryption private key
4. rebuilds AAD
5. decrypts and unpads ciphertext
6. validates the inner payload
7. rejects stale messages
8. rejects replayed `(senderId, nonce)` pairs
9. processes the decrypted offer

Optional secure reject reasons include:

- `auth-required`
- `auth-failed`
- `server-not-accepting`
- `bad-message`

---

## Phase 6: server sends answer or reject

### Successful connection

#### Plaintext mode

The server publishes plaintext `answer` containing:

- SDP answer
- server identity
- optional authority record
- challenge signature

#### Secure mode

The server publishes sealed `answer` containing:

- `type: 'answer'`
- `connectionId`
- `serverName`
- `description`
- `identity`
- optional `authorityRecord`
- `challengeNonce`
- `challengeSignature`
- `at`

### Rejected connection

The server publishes sealed `reject` in secure mode with an explicit reason.

---

## Phase 7: client verifies server identity

When the answer arrives, the client verifies:

1. challenge fields are present when expected
2. authority record signature if present
3. authority signing key matches presented signing identity
4. challenge signature validates against the signing public key
5. presented signing key matches already-trusted signing key if one exists

Important:

- this verification is bundled into the answer
- it does **not** add another MQTT round-trip

---

## Phase 8: ICE trickle over MQTT

After offer/answer, both sides may send ICE candidates.

Each candidate is one MQTT publish.

### Plaintext mode

Each candidate is a plaintext `ice` message.

### Secure mode

Each candidate is a sealed payload with:

- `type: 'ice'`
- `connectionId`
- `serverName`
- `candidate`
- `at`

So total MQTT traffic is:

- known-key secure path: `2 + clientIceCount + serverIceCount`
- bootstrap secure path: `4 + clientIceCount + serverIceCount`
- plaintext path: `2 + clientIceCount + serverIceCount`

---

## Phase 9: WebRTC data channel opens

Once the answer is applied and enough ICE succeeds, the WebRTC data channel opens.

After that, MQTT is no longer the app-data transport.

The WebRTC data channel carries:

- RPC requests/responses
- peer events
- ping/pong
- optional private challenge traffic

---

## ASCII diagram: secure connect with known encryption key

```text
Client                              MQTT Broker                         Server
  |                                     |                                |
  |== create WebRTC offer ============  |                                |
  |-- sealed offer -------------------->|-- deliver sealed offer ------->|
  |                                     |                                |
  |<-- sealed answer -------------------|<-- publish sealed answer ------|
  |                                     |                                |
  |-- sealed ICE (0..N) --------------->|-- deliver sealed ICE --------->|
  |<-- sealed ICE (0..N) ---------------|<-- publish sealed ICE ---------|
  |                                     |                                |
  |================ WebRTC data channel opens ==========================>|
```

---

## ASCII diagram: secure connect with public encryption bootstrap

```text
Client                              MQTT Broker                         Server
  |                                     |                                |
  |== generate bootstrap X25519 key ==  |                                |
  |-- plaintext discover -------------->|-- deliver discover ----------->|
  |   requestEncryptionIdentity=true    |                                |
  |   bootstrapClientEphemeralPublicKey |                                |
  |                                     |                                |
  |<-- plaintext announce --------------|<-- announce with signing proof |
  |                                     |    + encryption public key     |
  |                                     |    + encrypted challenge proof |
  |                                     |                                |
  |== verify signing challenge =======  |                                |
  |== verify encryption-key proof ====  |                                |
  |                                     |                                |
  |-- sealed offer -------------------->|-- deliver sealed offer ------->|
  |<-- sealed answer -------------------|<-- publish sealed answer ------|
  |-- sealed ICE (0..N) --------------->|-- deliver sealed ICE --------->|
  |<-- sealed ICE (0..N) ---------------|<-- publish sealed ICE ---------|
  |                                     |                                |
  |================ WebRTC data channel opens ==========================>|
```

---

## ASCII diagram: discovery before connect

```text
Client                              MQTT Broker                         Server(s)
  |                                     |                                |
  |-- plaintext discover -------------> |-- deliver discover ----------->|
  |                                     |                                |
  |<-- plaintext announce -------------|<-- announce response ----------|
  |<-- plaintext announce -------------|<-- announce response ----------|
  |                                     |                                |
  |== rank candidates ==               |                                |
  |== choose one server ==             |                                |
  |                                     |                                |
  |--------- then run normal connect flow (offer/answer/ice) ---------->|
```

---

## Summary table

| Scenario | MQTT messages |
|---|---:|
| Secure connect, known encryption key, no ICE | 2 |
| Secure connect, known encryption key, with ICE | `2 + clientIceCount + serverIceCount` |
| Secure connect, bootstrap encryption key, no ICE | 4 |
| Secure connect, bootstrap encryption key, with ICE | `4 + clientIceCount + serverIceCount` |
| Discovery only | `1 + matchingServerCount` |
| Discovery + connect | `1 + matchingServerCount + connect-flow-count` |
| Background announce | 1 on startup, then periodic |

---

## Important notes

- `announce` remains plaintext.
- the encryption bootstrap is also plaintext at the outer MQTT layer
- the bootstrap is used only to obtain the server encryption public key and prove private-key possession
- once the client has that key, the actual offer/answer/ICE path stays sealed
- identity verification is bundled into the answer and does not add an extra MQTT round-trip
- once WebRTC is established, MQTT no longer carries normal app requests/responses

---

## Bottom line

Today, the current minimum MQTT exchange count is:

- **2** if the client already knows the server encryption public key
- **4** if the client must bootstrap the server encryption public key first
- plus however many ICE messages are needed
- plus optional discovery traffic if discovery is used before connect
