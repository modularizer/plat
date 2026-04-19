import { type IClientOptions } from 'mqtt';
import type { OpenAPIClientTransportPlugin } from '../client/transport-plugin';
import { type ClientSideServerChannel } from './channel';
import { type ClientSideServerAnyAuthorityRecord, type ClientSideServerAnyTrustedServerRecord, type ClientSideServerAuthorityServer, type ClientSideServerEncryptionKeyPair, type ClientSideServerExportedKeyPair, type ClientSideServerPublicIdentity, type ClientSideServerStorageLike } from './identity';
import { type ClientSideServerInstanceInfo, type ClientSideServerPeerMessage } from './protocol';
import { type ClientSideServerAddress } from './signaling';
/**
 * Minimal interface the MQTT/WebRTC signaler needs to drive a server.
 * Both the browser-side `PLATClientSideServer` and server-side transports
 * (e.g. the Node `PLATServer` WebRTC plugin, or an HTTP-forwarding bridge)
 * implement this.
 */
export interface ClientSideServerRequestHandler {
    getServerInfo(): Promise<ClientSideServerInstanceInfo>;
    serveChannel(channel: ClientSideServerChannel): () => void;
}
export declare const DEFAULT_CLIENT_SIDE_SERVER_MQTT_BROKER = "wss://broker.emqx.io:8084/mqtt";
export declare const DEFAULT_CLIENT_SIDE_SERVER_MQTT_TOPIC = "mrtchat/plat-css";
export declare const DEFAULT_CLIENT_SIDE_SERVER_SEALED_TOPIC = "plat";
export declare const DEFAULT_CLIENT_SIDE_SERVER_MAX_SEALED_MESSAGE_BYTES = 65536;
export declare const DEFAULT_CLIENT_SIDE_SERVER_REPLAY_WINDOW_MS: number;
export declare const DEFAULT_CLIENT_SIDE_SERVER_CLOCK_SKEW_TOLERANCE_MS = 30000;
export declare const DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS: RTCIceServer[];
export interface ClientSideServerWorkerInfo {
    weight?: number;
    suggestedWorkerCount?: number;
    currentClients?: number;
    acceptingNewClients?: boolean;
    loadBalancing?: ClientSideServerLoadBalancingPreferences;
}
export interface ClientSideServerLoadBalancingPreferences {
    strategy?: 'weighted-random' | 'round-robin' | 'least-connections' | 'none';
    maxClientsPerInstance?: number;
}
export interface ClientSideServerWorkerPoolOptions {
    maxActiveWorkers?: number;
    maxStandbyWorkers?: number;
    maxTotalConnections?: number;
    rediscoveryThreshold?: number;
    discoveryTimeoutMs?: number;
    passiveDiscovery?: boolean;
    rankCandidates?: (candidates: ClientSideServerDiscoveryCandidate[]) => ClientSideServerDiscoveryCandidate[];
    assignWeights?: (workers: ClientSideServerWorkerState[]) => void;
    routingStrategy?: 'weighted-random' | 'round-robin' | 'least-pending' | 'primary-with-fallback';
    healthCheckIntervalMs?: number;
    healthCheckTimeoutMs?: number;
}
export interface ClientSideServerDiscoveryCandidate {
    instanceId: string;
    serverName: string;
    identity: ClientSideServerPublicIdentity;
    authorityRecord?: ClientSideServerAnyAuthorityRecord;
    mqttChallengeVerified: boolean;
    workerInfo: ClientSideServerWorkerInfo;
    instanceInfo?: ClientSideServerInstanceInfo;
    discoveredAt: number;
    alreadyConnected: boolean;
}
export interface ClientSideServerDiscoveryResult {
    serverName: string;
    candidates: ClientSideServerDiscoveryCandidate[];
    discoveredAt: number;
}
export interface ClientSideServerWorkerState {
    instanceId: string;
    session: ClientSideServerPeerSession;
    identity: ClientSideServerPublicIdentity;
    authorityRecord?: ClientSideServerAnyAuthorityRecord;
    status: 'connecting' | 'verifying' | 'active' | 'standby' | 'draining' | 'failed' | 'closed';
    weight: number;
    serverAdvertisedWeight: number;
    authorityVerified: boolean;
    pendingRequests: number;
    totalRequests: number;
    totalErrors: number;
    connectedAt: number;
    lastRequestAt?: number;
    lastErrorAt?: number;
    lastPongAt?: number;
}
export interface ClientSideServerMQTTWebRTCOptions {
    mqttBroker?: string;
    mqttTopic?: string;
    mqttOptions?: IClientOptions;
    iceServers?: RTCIceServer[];
    connectionTimeoutMs?: number;
    announceIntervalMs?: number;
    clientIdPrefix?: string;
    identity?: ClientSideServerIdentityOptions;
    workerPool?: ClientSideServerWorkerPoolOptions;
    requirePrivateChallenge?: boolean;
    secureSignaling?: boolean;
    anonymousRouting?: boolean;
    sealedTopic?: string;
    maxSealedMessageBytes?: number;
    replayWindowMs?: number;
    clockSkewToleranceMs?: number;
    serverEncryptionKeyPair?: ClientSideServerEncryptionKeyPair;
    signalingAuth?: {
        required?: boolean;
        verify?: (credentials: {
            username: string;
            password: string;
        }, context: {
            serverName: string;
            connectionId: string;
            senderId: string;
        }) => Promise<boolean> | boolean;
    };
}
export interface ClientSideServerMQTTWebRTCServerOptions extends ClientSideServerMQTTWebRTCOptions {
    serverName: string;
    server: ClientSideServerRequestHandler;
    workerInfo?: ClientSideServerWorkerInfo;
    /**
     * Override or supplement the instance info from the PLATClientSideServer.
     * If not provided, instance info is read from the server's own options.
     * `openapiHash` and `serverStartedAt` are always auto-computed.
     */
    instanceInfo?: ClientSideServerInstanceInfo;
}
export interface ClientSideServerIdentityOptions {
    keyPair?: ClientSideServerExportedKeyPair;
    storage?: ClientSideServerStorageLike;
    keyPairStorageKey?: string;
    knownHosts?: Record<string, ClientSideServerAnyTrustedServerRecord>;
    knownHostsStorage?: ClientSideServerStorageLike;
    knownHostsStorageKey?: string;
    trustOnFirstUse?: boolean;
    authority?: {
        publicKeyJwk: JsonWebKey;
        authorityName?: string;
    };
    authorityServers?: ClientSideServerAuthorityServer[];
    authorityResolver?: (serverName: string) => Promise<ClientSideServerAnyTrustedServerRecord | null>;
    authorityRecord?: ClientSideServerAnyAuthorityRecord;
}
export interface ClientSideServerPeerSession extends ClientSideServerChannel {
    readonly address: ClientSideServerAddress;
    readonly connectionId: string;
    readonly peerId: string;
    readonly connectedAt: number;
    readonly identity?: ClientSideServerPublicIdentity;
    isOpen(): boolean;
    sendPeer(event: string, data?: unknown): Promise<void>;
    subscribePeer(listener: (message: ClientSideServerPeerMessage) => void | Promise<void>): () => void;
}
export interface ClientSideServerPeerPool {
    connect(address: string | ClientSideServerAddress): Promise<ClientSideServerPeerSession>;
    close(address: string | ClientSideServerAddress): Promise<void>;
    closeAll(): Promise<void>;
}
export declare class ClientSideServerMQTTWebRTCServer {
    private options;
    private mqtt?;
    readonly serverInstanceId: string;
    private readonly unsubscribeByConnection;
    private readonly peers;
    private readonly pendingCandidates;
    private readonly channels;
    private announceTimer?;
    private identityKeyPair?;
    private publicIdentity?;
    private encryptionKeyPair?;
    private encryptionPublicIdentity?;
    private clientCount;
    private resolvedInstanceInfo?;
    private readonly seenSealedNonces;
    constructor(options: ClientSideServerMQTTWebRTCServerOptions);
    get connectionUrl(): string;
    start(): Promise<void>;
    stop(): Promise<void>;
    private announce;
    private onMessage;
    private respondToDiscover;
    private buildResolvedInstanceInfo;
    private buildWorkerInfo;
    private handleControlMessage;
    /**
     * Send a message to every currently-connected channel. Used to push
     * server-originated events (e.g. "files changed") to subscribers.
     */
    broadcast(message: unknown): Promise<void>;
    drain(): Promise<void>;
    private acceptOffer;
    private acceptSealedOffer;
    private ensureIdentity;
    private ensureEncryptionIdentity;
    private isSealedReplay;
    private rememberSealedNonce;
    private pruneSeenSealedNonces;
    private publishSealedResponse;
    private authorizeSealedOffer;
}
export declare function createClientSideServerMQTTWebRTCTransportPlugin(options?: ClientSideServerMQTTWebRTCOptions): OpenAPIClientTransportPlugin;
export declare function createClientSideServerMQTTWebRTCPeerPool(options?: ClientSideServerMQTTWebRTCOptions): ClientSideServerPeerPool;
export declare function discoverClientSideServers(serverName: string, options?: ClientSideServerMQTTWebRTCOptions): Promise<ClientSideServerDiscoveryResult>;
export declare function connectFirstDiscovery(address: ClientSideServerAddress, options: ClientSideServerMQTTWebRTCOptions): Promise<{
    primary: ClientSideServerPeerSession;
    discovery: Promise<ClientSideServerDiscoveryResult>;
}>;
export declare function createClientSideServerMQTTWebRTCPeerSession(address: ClientSideServerAddress, options: ClientSideServerMQTTWebRTCOptions, targetInstanceId?: string): Promise<ClientSideServerPeerSession>;
export declare function createClientSideServerMQTTWebRTCServer(options: ClientSideServerMQTTWebRTCServerOptions): ClientSideServerMQTTWebRTCServer;
//# sourceMappingURL=mqtt-webrtc.d.ts.map