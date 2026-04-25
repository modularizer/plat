import mqtt from 'mqtt';
import { createClientSideServerTransportPlugin } from '../client/css-transport-plugin';
import { createRTCDataChannelAdapter } from './channel';
import { buildClientSideServerIdentityChallenge, clientSideServerPublicKeysEqual, generateClientSideServerEncryptionKeyPair, getOrCreateClientSideServerIdentityKeyPair, isClientSideServerSignedAuthorityRecordV2, isClientSideServerTrustedServerRecordV2, loadTrustedClientSideServerRecordFromMap, resolveTrustedClientSideServerFromAuthorities, loadTrustedClientSideServerRecord, trustClientSideServerFromAuthorityRecord, saveTrustedClientSideServerRecordToMap, signClientSideServerChallenge, toClientSideServerEncryptionPublicIdentity, toClientSideServerPublicIdentity, trustClientSideServerOnFirstUse, verifyClientSideServerChallenge, verifyAnySignedClientSideServerAuthorityRecord, } from './identity';
import { isClientSideServerSealedEnvelope, isClientSideServerSealedPayload, isClientSideServerPeerMessage, } from './protocol';
import { choosePaddingBucket, computeSessionId, decodeBase64Url, decryptJsonAead, deriveAeadKeyFromX25519, encodeBase64Url, encryptJsonAead, generateEphemeralX25519KeyPair, importX25519PrivateKeyJwk, importX25519PublicKeyJwk, padCiphertext, randomNonce12, stableJson, unpadCiphertext, utf8, } from './secure-crypto';
import { parseClientSideServerAddress, } from './signaling';
export const DEFAULT_CLIENT_SIDE_SERVER_MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
export const DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC = 'mrtchat/plat-css';
export const DEFAULT_CLIENT_SIDE_SERVER_SEALED_TOPIC = 'plat';
export const DEFAULT_CLIENT_SIDE_SERVER_MAX_SEALED_MESSAGE_BYTES = 65536;
export const DEFAULT_CLIENT_SIDE_SERVER_REPLAY_WINDOW_MS = 5 * 60_000;
export const DEFAULT_CLIENT_SIDE_SERVER_CLOCK_SKEW_TOLERANCE_MS = 30_000;
export const DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
];
let defaultPeerPool;
let defaultTransportPlugin;
export class ClientSideServerMQTTWebRTCServer {
    options;
    mqtt;
    serverInstanceId;
    unsubscribeByConnection = new Map();
    peers = new Map();
    pendingCandidates = new Map();
    channels = new Map();
    announceTimer;
    identityKeyPair;
    publicIdentity;
    encryptionKeyPair;
    encryptionPublicIdentity;
    clientCount = 0;
    resolvedInstanceInfo;
    seenSealedNonces = new Map();
    constructor(options) {
        this.options = options;
        this.serverInstanceId = `${options.serverName}:${randomId('server')}`;
    }
    get connectionUrl() {
        return `css://${this.options.serverName}`;
    }
    async start() {
        if (this.mqtt)
            return;
        await this.ensureIdentity();
        if (isSecureSignalingEnabled(this.options)) {
            await this.ensureEncryptionIdentity();
        }
        this.mqtt = await connectToBroker(this.options);
        this.mqtt.on('message', (_topic, payload) => {
            void this.onMessage(payload);
        });
        await subscribe(this.mqtt, resolvePlaintextTopic(this.options));
        const sealedTopic = resolveSealedTopic(this.options);
        if (sealedTopic !== resolvePlaintextTopic(this.options)) {
            await subscribe(this.mqtt, sealedTopic);
        }
        // Compute and cache instance info (includes openapi hash) before first announce
        this.resolvedInstanceInfo = await this.buildResolvedInstanceInfo();
        await this.announce();
        const intervalMs = this.options.announceIntervalMs ?? 30_000;
        this.announceTimer = setInterval(() => {
            void this.announce();
        }, intervalMs);
    }
    async stop() {
        if (this.announceTimer) {
            clearInterval(this.announceTimer);
            this.announceTimer = undefined;
        }
        for (const unsubscribe of this.unsubscribeByConnection.values()) {
            unsubscribe();
        }
        this.unsubscribeByConnection.clear();
        for (const peer of this.peers.values()) {
            peer.close();
        }
        this.peers.clear();
        if (this.mqtt) {
            await endClient(this.mqtt);
            this.mqtt = undefined;
        }
    }
    async announce() {
        if (!this.mqtt)
            return;
        await publishJson(this.mqtt, resolvePlaintextTopic(this.options), {
            protocol: 'plat-css-v1',
            kind: 'announce',
            senderId: this.serverInstanceId,
            serverName: this.options.serverName,
            identity: this.publicIdentity,
            authorityRecord: this.options.identity?.authorityRecord,
            instanceInfo: this.resolvedInstanceInfo,
            at: Date.now(),
        });
    }
    async onMessage(payload) {
        const message = parseSignalingMessage(payload);
        if (message) {
            if (message.senderId === this.serverInstanceId)
                return;
            if (message.targetId && message.targetId !== this.options.serverName && message.targetId !== this.serverInstanceId)
                return;
            if (message.kind === 'discover' && message.targetId === this.options.serverName && message.challengeNonce) {
                await this.respondToDiscover(message);
                return;
            }
            if (!isSecureSignalingEnabled(this.options)) {
                if (message.kind === 'offer'
                    && (message.targetId === this.options.serverName || message.targetId === this.serverInstanceId)
                    && message.connectionId
                    && message.description) {
                    await this.acceptOffer(message);
                    return;
                }
                if (message.kind === 'ice'
                    && (message.targetId === this.options.serverName || message.targetId === this.serverInstanceId)
                    && message.connectionId
                    && message.candidate) {
                    const peer = this.peers.get(message.connectionId);
                    if (peer?.remoteDescription) {
                        await peer.addIceCandidate(new RTCIceCandidate(message.candidate));
                    }
                    else {
                        const pending = this.pendingCandidates.get(message.connectionId) ?? [];
                        pending.push(message.candidate);
                        this.pendingCandidates.set(message.connectionId, pending);
                    }
                }
            }
            return;
        }
        if (!isSecureSignalingEnabled(this.options))
            return;
        const opened = await openClientSideServerSealedEnvelopeForServer({
            envelopePayload: payload,
            serverEncryptionKeyPair: this.encryptionKeyPair,
        });
        if (!opened || envelopeIsReplayedOrStale(opened.payload, this.options))
            return;
        if (this.isSealedReplay(opened.envelope.senderId, opened.envelope.nonce)) {
            debugSecure('sealed payload replayed', {
                serverName: this.options.serverName,
                senderId: opened.envelope.senderId,
                nonce: opened.envelope.nonce,
            });
            return;
        }
        this.rememberSealedNonce(opened.envelope.senderId, opened.envelope.nonce);
        debugSecure('sealed payload accepted', {
            serverName: this.options.serverName,
            senderId: opened.envelope.senderId,
            type: opened.payload.type,
            connectionId: opened.payload.connectionId,
        });
        if (opened.payload.type === 'offer') {
            await this.acceptSealedOffer(opened.payload, {
                senderId: opened.envelope.senderId,
                clientEphemeralPublicKeyJwk: opened.envelope.clientEphemeralPublicKeyJwk,
                connectionId: opened.payload.connectionId,
            });
            return;
        }
        if (opened.payload.type === 'ice') {
            const peer = this.peers.get(opened.payload.connectionId);
            if (peer?.remoteDescription) {
                await peer.addIceCandidate(new RTCIceCandidate(opened.payload.candidate));
            }
            else {
                const pending = this.pendingCandidates.get(opened.payload.connectionId) ?? [];
                pending.push(opened.payload.candidate);
                this.pendingCandidates.set(opened.payload.connectionId, pending);
            }
        }
    }
    async respondToDiscover(message) {
        if (!this.mqtt || !message.challengeNonce)
            return;
        await this.ensureIdentity();
        let encryptionBootstrap = {};
        if (message.requestEncryptionIdentity && message.bootstrapClientEphemeralPublicKeyJwk) {
            await this.ensureEncryptionIdentity();
            encryptionBootstrap = await createPublicEncryptionBootstrapResponse({
                serverInstanceId: this.serverInstanceId,
                serverName: this.options.serverName,
                serverEncryptionKeyPair: this.encryptionKeyPair,
                serverEncryptionIdentity: this.encryptionPublicIdentity,
                challengeNonce: message.challengeNonce,
                clientEphemeralPublicKeyJwk: message.bootstrapClientEphemeralPublicKeyJwk,
            });
        }
        const challengeString = buildClientSideServerIdentityChallenge({
            serverName: this.options.serverName,
            connectionId: this.serverInstanceId,
            challengeNonce: message.challengeNonce,
        });
        const challengeSignature = await signClientSideServerChallenge(this.identityKeyPair, challengeString);
        await publishJson(this.mqtt, resolvePlaintextTopic(this.options), {
            protocol: 'plat-css-v1',
            kind: 'announce',
            senderId: this.serverInstanceId,
            serverName: this.options.serverName,
            identity: this.publicIdentity,
            authorityRecord: this.options.identity?.authorityRecord,
            ...encryptionBootstrap,
            challengeNonce: message.challengeNonce,
            challengeSignature,
            workerInfo: this.buildWorkerInfo(),
            instanceInfo: this.resolvedInstanceInfo,
            at: Date.now(),
        });
    }
    async buildResolvedInstanceInfo() {
        // Merge: options.instanceInfo (user override) > server.getServerInfo() (auto-computed)
        const serverInfo = await this.options.server.getServerInfo();
        return {
            ...serverInfo,
            ...(this.options.instanceInfo ?? {}),
            // Always override openapiHash and serverStartedAt with freshly computed values
            openapiHash: this.options.instanceInfo?.openapiHash ?? serverInfo.openapiHash,
            serverStartedAt: Date.now(),
        };
    }
    buildWorkerInfo() {
        const base = this.options.workerInfo;
        return {
            weight: base?.weight,
            suggestedWorkerCount: base?.suggestedWorkerCount,
            currentClients: this.clientCount,
            acceptingNewClients: base?.acceptingNewClients,
            loadBalancing: base?.loadBalancing,
        };
    }
    async handleControlMessage(msg, channel, connectionId) {
        if (!('platcss' in msg))
            return;
        const control = msg;
        if (control.platcss === 'ping') {
            await channel.send({ platcss: 'pong', ts: control.ts });
            return;
        }
        if (control.platcss === 'private-challenge') {
            const req = control;
            if (req.challengeNonce.includes('-mqtt')) {
                return;
            }
            await this.ensureIdentity();
            const challengeString = buildClientSideServerIdentityChallenge({
                serverName: this.options.serverName,
                connectionId,
                challengeNonce: req.challengeNonce,
            });
            const sig = await signClientSideServerChallenge(this.identityKeyPair, challengeString);
            await channel.send({
                platcss: 'private-challenge-response',
                challengeNonce: req.challengeNonce,
                challengeSignature: sig,
                identity: this.publicIdentity,
                authorityRecord: this.options.identity?.authorityRecord,
            });
        }
    }
    /**
     * Send a message to every currently-connected channel. Used to push
     * server-originated events (e.g. "files changed") to subscribers.
     */
    async broadcast(message) {
        for (const channel of this.channels.values()) {
            try {
                await channel.send(message);
            }
            catch (err) {
                console.warn('[plat-css] broadcast to channel failed', err);
            }
        }
    }
    async drain() {
        if (this.options.workerInfo) {
            this.options.workerInfo.acceptingNewClients = false;
        }
        if (this.mqtt) {
            await publishJson(this.mqtt, resolvePlaintextTopic(this.options), {
                protocol: 'plat-css-v1',
                kind: 'announce',
                senderId: this.serverInstanceId,
                serverName: this.options.serverName,
                identity: this.publicIdentity,
                workerInfo: { ...this.buildWorkerInfo(), acceptingNewClients: false },
                instanceInfo: this.resolvedInstanceInfo,
                at: Date.now(),
            });
        }
        for (const channel of this.channels.values()) {
            await channel.send({ platcss: 'drain' });
        }
    }
    async acceptOffer(message) {
        if (!this.mqtt || !message.connectionId || !message.description)
            return;
        await this.ensureIdentity();
        const peer = new RTCPeerConnection({
            iceServers: this.options.iceServers ?? DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
        });
        this.peers.set(message.connectionId, peer);
        peer.onicecandidate = (event) => {
            if (!event.candidate || !this.mqtt)
                return;
            void publishJson(this.mqtt, resolvePlaintextTopic(this.options), {
                protocol: 'plat-css-v1',
                kind: 'ice',
                senderId: this.serverInstanceId,
                targetId: message.senderId,
                serverName: this.options.serverName,
                connectionId: message.connectionId,
                candidate: event.candidate.toJSON(),
                at: Date.now(),
            });
        };
        peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'failed' || peer.connectionState === 'closed' || peer.connectionState === 'disconnected') {
                this.unsubscribeByConnection.get(message.connectionId)?.();
                this.unsubscribeByConnection.delete(message.connectionId);
                this.peers.delete(message.connectionId);
            }
        };
        peer.ondatachannel = (event) => {
            const channel = createRTCDataChannelAdapter(event.channel);
            const connId = message.connectionId;
            const controlUnsubscribe = channel.subscribe(async (msg) => {
                await this.handleControlMessage(msg, channel, connId);
            });
            const serveUnsubscribe = this.options.server.serveChannel(channel);
            this.channels.set(connId, channel);
            this.clientCount++;
            const cleanup = () => {
                controlUnsubscribe();
                serveUnsubscribe();
                this.channels.delete(connId);
                this.clientCount--;
                this.unsubscribeByConnection.delete(connId);
            };
            this.unsubscribeByConnection.set(connId, cleanup);
            event.channel.addEventListener('close', cleanup, { once: true });
        };
        await peer.setRemoteDescription(new RTCSessionDescription(message.description));
        for (const candidate of this.pendingCandidates.get(message.connectionId) ?? []) {
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.pendingCandidates.delete(message.connectionId);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await publishJson(this.mqtt, resolvePlaintextTopic(this.options), {
            protocol: 'plat-css-v1',
            kind: 'answer',
            senderId: this.serverInstanceId,
            targetId: message.senderId,
            serverName: this.options.serverName,
            connectionId: message.connectionId,
            description: answer,
            identity: this.publicIdentity,
            authorityRecord: this.options.identity?.authorityRecord,
            challengeNonce: message.challengeNonce,
            challengeSignature: message.challengeNonce
                ? await signClientSideServerChallenge(this.identityKeyPair, buildClientSideServerIdentityChallenge({
                    serverName: this.options.serverName,
                    connectionId: message.connectionId,
                    challengeNonce: message.challengeNonce,
                }))
                : undefined,
            at: Date.now(),
        });
    }
    async acceptSealedOffer(payload, response) {
        if (!this.mqtt)
            return;
        await this.ensureIdentity();
        await this.ensureEncryptionIdentity();
        const authOk = await this.authorizeSealedOffer(payload, response);
        if (!authOk)
            return;
        if (this.options.workerInfo?.acceptingNewClients === false) {
            await this.publishSealedResponse(response, {
                type: 'reject',
                connectionId: payload.connectionId,
                serverName: this.options.serverName,
                reason: 'server-not-accepting',
                at: Date.now(),
            });
            return;
        }
        const peer = new RTCPeerConnection({
            iceServers: this.options.iceServers ?? DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
        });
        this.peers.set(payload.connectionId, peer);
        peer.onicecandidate = (event) => {
            if (!event.candidate || !this.mqtt)
                return;
            void this.publishSealedResponse(response, {
                type: 'ice',
                connectionId: payload.connectionId,
                serverName: this.options.serverName,
                candidate: event.candidate.toJSON(),
                at: Date.now(),
            });
        };
        peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'failed' || peer.connectionState === 'closed' || peer.connectionState === 'disconnected') {
                this.unsubscribeByConnection.get(payload.connectionId)?.();
                this.unsubscribeByConnection.delete(payload.connectionId);
                this.peers.delete(payload.connectionId);
            }
        };
        peer.ondatachannel = (event) => {
            const channel = createRTCDataChannelAdapter(event.channel);
            const connId = payload.connectionId;
            const controlUnsubscribe = channel.subscribe(async (msg) => {
                await this.handleControlMessage(msg, channel, connId);
            });
            const serveUnsubscribe = this.options.server.serveChannel(channel);
            this.channels.set(connId, channel);
            this.clientCount++;
            const cleanup = () => {
                controlUnsubscribe();
                serveUnsubscribe();
                this.channels.delete(connId);
                this.clientCount--;
                this.unsubscribeByConnection.delete(connId);
            };
            this.unsubscribeByConnection.set(connId, cleanup);
            event.channel.addEventListener('close', cleanup, { once: true });
        };
        try {
            await peer.setRemoteDescription(new RTCSessionDescription(payload.description));
            for (const candidate of this.pendingCandidates.get(payload.connectionId) ?? []) {
                await peer.addIceCandidate(new RTCIceCandidate(candidate));
            }
            this.pendingCandidates.delete(payload.connectionId);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await this.publishSealedResponse(response, {
                type: 'answer',
                connectionId: payload.connectionId,
                serverName: this.options.serverName,
                description: answer,
                identity: this.publicIdentity,
                authorityRecord: this.options.identity?.authorityRecord,
                challengeNonce: payload.challengeNonce,
                challengeSignature: payload.challengeNonce
                    ? await signClientSideServerChallenge(this.identityKeyPair, buildClientSideServerIdentityChallenge({
                        serverName: this.options.serverName,
                        connectionId: payload.connectionId,
                        challengeNonce: payload.challengeNonce,
                    }))
                    : undefined,
                at: Date.now(),
            });
            debugSecure('secure answer sent', {
                serverName: this.options.serverName,
                connectionId: payload.connectionId,
            });
        }
        catch (error) {
            debugSecure('sealed offer processing failed', {
                serverName: this.options.serverName,
                connectionId: payload.connectionId,
                error: error instanceof Error ? error.message : String(error),
            });
            await this.publishSealedResponse(response, {
                type: 'reject',
                connectionId: payload.connectionId,
                serverName: this.options.serverName,
                reason: 'bad-message',
                at: Date.now(),
            });
            peer.close();
            this.peers.delete(payload.connectionId);
            this.pendingCandidates.delete(payload.connectionId);
        }
    }
    async ensureIdentity() {
        if (this.identityKeyPair && this.publicIdentity)
            return;
        const storageKey = this.options.identity?.keyPairStorageKey ?? `plat-css:keypair:${this.options.serverName}`;
        this.identityKeyPair = this.options.identity?.keyPair
            ?? await getOrCreateClientSideServerIdentityKeyPair({
                storage: this.options.identity?.storage,
                storageKey,
            });
        this.publicIdentity = await toClientSideServerPublicIdentity(this.identityKeyPair);
    }
    async ensureEncryptionIdentity() {
        if (this.encryptionKeyPair && this.encryptionPublicIdentity)
            return;
        if (this.options.serverEncryptionKeyPair) {
            this.encryptionKeyPair = this.options.serverEncryptionKeyPair;
        }
        else {
            this.encryptionKeyPair = await generateClientSideServerEncryptionKeyPair();
        }
        this.encryptionPublicIdentity = await toClientSideServerEncryptionPublicIdentity(this.encryptionKeyPair);
    }
    isSealedReplay(senderId, nonce) {
        this.pruneSeenSealedNonces();
        return this.seenSealedNonces.has(`${senderId}:${nonce}`);
    }
    rememberSealedNonce(senderId, nonce) {
        this.pruneSeenSealedNonces();
        this.seenSealedNonces.set(`${senderId}:${nonce}`, Date.now());
    }
    pruneSeenSealedNonces() {
        const cutoff = Date.now() - (this.options.replayWindowMs ?? DEFAULT_CLIENT_SIDE_SERVER_REPLAY_WINDOW_MS);
        for (const [key, value] of this.seenSealedNonces.entries()) {
            if (value < cutoff) {
                this.seenSealedNonces.delete(key);
            }
        }
    }
    async publishSealedResponse(response, payload) {
        if (!this.mqtt)
            return;
        const sealed = await sealClientSideServerPayloadForServer({
            senderId: this.serverInstanceId,
            payload,
            serverEncryptionKeyPair: this.encryptionKeyPair,
            clientEphemeralPublicKeyJwk: response.clientEphemeralPublicKeyJwk,
            maxSealedMessageBytes: this.options.maxSealedMessageBytes,
        });
        if (payload.type === 'reject') {
            debugSecure('sealed reject sent', {
                serverName: this.options.serverName,
                connectionId: payload.connectionId,
                reason: payload.reason,
            });
        }
        await publishRaw(this.mqtt, resolveSealedTopic(this.options), serializeSealedEnvelope(sealed.envelope));
    }
    async authorizeSealedOffer(payload, response) {
        const signalingAuth = this.options.signalingAuth;
        if (!signalingAuth)
            return true;
        if (!payload.auth) {
            if (signalingAuth.required !== false) {
                await this.publishSealedResponse(response, {
                    type: 'reject',
                    connectionId: payload.connectionId,
                    serverName: this.options.serverName,
                    reason: 'auth-required',
                    at: Date.now(),
                });
                return false;
            }
            return true;
        }
        if (typeof signalingAuth.verify !== 'function') {
            if (signalingAuth.required !== false) {
                await this.publishSealedResponse(response, {
                    type: 'reject',
                    connectionId: payload.connectionId,
                    serverName: this.options.serverName,
                    reason: 'auth-required',
                    at: Date.now(),
                });
                return false;
            }
            return true;
        }
        let verified = false;
        try {
            verified = await signalingAuth.verify(payload.auth, {
                serverName: this.options.serverName,
                connectionId: payload.connectionId,
                senderId: response.senderId,
            });
        }
        catch {
            verified = false;
        }
        if (!verified) {
            await this.publishSealedResponse(response, {
                type: 'reject',
                connectionId: payload.connectionId,
                serverName: this.options.serverName,
                reason: 'auth-failed',
                at: Date.now(),
            });
            return false;
        }
        return true;
    }
}
export function createClientSideServerMQTTWebRTCTransportPlugin(options = {}) {
    if (isDefaultMQTTWebRTCOptions(options)) {
        defaultTransportPlugin ??= createClientSideServerMQTTWebRTCTransportPluginInternal(options);
        return defaultTransportPlugin;
    }
    return createClientSideServerMQTTWebRTCTransportPluginInternal(options);
}
function createClientSideServerMQTTWebRTCTransportPluginInternal(options) {
    const useMultiWorker = options.workerPool
        && ((options.workerPool.maxActiveWorkers ?? 1) > 1 || (options.workerPool.maxStandbyWorkers ?? 0) > 0);
    if (useMultiWorker) {
        let multiPoolPromise;
        const getPool = () => {
            multiPoolPromise ??= import('./worker-pool').then((mod) => mod.createClientSideServerMultiWorkerPool(options));
            return multiPoolPromise;
        };
        return createClientSideServerTransportPlugin({
            connect: async ({ address }) => {
                const pool = await getPool();
                const session = await pool.connect(address);
                return {
                    send: (message) => session.send(message),
                    subscribe: (listener) => session.subscribe(listener),
                    close: () => undefined,
                };
            },
        });
    }
    const pool = createClientSideServerMQTTWebRTCPeerPool(options);
    return createClientSideServerTransportPlugin({
        connect: async ({ address }) => {
            const session = await pool.connect(address);
            return {
                send: (message) => session.send(message),
                subscribe: (listener) => session.subscribe(listener),
                close: () => undefined,
            };
        },
    });
}
export function createClientSideServerMQTTWebRTCPeerPool(options = {}) {
    if (isDefaultMQTTWebRTCOptions(options)) {
        defaultPeerPool ??= createClientSideServerMQTTWebRTCPeerPoolInternal(options);
        return defaultPeerPool;
    }
    return createClientSideServerMQTTWebRTCPeerPoolInternal(options);
}
function createClientSideServerMQTTWebRTCPeerPoolInternal(options) {
    const sessions = new Map();
    const normalizeAddress = (input) => typeof input === 'string' ? parseClientSideServerAddress(input) : input;
    const connect = async (input) => {
        const address = normalizeAddress(input);
        const existing = sessions.get(address.href);
        if (existing) {
            const session = await existing;
            if (session.isOpen())
                return session;
            sessions.delete(address.href);
        }
        const created = createClientSideServerMQTTWebRTCPeerSession(address, options);
        sessions.set(address.href, created);
        try {
            return await created;
        }
        catch (error) {
            sessions.delete(address.href);
            throw error;
        }
    };
    return {
        connect,
        async close(input) {
            const address = normalizeAddress(input);
            const existing = sessions.get(address.href);
            if (!existing)
                return;
            sessions.delete(address.href);
            const session = await existing;
            await session.close?.();
        },
        async closeAll() {
            const pending = Array.from(sessions.values());
            sessions.clear();
            for (const sessionPromise of pending) {
                const session = await sessionPromise;
                await session.close?.();
            }
        },
    };
}
export async function discoverClientSideServers(serverName, options = {}) {
    const mqttClient = await connectToBroker(options);
    const topic = resolvePlaintextTopic(options);
    const peerId = `${options.clientIdPrefix ?? 'client'}:${randomId('discover')}`;
    const challengeNonce = randomId('challenge') + '-mqtt';
    const timeoutMs = options.workerPool?.discoveryTimeoutMs ?? 3000;
    const candidates = [];
    await subscribe(mqttClient, topic);
    const onMessage = async (_topic, payload) => {
        const message = parseSignalingMessage(payload);
        if (!message || message.senderId === peerId)
            return;
        if (message.kind !== 'announce')
            return;
        if (message.serverName !== serverName)
            return;
        if (message.challengeNonce && message.challengeNonce !== challengeNonce)
            return;
        let mqttChallengeVerified = false;
        if (message.challengeNonce === challengeNonce && message.challengeSignature && message.identity) {
            const challengeString = buildClientSideServerIdentityChallenge({
                serverName,
                connectionId: message.senderId,
                challengeNonce,
            });
            mqttChallengeVerified = await verifyClientSideServerChallenge(message.identity.publicKeyJwk, challengeString, message.challengeSignature);
        }
        if (message.authorityRecord && options.identity?.authority?.publicKeyJwk) {
            const authorityOk = await verifyAnySignedClientSideServerAuthorityRecord(message.authorityRecord, options.identity.authority.publicKeyJwk);
            if (!authorityOk)
                return;
        }
        const existing = candidates.find((c) => c.instanceId === message.senderId);
        if (existing)
            return;
        candidates.push({
            instanceId: message.senderId,
            serverName,
            identity: message.identity,
            authorityRecord: message.authorityRecord,
            mqttChallengeVerified,
            workerInfo: {
                weight: message.workerInfo?.weight ?? 3,
                suggestedWorkerCount: message.workerInfo?.suggestedWorkerCount,
                currentClients: message.workerInfo?.currentClients ?? 0,
                acceptingNewClients: message.workerInfo?.acceptingNewClients ?? true,
                loadBalancing: message.workerInfo?.loadBalancing,
            },
            instanceInfo: message.instanceInfo,
            discoveredAt: Date.now(),
            alreadyConnected: false,
        });
    };
    mqttClient.on('message', onMessage);
    await publish(mqttClient, topic, {
        protocol: 'plat-css-v1',
        kind: 'discover',
        senderId: peerId,
        targetId: serverName,
        challengeNonce,
        at: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    mqttClient.off('message', onMessage);
    await endClient(mqttClient);
    return {
        serverName,
        candidates: defaultRankCandidates(candidates, options),
        discoveredAt: Date.now(),
    };
}
function defaultRankCandidates(candidates, options) {
    if (options.workerPool?.rankCandidates) {
        return options.workerPool.rankCandidates(candidates);
    }
    const accepting = candidates.filter((c) => c.workerInfo.acceptingNewClients !== false);
    const pool = accepting.length > 0 ? accepting : candidates;
    return pool.sort((a, b) => {
        const aAuth = a.authorityRecord ? 1 : 0;
        const bAuth = b.authorityRecord ? 1 : 0;
        if (bAuth !== aAuth)
            return bAuth - aAuth;
        const aMqtt = a.mqttChallengeVerified ? 1 : 0;
        const bMqtt = b.mqttChallengeVerified ? 1 : 0;
        if (bMqtt !== aMqtt)
            return bMqtt - aMqtt;
        const aWeight = a.workerInfo.weight ?? 3;
        const bWeight = b.workerInfo.weight ?? 3;
        if (bWeight !== aWeight)
            return bWeight - aWeight;
        const aClients = a.workerInfo.currentClients ?? 0;
        const bClients = b.workerInfo.currentClients ?? 0;
        return aClients - bClients;
    });
}
export async function connectFirstDiscovery(address, options) {
    const primaryPromise = createClientSideServerMQTTWebRTCPeerSession(address, options);
    const discovery = discoverClientSideServers(address.serverName, options).then((result) => {
        return primaryPromise.then((primary) => {
            for (const candidate of result.candidates) {
                if (candidate.identity && primary.identity
                    && clientSideServerPublicKeysEqual(candidate.identity.publicKeyJwk, primary.identity.publicKeyJwk)) {
                    candidate.alreadyConnected = true;
                }
            }
            return result;
        }).catch(() => result);
    });
    const primary = await primaryPromise;
    return { primary, discovery };
}
export async function createClientSideServerMQTTWebRTCPeerSession(address, options, targetInstanceId) {
    const webrtc = await resolveClientWebRTCImplementation();
    const mqtt = await connectToBroker(options);
    const plaintextTopic = resolvePlaintextTopic(options);
    const sealedTopic = resolveSealedTopic(options);
    const peerId = `${options.clientIdPrefix ?? 'client'}:${randomId('peer')}`;
    const connectionId = randomId('conn');
    const challengeNonce = randomId('challenge');
    const peer = new webrtc.RTCPeerConnection({
        iceServers: options.iceServers ?? DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
    });
    const dataChannel = peer.createDataChannel(`plat-css:${connectionId}`, {
        ordered: true,
    });
    const ready = deferred();
    const timeoutMs = options.connectionTimeoutMs ?? (typeof RTCPeerConnection !== 'undefined' ? 15_000 : 30_000);
    const cleanupCallbacks = [];
    const pendingCandidates = [];
    const expectedIdentity = await resolveExpectedServerIdentity(address.serverName, options.identity);
    let secureState;
    let open = true;
    let answerApplied = false;
    let serverIdentity;
    await subscribe(mqtt, plaintextTopic);
    if (sealedTopic !== plaintextTopic) {
        await subscribe(mqtt, sealedTopic);
    }
    if (isSecureSignalingEnabled(options)) {
        secureState = await createSecureClientSessionState({
            mqtt,
            address,
            options,
            peerId,
            expectedIdentity,
        });
    }
    const onMessage = async (_topic, payload) => {
        if (secureState) {
            const opened = await openClientSideServerSealedEnvelopeForClient({
                envelopePayload: payload,
                secureState,
            });
            if (!opened || opened.envelope.senderId === peerId || opened.payload.connectionId !== connectionId)
                return;
            if (opened.payload.type === 'reject') {
                ready.reject(new Error(`Client-side server ${address.serverName} rejected connection: ${opened.payload.reason}`));
                return;
            }
            if (opened.payload.type === 'answer' && opened.payload.description) {
                if (answerApplied)
                    return;
                answerApplied = true;
                await verifyServerIdentityForSealedAnswer({
                    serverName: address.serverName,
                    connectionId,
                    challengeNonce,
                    message: opened.payload,
                    optionsIdentity: options.identity,
                    expectedIdentity,
                });
                serverIdentity = opened.payload.identity;
                await peer.setRemoteDescription(webrtc.createSessionDescription(opened.payload.description));
                await maybeTrustServerAfterAnswer(address.serverName, expectedIdentity, opened.payload, options.identity);
                for (const candidate of pendingCandidates.splice(0, pendingCandidates.length)) {
                    await peer.addIceCandidate(webrtc.createIceCandidate(candidate));
                }
                return;
            }
            if (opened.payload.type === 'ice') {
                debugSecure('secure ICE received', {
                    serverName: address.serverName,
                    connectionId,
                });
                if (peer.remoteDescription) {
                    await peer.addIceCandidate(webrtc.createIceCandidate(opened.payload.candidate));
                }
                else {
                    pendingCandidates.push(opened.payload.candidate);
                }
            }
            return;
        }
        const message = parseSignalingMessage(payload);
        if (!message || message.senderId === peerId || message.targetId !== peerId || message.connectionId !== connectionId) {
            return;
        }
        if (message.kind === 'answer' && message.description) {
            if (answerApplied)
                return;
            answerApplied = true;
            await verifyServerIdentityForAnswer({
                serverName: address.serverName,
                connectionId,
                challengeNonce,
                message,
                optionsIdentity: options.identity,
                expectedIdentity,
            });
            serverIdentity = message.identity;
            await peer.setRemoteDescription(webrtc.createSessionDescription(message.description));
            await maybeTrustServerAfterAnswer(address.serverName, expectedIdentity, message, options.identity);
            for (const candidate of pendingCandidates.splice(0, pendingCandidates.length)) {
                await peer.addIceCandidate(webrtc.createIceCandidate(candidate));
            }
            return;
        }
        if (message.kind === 'ice' && message.candidate) {
            if (peer.remoteDescription) {
                await peer.addIceCandidate(webrtc.createIceCandidate(message.candidate));
            }
            else {
                pendingCandidates.push(message.candidate);
            }
        }
    };
    mqtt.on('message', onMessage);
    cleanupCallbacks.push(() => mqtt.off('message', onMessage));
    const offerTarget = targetInstanceId ?? address.serverName;
    const addressAuth = resolveAddressAuth(address);
    peer.onicecandidate = (event) => {
        if (!event.candidate)
            return;
        if (secureState) {
            void publishSealedClientPayload({
                mqtt,
                options,
                senderId: peerId,
                secureState,
                payload: {
                    type: 'ice',
                    connectionId,
                    serverName: address.serverName,
                    candidate: webrtc.serializeIceCandidate(event.candidate),
                    at: Date.now(),
                },
            }).then(() => {
                debugSecure('secure ICE sent', { serverName: address.serverName, connectionId });
            });
            return;
        }
        void publish(mqtt, plaintextTopic, {
            protocol: 'plat-css-v1',
            kind: 'ice',
            senderId: peerId,
            targetId: offerTarget,
            connectionId,
            candidate: webrtc.serializeIceCandidate(event.candidate),
            at: Date.now(),
        });
    };
    peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed') {
            ready.reject(new Error(`WebRTC connection to ${address.serverName} failed`));
        }
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed' || peer.connectionState === 'disconnected') {
            open = false;
        }
    };
    dataChannel.addEventListener('open', () => ready.resolve(), { once: true });
    dataChannel.addEventListener('error', () => ready.reject(new Error(`Data channel to ${address.serverName} failed`)), { once: true });
    dataChannel.addEventListener('close', () => {
        open = false;
        ready.reject(new Error(`Data channel to ${address.serverName} closed before becoming ready`));
    }, { once: true });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (secureState) {
        await publishSealedClientPayload({
            mqtt,
            options,
            senderId: peerId,
            secureState,
            payload: {
                type: 'offer',
                connectionId,
                serverName: address.serverName,
                description: offer,
                challengeNonce,
                requirePrivateChallenge: options.requirePrivateChallenge,
                auth: addressAuth,
                at: Date.now(),
            },
        });
    }
    else {
        await publish(mqtt, plaintextTopic, {
            protocol: 'plat-css-v1',
            kind: 'offer',
            senderId: peerId,
            targetId: offerTarget,
            serverName: address.serverName,
            connectionId,
            description: offer,
            challengeNonce,
            at: Date.now(),
        });
    }
    const timer = setTimeout(() => {
        ready.reject(new Error(`Timed out connecting to client-side server ${address.serverName}`));
    }, timeoutMs);
    cleanupCallbacks.push(() => clearTimeout(timer));
    try {
        await ready.promise;
    }
    catch (error) {
        open = false;
        for (const cleanup of cleanupCallbacks)
            cleanup();
        peer.close();
        await endClient(mqtt);
        throw error;
    }
    const channel = createRTCDataChannelAdapter(dataChannel);
    const originalClose = channel.close?.bind(channel);
    return {
        ...channel,
        address,
        connectionId,
        peerId,
        connectedAt: Date.now(),
        identity: serverIdentity,
        isOpen: () => open && dataChannel.readyState === 'open',
        async sendPeer(event, data) {
            await channel.send({
                platcss: 'peer',
                event,
                data,
                fromPeerId: peerId,
                fromServerName: address.serverName,
            });
        },
        subscribePeer(listener) {
            return channel.subscribe(async (message) => {
                if (isClientSideServerPeerMessage(message)) {
                    await listener(message);
                }
            });
        },
        async close() {
            if (!open)
                return;
            open = false;
            for (const cleanup of cleanupCallbacks)
                cleanup();
            await originalClose?.();
            await peer.close();
            await endClient(mqtt);
        },
    };
}
async function resolveExpectedServerIdentity(serverName, options) {
    const mapped = loadTrustedClientSideServerRecordFromMap(options?.knownHosts, serverName);
    if (mapped)
        return normalizeExpectedIdentity(mapped);
    if (options?.authorityServers?.length) {
        const trusted = await resolveTrustedClientSideServerFromAuthorities(serverName, options.authorityServers, {
            storage: options?.knownHostsStorage,
            storageKey: options?.knownHostsStorageKey,
        });
        if (trusted) {
            if (options.knownHosts) {
                saveTrustedClientSideServerRecordToMap(options.knownHosts, trusted);
            }
            return normalizeExpectedIdentity(trusted);
        }
    }
    const authorityResolved = options?.authorityResolver ? await options.authorityResolver(serverName) : null;
    if (authorityResolved)
        return normalizeExpectedIdentity(authorityResolved);
    const stored = loadTrustedClientSideServerRecord(serverName, {
        storage: options?.knownHostsStorage,
        storageKey: options?.knownHostsStorageKey,
    });
    if (stored && options?.knownHosts) {
        saveTrustedClientSideServerRecordToMap(options.knownHosts, stored);
    }
    return stored ? normalizeExpectedIdentity(stored) : null;
}
async function verifyServerIdentityForAnswer(input) {
    const { message, serverName, connectionId, challengeNonce, expectedIdentity } = input;
    if (!message.identity || !message.challengeSignature) {
        if (expectedIdentity) {
            throw new Error(`Server ${serverName} did not provide identity proof`);
        }
        return;
    }
    if (message.authorityRecord && input.optionsIdentity?.authority?.publicKeyJwk) {
        const authorityOk = await verifyAnySignedClientSideServerAuthorityRecord(message.authorityRecord, input.optionsIdentity.authority.publicKeyJwk);
        if (!authorityOk) {
            throw new Error(`Server ${serverName} provided an invalid authority record`);
        }
        if (!clientSideServerPublicKeysEqual(getAuthoritySigningPublicKey(message.authorityRecord), message.identity.publicKeyJwk)) {
            throw new Error(`Server ${serverName} authority record does not match presented identity`);
        }
    }
    const verified = await verifyClientSideServerChallenge(message.identity.publicKeyJwk, buildClientSideServerIdentityChallenge({
        serverName,
        connectionId,
        challengeNonce,
    }), message.challengeSignature);
    if (!verified) {
        throw new Error(`Server ${serverName} failed identity challenge verification`);
    }
    if (expectedIdentity && !clientSideServerPublicKeysEqual(expectedIdentity.signing.publicKeyJwk, message.identity.publicKeyJwk)) {
        throw new Error(`Server ${serverName} presented an unexpected public key`);
    }
}
async function verifyServerIdentityForSealedAnswer(input) {
    const message = {
        protocol: 'plat-css-v1',
        kind: 'answer',
        senderId: 'sealed',
        connectionId: input.connectionId,
        serverName: input.serverName,
        description: input.message.description,
        identity: input.message.identity,
        authorityRecord: input.message.authorityRecord,
        challengeNonce: input.message.challengeNonce,
        challengeSignature: input.message.challengeSignature,
        at: input.message.at,
    };
    await verifyServerIdentityForAnswer({
        ...input,
        message,
    });
}
async function maybeTrustServerAfterAnswer(serverName, expectedIdentity, message, identityOptions) {
    if (expectedIdentity)
        return;
    if (message.authorityRecord && identityOptions?.authority?.publicKeyJwk) {
        const trusted = await trustClientSideServerFromAuthorityRecord(message.authorityRecord, identityOptions.authority.publicKeyJwk, {
            storage: identityOptions?.knownHostsStorage,
            storageKey: identityOptions?.knownHostsStorageKey,
        });
        if (identityOptions?.knownHosts) {
            saveTrustedClientSideServerRecordToMap(identityOptions.knownHosts, trusted);
        }
        return;
    }
    if (identityOptions?.trustOnFirstUse !== false && message.identity) {
        const trusted = await trustClientSideServerOnFirstUse(serverName, message.identity, {
            storage: identityOptions?.knownHostsStorage,
            storageKey: identityOptions?.knownHostsStorageKey,
        });
        if (identityOptions?.knownHosts) {
            saveTrustedClientSideServerRecordToMap(identityOptions.knownHosts, trusted);
        }
    }
}
export function createClientSideServerMQTTWebRTCServer(options) {
    return new ClientSideServerMQTTWebRTCServer(options);
}
async function connectToBroker(options) {
    const client = resolveMqttConnect()(options.mqttBroker ?? DEFAULT_CLIENT_SIDE_SERVER_MQTT_BROKER, options.mqttOptions);
    await new Promise((resolve, reject) => {
        const onConnect = () => {
            cleanup();
            resolve();
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const cleanup = () => {
            client.off('connect', onConnect);
            client.off('error', onError);
        };
        client.on('connect', onConnect);
        client.on('error', onError);
    });
    return client;
}
function resolveMqttConnect() {
    const connect = mqtt.connect ?? mqtt.default?.connect;
    if (typeof connect !== 'function') {
        throw new Error('The loaded mqtt module does not expose a connect function');
    }
    return connect;
}
function subscribe(client, topic) {
    return new Promise((resolve, reject) => {
        client.subscribe(topic, (error) => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}
function publish(client, topic, message) {
    return new Promise((resolve, reject) => {
        client.publish(topic, JSON.stringify(message), (error) => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}
function publishJson(client, topic, message) {
    return publish(client, topic, message);
}
function publishRaw(client, topic, message) {
    return new Promise((resolve, reject) => {
        client.publish(topic, message, (error) => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}
function endClient(client) {
    return new Promise((resolve) => {
        client.end(false, {}, () => resolve());
    });
}
function parseSignalingMessage(payload) {
    try {
        const text = payload instanceof Uint8Array ? new TextDecoder().decode(payload) : String(payload);
        const parsed = JSON.parse(text);
        if (parsed?.protocol !== 'plat-css-v1' || typeof parsed.kind !== 'string' || typeof parsed.senderId !== 'string') {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function randomId(prefix) {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Math.random().toString(36).slice(2)}`;
}
function isDefaultMQTTWebRTCOptions(options) {
    return Object.keys(options).length === 0;
}
function isSecureSignalingEnabled(options) {
    return options.secureSignaling !== false;
}
function resolvePlaintextTopic(options) {
    return options.mqttTopic ?? DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC;
}
function resolveSealedTopic(options) {
    if (isSecureSignalingEnabled(options) && options.anonymousRouting !== false) {
        return options.sealedTopic ?? DEFAULT_CLIENT_SIDE_SERVER_SEALED_TOPIC;
    }
    return resolvePlaintextTopic(options);
}
function envelopeIsReplayedOrStale(payload, options) {
    const replayWindowMs = options.replayWindowMs ?? DEFAULT_CLIENT_SIDE_SERVER_REPLAY_WINDOW_MS;
    const clockSkewToleranceMs = options.clockSkewToleranceMs ?? DEFAULT_CLIENT_SIDE_SERVER_CLOCK_SKEW_TOLERANCE_MS;
    const stale = Math.abs(Date.now() - payload.at) > (clockSkewToleranceMs + replayWindowMs);
    if (stale) {
        debugSecure('sealed payload stale', { type: payload.type, connectionId: payload.connectionId, at: payload.at });
    }
    return stale;
}
async function openClientSideServerSealedEnvelopeForServer(input) {
    if (!input.serverEncryptionKeyPair)
        return null;
    const envelope = parseSealedEnvelope(input.envelopePayload);
    if (!envelope)
        return null;
    try {
        const privateKey = await importX25519PrivateKeyJwk(input.serverEncryptionKeyPair.privateKeyJwk);
        const publicKey = await importX25519PublicKeyJwk(envelope.clientEphemeralPublicKeyJwk);
        const aeadKey = await deriveAeadKeyFromX25519(privateKey, publicKey, utf8('plat-css-sealed-signaling-v1'));
        const ciphertext = unpadCiphertext(decodeBase64Url(envelope.ciphertext));
        const payload = await decryptJsonAead(aeadKey, ciphertext, buildSealedEnvelopeAad(envelope), decodeBase64Url(envelope.nonce));
        if (!isClientSideServerSealedPayload(payload)) {
            debugSecure('sealed decrypt failed', { reason: 'payload-validator' });
            return null;
        }
        return { envelope, payload };
    }
    catch (error) {
        debugSecure('sealed decrypt failed', { error: error instanceof Error ? error.message : String(error) });
        return null;
    }
}
async function openClientSideServerSealedEnvelopeForClient(input) {
    const envelope = parseSealedEnvelope(input.envelopePayload);
    if (!envelope)
        return null;
    try {
        const aeadKey = await deriveAeadKeyFromX25519(input.secureState.keyPair.privateKey, input.secureState.serverEncryptionPublicKey, utf8('plat-css-sealed-signaling-v1'));
        const payload = await decryptJsonAead(aeadKey, unpadCiphertext(decodeBase64Url(envelope.ciphertext)), buildSealedEnvelopeAad(envelope), decodeBase64Url(envelope.nonce));
        if (!isClientSideServerSealedPayload(payload))
            return null;
        return { envelope, payload };
    }
    catch {
        return null;
    }
}
async function createSecureClientSessionState(input) {
    const keyPair = await generateEphemeralX25519KeyPair();
    const serverEncryptionPublicKeyJwk = input.address.encryptionPublicKeyJwk
        ?? input.expectedIdentity?.encryption?.publicKeyJwk;
    if (serverEncryptionPublicKeyJwk) {
        return {
            keyPair,
            serverEncryptionPublicKeyJwk,
            serverEncryptionPublicKey: await importX25519PublicKeyJwk(serverEncryptionPublicKeyJwk),
        };
    }
    return bootstrapServerEncryptionIdentity({
        ...input,
        keyPair,
    });
}
async function bootstrapServerEncryptionIdentity(input) {
    const challengeNonce = randomId('enc-bootstrap');
    const timeoutMs = Math.min(input.options.connectionTimeoutMs ?? 10_000, input.options.workerPool?.discoveryTimeoutMs ?? 3_000);
    const ready = deferred();
    const onMessage = async (_topic, payload) => {
        const message = parseSignalingMessage(payload);
        if (!message || message.senderId === input.peerId)
            return;
        if (message.kind !== 'announce')
            return;
        if (message.serverName !== input.address.serverName)
            return;
        if (message.challengeNonce !== challengeNonce)
            return;
        if (!message.identity || !message.challengeSignature || !message.encryptionIdentity)
            return;
        if (!message.encryptionChallengeCiphertext || !message.encryptionChallengeNonce)
            return;
        if (input.expectedIdentity
            && !clientSideServerPublicKeysEqual(input.expectedIdentity.signing.publicKeyJwk, message.identity.publicKeyJwk)) {
            return;
        }
        if (message.authorityRecord && input.options.identity?.authority?.publicKeyJwk) {
            const authorityOk = await verifyAnySignedClientSideServerAuthorityRecord(message.authorityRecord, input.options.identity.authority.publicKeyJwk);
            if (!authorityOk)
                return;
            if (isClientSideServerSignedAuthorityRecordV2(message.authorityRecord)
                && !clientSideServerPublicKeysEqual(message.authorityRecord.encryptionPublicKeyJwk, message.encryptionIdentity.publicKeyJwk)) {
                return;
            }
        }
        const signedChallengeOk = await verifyClientSideServerChallenge(message.identity.publicKeyJwk, buildClientSideServerIdentityChallenge({
            serverName: input.address.serverName,
            connectionId: message.senderId,
            challengeNonce,
        }), message.challengeSignature);
        if (!signedChallengeOk)
            return;
        try {
            const serverEncryptionPublicKey = await importX25519PublicKeyJwk(message.encryptionIdentity.publicKeyJwk);
            const aeadKey = await deriveAeadKeyFromX25519(input.keyPair.privateKey, serverEncryptionPublicKey, utf8('plat-css-sealed-signaling-v1'));
            const proof = await decryptJsonAead(aeadKey, decodeBase64Url(message.encryptionChallengeCiphertext), buildBootstrapEncryptionAad({
                senderId: message.senderId,
                serverName: input.address.serverName,
                challengeNonce,
                clientEphemeralPublicKeyJwk: input.keyPair.publicKeyJwk,
                serverEncryptionPublicKeyJwk: message.encryptionIdentity.publicKeyJwk,
            }), decodeBase64Url(message.encryptionChallengeNonce));
            if (proof.challengeNonce !== challengeNonce)
                return;
            if (proof.senderId !== message.senderId)
                return;
            if (proof.serverName !== input.address.serverName)
                return;
            ready.resolve({
                keyPair: input.keyPair,
                serverEncryptionPublicKeyJwk: message.encryptionIdentity.publicKeyJwk,
                serverEncryptionPublicKey,
            });
        }
        catch {
            return;
        }
    };
    input.mqtt.on('message', onMessage);
    const timer = setTimeout(() => {
        ready.reject(new Error(`Timed out bootstrapping encryption public key for ${input.address.serverName}`));
    }, timeoutMs);
    try {
        await publish(input.mqtt, resolvePlaintextTopic(input.options), {
            protocol: 'plat-css-v1',
            kind: 'discover',
            senderId: input.peerId,
            targetId: input.address.serverName,
            challengeNonce,
            requestEncryptionIdentity: true,
            bootstrapClientEphemeralPublicKeyJwk: input.keyPair.publicKeyJwk,
            at: Date.now(),
        });
        const secureState = await ready.promise;
        input.address.encryptionPublicKeyJwk = secureState.serverEncryptionPublicKeyJwk;
        return secureState;
    }
    finally {
        clearTimeout(timer);
        input.mqtt.off('message', onMessage);
    }
}
async function createPublicEncryptionBootstrapResponse(input) {
    if (!input.serverEncryptionKeyPair || !input.serverEncryptionIdentity || !input.challengeNonce) {
        return {};
    }
    const privateKey = await importX25519PrivateKeyJwk(input.serverEncryptionKeyPair.privateKeyJwk);
    const publicKey = await importX25519PublicKeyJwk(input.clientEphemeralPublicKeyJwk);
    const aeadKey = await deriveAeadKeyFromX25519(privateKey, publicKey, utf8('plat-css-sealed-signaling-v1'));
    const nonce = randomNonce12();
    const ciphertext = await encryptJsonAead(aeadKey, {
        challengeNonce: input.challengeNonce,
        senderId: input.serverInstanceId,
        serverName: input.serverName,
    }, buildBootstrapEncryptionAad({
        senderId: input.serverInstanceId,
        serverName: input.serverName,
        challengeNonce: input.challengeNonce,
        clientEphemeralPublicKeyJwk: input.clientEphemeralPublicKeyJwk,
        serverEncryptionPublicKeyJwk: input.serverEncryptionIdentity.publicKeyJwk,
    }), nonce);
    return {
        encryptionIdentity: input.serverEncryptionIdentity,
        encryptionChallengeCiphertext: encodeBase64Url(ciphertext),
        encryptionChallengeNonce: encodeBase64Url(nonce),
    };
}
async function publishSealedClientPayload(input) {
    const nonce = randomNonce12();
    const envelope = await sealClientSideServerPayload({
        senderId: input.senderId,
        payload: input.payload,
        privateKey: input.secureState.keyPair.privateKey,
        peerPublicKey: input.secureState.serverEncryptionPublicKey,
        clientEphemeralPublicKeyJwk: input.secureState.keyPair.publicKeyJwk,
        serverEncryptionPublicKeyJwk: input.secureState.serverEncryptionPublicKeyJwk,
        maxSealedMessageBytes: input.options.maxSealedMessageBytes,
        nonce,
    });
    await publishRaw(input.mqtt, resolveSealedTopic(input.options), serializeSealedEnvelope(envelope.envelope));
}
async function sealClientSideServerPayloadForServer(input) {
    if (!input.serverEncryptionKeyPair) {
        throw new Error('Server encryption key pair is required for sealed signaling');
    }
    const privateKey = await importX25519PrivateKeyJwk(input.serverEncryptionKeyPair.privateKeyJwk);
    const publicKey = await importX25519PublicKeyJwk(input.clientEphemeralPublicKeyJwk);
    return {
        ...(await sealClientSideServerPayload({
            senderId: input.senderId,
            payload: input.payload,
            privateKey,
            peerPublicKey: publicKey,
            clientEphemeralPublicKeyJwk: input.clientEphemeralPublicKeyJwk,
            serverEncryptionPublicKeyJwk: input.serverEncryptionKeyPair.publicKeyJwk,
            maxSealedMessageBytes: input.maxSealedMessageBytes,
        })),
    };
}
async function sealClientSideServerPayload(input) {
    const nonceBytes = input.nonce ?? randomNonce12();
    const nonce = encodeBase64Url(nonceBytes);
    const at = Date.now();
    const sessionId = await computeSessionId({
        clientEphemeralPublicKeyJwk: input.clientEphemeralPublicKeyJwk,
        serverEncryptionPublicKeyJwk: input.serverEncryptionPublicKeyJwk,
        nonceB64u: nonce,
    }).catch(() => '');
    const aeadKey = await deriveAeadKeyFromX25519(input.privateKey, input.peerPublicKey, utf8('plat-css-sealed-signaling-v1'));
    const aadEnvelope = {
        platcss: 'sealed',
        version: 1,
        senderId: input.senderId,
        at,
        nonce,
        clientEphemeralPublicKeyJwk: input.clientEphemeralPublicKeyJwk,
    };
    const ciphertext = await encryptJsonAead(aeadKey, input.payload, utf8(stableJson(aadEnvelope)), nonceBytes);
    const bucket = choosePaddingBucket(ciphertext.byteLength);
    const padded = padCiphertext(ciphertext, bucket);
    const maxBytes = input.maxSealedMessageBytes ?? DEFAULT_CLIENT_SIDE_SERVER_MAX_SEALED_MESSAGE_BYTES;
    if (padded.byteLength > maxBytes) {
        throw new Error(`Sealed signaling message exceeds maximum size of ${maxBytes} bytes`);
    }
    return {
        sessionId,
        envelope: {
            ...aadEnvelope,
            ciphertext: encodeBase64Url(padded),
        },
    };
}
function parseSealedEnvelope(payload) {
    try {
        const text = payload instanceof Uint8Array ? new TextDecoder().decode(payload) : String(payload);
        const parsed = JSON.parse(text);
        if (!isClientSideServerSealedEnvelope(parsed)) {
            debugSecure('sealed envelope parse failed', { reason: 'validator' });
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function buildSealedEnvelopeAad(envelope) {
    return utf8(stableJson({
        platcss: 'sealed',
        version: 1,
        senderId: envelope.senderId,
        at: envelope.at,
        nonce: envelope.nonce,
        clientEphemeralPublicKeyJwk: envelope.clientEphemeralPublicKeyJwk,
    }));
}
function buildBootstrapEncryptionAad(input) {
    return utf8(stableJson({
        protocol: 'plat-css-v1',
        kind: 'announce',
        senderId: input.senderId,
        serverName: input.serverName,
        challengeNonce: input.challengeNonce,
        bootstrapClientEphemeralPublicKeyJwk: input.clientEphemeralPublicKeyJwk,
        encryptionPublicKeyJwk: input.serverEncryptionPublicKeyJwk,
    }));
}
function serializeSealedEnvelope(envelope) {
    return JSON.stringify({
        platcss: envelope.platcss,
        version: envelope.version,
        senderId: envelope.senderId,
        at: envelope.at,
        nonce: envelope.nonce,
        clientEphemeralPublicKeyJwk: envelope.clientEphemeralPublicKeyJwk,
        ciphertext: envelope.ciphertext,
    });
}
function resolveAddressAuth(address) {
    const username = address.params.username;
    const password = address.params.password;
    if (!username || !password)
        return undefined;
    return { username, password };
}
function getAuthoritySigningPublicKey(record) {
    return isClientSideServerSignedAuthorityRecordV2(record)
        ? record.signingPublicKeyJwk
        : record.publicKeyJwk;
}
function normalizeExpectedIdentity(record) {
    if (isClientSideServerTrustedServerRecordV2(record)) {
        return {
            trustedRecord: record,
            signing: {
                algorithm: 'ECDSA-P256',
                publicKeyJwk: record.signingPublicKeyJwk,
                keyId: record.signingKeyId ?? 'signing-key',
                fingerprint: record.signingFingerprint,
            },
            encryption: {
                algorithm: 'X25519',
                publicKeyJwk: record.encryptionPublicKeyJwk,
                keyId: record.encryptionKeyId ?? 'encryption-key',
                fingerprint: record.encryptionFingerprint,
            },
        };
    }
    return {
        trustedRecord: record,
        signing: {
            algorithm: 'ECDSA-P256',
            publicKeyJwk: record.publicKeyJwk,
            keyId: record.keyId ?? 'signing-key',
            fingerprint: record.fingerprint,
        },
    };
}
function debugSecure(event, details) {
    if (!globalThis.__PLAT_CSS_DEBUG_SECURE)
        return;
    console.debug(`[plat-css secure] ${event}`, details ?? {});
}
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
async function resolveClientWebRTCImplementation() {
    if (typeof RTCPeerConnection !== 'undefined') {
        return {
            RTCPeerConnection,
            createSessionDescription: (description) => new RTCSessionDescription(description),
            createIceCandidate: (candidate) => new RTCIceCandidate(candidate),
            serializeIceCandidate: (candidate) => candidate.toJSON(),
        };
    }
    try {
        const dynamicImport = new Function('m', 'return import(m)');
        const wrtcModule = await dynamicImport('@roamhq/wrtc');
        const wrtc = wrtcModule.default ?? wrtcModule;
        if (typeof wrtc?.RTCPeerConnection === 'function') {
            return {
                RTCPeerConnection: wrtc.RTCPeerConnection,
                createSessionDescription: (description) => new wrtc.RTCSessionDescription(description),
                createIceCandidate: (candidate) => new wrtc.RTCIceCandidate(candidate),
                serializeIceCandidate: (candidate) => candidate.toJSON(),
            };
        }
    }
    catch (error) {
        throw new Error(`Node css:// support requires @roamhq/wrtc to be available: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw new Error('Node css:// support requires @roamhq/wrtc to expose RTCPeerConnection');
}
//# sourceMappingURL=mqtt-webrtc.js.map
