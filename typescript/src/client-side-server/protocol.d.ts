import type { PLATRPCEventKind } from '../rpc';
import type { ClientSideServerPublicIdentity, ClientSideServerSignedAuthorityRecord, ClientSideServerSignedAuthorityRecordV2 } from './identity';
/**
 * Version and identity metadata that a server publishes about itself.
 * All fields are optional — servers populate what they know.
 * `openapiHash` and `serverStartedAt` are auto-computed; the rest are user-supplied.
 */
export interface ClientSideServerInstanceInfo {
    /** Semantic version string, e.g. "1.2.3" or "2026-04-07". */
    version?: string;
    /** Commit hash, build hash, or any content-identifier for the server code. */
    versionHash?: string;
    /**
     * SHA-256 hex digest of the server's openapi.json (computed automatically
     * from the generated spec; stable for the same set of controllers and options).
     */
    openapiHash?: string;
    /** Unix timestamp (ms) when the server code / deployment was last updated. */
    updatedAt?: number;
    /** Unix timestamp (ms) when this server instance started (auto-set on start). */
    serverStartedAt?: number;
}
export interface ClientSideServerSealedEnvelope {
    platcss: 'sealed';
    version: 1;
    senderId: string;
    at: number;
    nonce: string;
    clientEphemeralPublicKeyJwk: JsonWebKey;
    ciphertext: string;
}
export interface ClientSideServerSealedDiscoverPayload {
    type: 'discover';
    connectionId: string;
    serverName: string;
    challengeNonce?: string;
    requirePrivateChallenge?: boolean;
    clientIdentity?: ClientSideServerPublicIdentity;
    auth?: {
        username: string;
        password: string;
    };
    at: number;
}
export interface ClientSideServerSealedOfferPayload {
    type: 'offer';
    connectionId: string;
    serverName: string;
    description: RTCSessionDescriptionInit;
    challengeNonce?: string;
    requirePrivateChallenge?: boolean;
    clientIdentity?: ClientSideServerPublicIdentity;
    auth?: {
        username: string;
        password: string;
    };
    at: number;
}
export interface ClientSideServerSealedAnswerPayload {
    type: 'answer';
    connectionId: string;
    serverName: string;
    description: RTCSessionDescriptionInit;
    identity?: ClientSideServerPublicIdentity;
    authorityRecord?: ClientSideServerSignedAuthorityRecord | ClientSideServerSignedAuthorityRecordV2;
    challengeNonce?: string;
    challengeSignature?: string;
    at: number;
}
export interface ClientSideServerSealedIcePayload {
    type: 'ice';
    connectionId: string;
    serverName: string;
    candidate: RTCIceCandidateInit;
    at: number;
}
export interface ClientSideServerSealedRejectPayload {
    type: 'reject';
    connectionId: string;
    serverName: string;
    reason: 'auth-required' | 'auth-failed' | 'server-not-accepting' | 'bad-message' | 'timeout';
    at: number;
}
export type ClientSideServerSealedPayload = ClientSideServerSealedDiscoverPayload | ClientSideServerSealedOfferPayload | ClientSideServerSealedAnswerPayload | ClientSideServerSealedIcePayload | ClientSideServerSealedRejectPayload;
export type ServiceWorkerBridgeBodyEncoding = 'none' | 'base64';
export interface ServiceWorkerBridgeRequestMessage {
    type: 'PLAT_REQUEST';
    id: string;
    clientId?: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    bodyEncoding: ServiceWorkerBridgeBodyEncoding;
    body?: string;
}
export interface ServiceWorkerBridgeResponseMessage {
    type: 'PLAT_RESPONSE';
    id: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyEncoding: ServiceWorkerBridgeBodyEncoding;
    body?: string;
    error?: string;
    errorCode?: 'timeout' | 'no-client' | 'upstream-failed' | 'bad-response';
}
export interface ClientSideServerRequest {
    jsonrpc: '2.0';
    id: string;
    operationId?: string;
    method: string;
    path: string;
    headers?: Record<string, string>;
    input?: unknown;
    cancel?: boolean;
}
export interface ClientSideServerSuccessResponse {
    jsonrpc: '2.0';
    id: string;
    ok: true;
    result: unknown;
}
export interface ClientSideServerErrorResponse {
    jsonrpc: '2.0';
    id: string;
    ok: false;
    error: {
        status?: number;
        message: string;
        data?: unknown;
    };
}
export interface ClientSideServerEventMessage {
    jsonrpc: '2.0';
    id: string;
    ok: true;
    event: PLATRPCEventKind;
    data?: unknown;
}
export interface ClientSideServerPeerMessage {
    platcss: 'peer';
    event: string;
    data?: unknown;
    fromPeerId?: string;
    fromServerName?: string;
}
export interface ClientSideServerPingMessage {
    platcss: 'ping';
    ts: number;
}
export interface ClientSideServerPongMessage {
    platcss: 'pong';
    ts: number;
}
export interface ClientSideServerDrainMessage {
    platcss: 'drain';
}
export interface ClientSideServerPrivateChallengeRequest {
    platcss: 'private-challenge';
    challengeNonce: string;
    clientIdentity?: ClientSideServerPublicIdentity;
}
export interface ClientSideServerPrivateChallengeResponse {
    platcss: 'private-challenge-response';
    challengeNonce: string;
    challengeSignature: string;
    identity: ClientSideServerPublicIdentity;
    authorityRecord?: ClientSideServerSignedAuthorityRecord | ClientSideServerSignedAuthorityRecordV2;
}
export type ClientSideServerControlMessage = ClientSideServerPingMessage | ClientSideServerPongMessage | ClientSideServerDrainMessage | ClientSideServerPrivateChallengeRequest | ClientSideServerPrivateChallengeResponse;
export type ClientSideServerResponse = ClientSideServerSuccessResponse | ClientSideServerErrorResponse;
export type ClientSideServerRPCMessage = ClientSideServerRequest | ClientSideServerResponse | ClientSideServerEventMessage;
export type ClientSideServerMessage = ClientSideServerRPCMessage | ClientSideServerPeerMessage | ClientSideServerControlMessage;
export declare function isClientSideServerPeerMessage(message: ClientSideServerMessage): message is ClientSideServerPeerMessage;
export declare function isClientSideServerControlMessage(message: ClientSideServerMessage): message is ClientSideServerControlMessage;
export declare function isClientSideServerRequestMessage(message: ClientSideServerMessage): message is ClientSideServerRequest;
export declare function isClientSideServerEventMessage(message: ClientSideServerMessage): message is ClientSideServerEventMessage;
export declare function isClientSideServerResponseMessage(message: ClientSideServerMessage): message is ClientSideServerResponse;
export declare function isClientSideServerSealedEnvelope(value: unknown): value is ClientSideServerSealedEnvelope;
export declare function isClientSideServerSealedPayload(value: unknown): value is ClientSideServerSealedPayload;
//# sourceMappingURL=protocol.d.ts.map