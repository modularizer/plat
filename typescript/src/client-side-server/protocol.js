export function isClientSideServerPeerMessage(message) {
    return 'platcss' in message && message.platcss === 'peer';
}
export function isClientSideServerControlMessage(message) {
    if (!('platcss' in message))
        return false;
    const kind = message.platcss;
    return kind === 'ping' || kind === 'pong' || kind === 'drain'
        || kind === 'private-challenge' || kind === 'private-challenge-response';
}
export function isClientSideServerRequestMessage(message) {
    return 'jsonrpc' in message && 'method' in message && 'path' in message;
}
export function isClientSideServerEventMessage(message) {
    return 'jsonrpc' in message && 'event' in message && message.ok === true;
}
export function isClientSideServerResponseMessage(message) {
    return 'jsonrpc' in message && 'ok' in message && !('event' in message) && !('method' in message);
}
export function isClientSideServerSealedEnvelope(value) {
    if (!isObject(value))
        return false;
    return value.platcss === 'sealed'
        && value.version === 1
        && typeof value.senderId === 'string'
        && typeof value.at === 'number'
        && Number.isFinite(value.at)
        && typeof value.nonce === 'string'
        && isPlainJsonWebKey(value.clientEphemeralPublicKeyJwk)
        && typeof value.ciphertext === 'string';
}
export function isClientSideServerSealedPayload(value) {
    if (!isObject(value))
        return false;
    if (typeof value.connectionId !== 'string' || typeof value.serverName !== 'string')
        return false;
    if (typeof value.at !== 'number' || !Number.isFinite(value.at))
        return false;
    if (!isOptionalString(value.challengeNonce))
        return false;
    if (!isOptionalBoolean(value.requirePrivateChallenge))
        return false;
    if (!isOptionalClientSideServerPublicIdentity(value.clientIdentity))
        return false;
    if (!isOptionalAuthObject(value.auth))
        return false;
    switch (value.type) {
        case 'discover':
            return true;
        case 'offer':
            return isRtcSessionDescriptionInit(value.description);
        case 'answer':
            return isRtcSessionDescriptionInit(value.description)
                && isOptionalClientSideServerPublicIdentity(value.identity)
                && isOptionalAuthorityRecord(value.authorityRecord)
                && isOptionalString(value.challengeSignature);
        case 'ice':
            return isRtcIceCandidateInit(value.candidate);
        case 'reject':
            return value.reason === 'auth-required'
                || value.reason === 'auth-failed'
                || value.reason === 'server-not-accepting'
                || value.reason === 'bad-message'
                || value.reason === 'timeout';
        default:
            return false;
    }
}
function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isPlainJsonWebKey(value) {
    return isObject(value);
}
function isOptionalString(value) {
    return value === undefined || typeof value === 'string';
}
function isOptionalBoolean(value) {
    return value === undefined || typeof value === 'boolean';
}
function isRtcSessionDescriptionInit(value) {
    return isObject(value)
        && (value.type === 'offer' || value.type === 'pranswer' || value.type === 'answer' || value.type === 'rollback')
        && isOptionalString(value.sdp);
}
function isRtcIceCandidateInit(value) {
    return isObject(value)
        && isOptionalString(value.candidate)
        && (value.sdpMid === undefined || value.sdpMid === null || typeof value.sdpMid === 'string')
        && (value.sdpMLineIndex === undefined || value.sdpMLineIndex === null || typeof value.sdpMLineIndex === 'number')
        && (value.usernameFragment === undefined || value.usernameFragment === null || typeof value.usernameFragment === 'string');
}
function isClientSideServerPublicIdentityLike(value) {
    return isObject(value)
        && value.algorithm === 'ECDSA-P256'
        && isPlainJsonWebKey(value.publicKeyJwk)
        && typeof value.keyId === 'string'
        && typeof value.fingerprint === 'string'
        && (value.createdAt === undefined || typeof value.createdAt === 'number');
}
function isOptionalClientSideServerPublicIdentity(value) {
    return value === undefined || isClientSideServerPublicIdentityLike(value);
}
function isAuthorityRecord(value) {
    if (!isObject(value) || typeof value.serverName !== 'string' || typeof value.issuedAt !== 'number' || typeof value.signature !== 'string') {
        return false;
    }
    if (value.protocol === 'plat-css-authority-v1') {
        return isPlainJsonWebKey(value.publicKeyJwk)
            && (value.keyId === undefined || typeof value.keyId === 'string')
            && (value.authorityName === undefined || typeof value.authorityName === 'string');
    }
    if (value.protocol === 'plat-css-authority-v2') {
        return isPlainJsonWebKey(value.signingPublicKeyJwk)
            && isPlainJsonWebKey(value.encryptionPublicKeyJwk)
            && (value.signingKeyId === undefined || typeof value.signingKeyId === 'string')
            && (value.encryptionKeyId === undefined || typeof value.encryptionKeyId === 'string')
            && (value.authorityName === undefined || typeof value.authorityName === 'string');
    }
    return false;
}
function isOptionalAuthorityRecord(value) {
    return value === undefined || isAuthorityRecord(value);
}
function isOptionalAuthObject(value) {
    return value === undefined || (isObject(value)
        && typeof value.username === 'string'
        && typeof value.password === 'string');
}
//# sourceMappingURL=protocol.js.map