import type { PLATRPCEventKind } from '../rpc'
import type {
  ClientSideServerPublicIdentity,
  ClientSideServerSignedAuthorityRecord,
  ClientSideServerSignedAuthorityRecordV2,
} from './identity'

/**
 * Version and identity metadata that a server publishes about itself.
 * All fields are optional — servers populate what they know.
 * `openapiHash` and `serverStartedAt` are auto-computed; the rest are user-supplied.
 */
export interface ClientSideServerInstanceInfo {
  /** Semantic version string, e.g. "1.2.3" or "2026-04-07". */
  version?: string
  /** Commit hash, build hash, or any content-identifier for the server code. */
  versionHash?: string
  /**
   * SHA-256 hex digest of the server's openapi.json (computed automatically
   * from the generated spec; stable for the same set of controllers and options).
   */
  openapiHash?: string
  /** Unix timestamp (ms) when the server code / deployment was last updated. */
  updatedAt?: number
  /** Unix timestamp (ms) when this server instance started (auto-set on start). */
  serverStartedAt?: number
}

export interface ClientSideServerSealedEnvelope {
  platcss: 'sealed'
  version: 1
  senderId: string
  at: number
  nonce: string
  clientEphemeralPublicKeyJwk: JsonWebKey
  ciphertext: string
}

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

export type ClientSideServerSealedPayload =
  | ClientSideServerSealedDiscoverPayload
  | ClientSideServerSealedOfferPayload
  | ClientSideServerSealedAnswerPayload
  | ClientSideServerSealedIcePayload
  | ClientSideServerSealedRejectPayload

export type ServiceWorkerBridgeBodyEncoding = 'none' | 'base64'

export interface ServiceWorkerBridgeRequestMessage {
  type: 'PLAT_REQUEST'
  id: string
  clientId?: string
  method: string
  path: string
  headers: Record<string, string>
  bodyEncoding: ServiceWorkerBridgeBodyEncoding
  body?: string
}

export interface ServiceWorkerBridgeResponseMessage {
  type: 'PLAT_RESPONSE'
  id: string
  status: number
  statusText: string
  headers: Record<string, string>
  bodyEncoding: ServiceWorkerBridgeBodyEncoding
  body?: string
  error?: string
  errorCode?: 'timeout' | 'no-client' | 'upstream-failed' | 'bad-response'
}

export interface ClientSideServerRequest {
  jsonrpc: '2.0'
  id: string
  operationId?: string
  method: string
  path: string
  headers?: Record<string, string>
  input?: unknown
  cancel?: boolean
}

export interface ClientSideServerSuccessResponse {
  jsonrpc: '2.0'
  id: string
  ok: true
  result: unknown
}

export interface ClientSideServerErrorResponse {
  jsonrpc: '2.0'
  id: string
  ok: false
  error: {
    status?: number
    message: string
    data?: unknown
  }
}

export interface ClientSideServerEventMessage {
  jsonrpc: '2.0'
  id: string
  ok: true
  event: PLATRPCEventKind
  data?: unknown
}

export interface ClientSideServerPeerMessage {
  platcss: 'peer'
  event: string
  data?: unknown
  fromPeerId?: string
  fromServerName?: string
}

export interface ClientSideServerPingMessage {
  platcss: 'ping'
  ts: number
}

export interface ClientSideServerPongMessage {
  platcss: 'pong'
  ts: number
}

export interface ClientSideServerDrainMessage {
  platcss: 'drain'
}

export interface ClientSideServerPrivateChallengeRequest {
  platcss: 'private-challenge'
  challengeNonce: string
  clientIdentity?: ClientSideServerPublicIdentity
}

export interface ClientSideServerPrivateChallengeResponse {
  platcss: 'private-challenge-response'
  challengeNonce: string
  challengeSignature: string
  identity: ClientSideServerPublicIdentity
  authorityRecord?: ClientSideServerSignedAuthorityRecord | ClientSideServerSignedAuthorityRecordV2
}

export type ClientSideServerControlMessage =
  | ClientSideServerPingMessage
  | ClientSideServerPongMessage
  | ClientSideServerDrainMessage
  | ClientSideServerPrivateChallengeRequest
  | ClientSideServerPrivateChallengeResponse

export type ClientSideServerResponse =
  | ClientSideServerSuccessResponse
  | ClientSideServerErrorResponse

export type ClientSideServerRPCMessage =
  | ClientSideServerRequest
  | ClientSideServerResponse
  | ClientSideServerEventMessage

export type ClientSideServerMessage =
  | ClientSideServerRPCMessage
  | ClientSideServerPeerMessage
  | ClientSideServerControlMessage

export function isClientSideServerPeerMessage(message: ClientSideServerMessage): message is ClientSideServerPeerMessage {
  return 'platcss' in message && message.platcss === 'peer'
}

export function isClientSideServerControlMessage(message: ClientSideServerMessage): message is ClientSideServerControlMessage {
  if (!('platcss' in message)) return false
  const kind = (message as any).platcss
  return kind === 'ping' || kind === 'pong' || kind === 'drain'
    || kind === 'private-challenge' || kind === 'private-challenge-response'
}

export function isClientSideServerRequestMessage(message: ClientSideServerMessage): message is ClientSideServerRequest {
  return 'jsonrpc' in message && 'method' in message && 'path' in message
}

export function isClientSideServerEventMessage(message: ClientSideServerMessage): message is ClientSideServerEventMessage {
  return 'jsonrpc' in message && 'event' in message && message.ok === true
}

export function isClientSideServerResponseMessage(
  message: ClientSideServerMessage,
): message is ClientSideServerResponse {
  return 'jsonrpc' in message && 'ok' in message && !('event' in message) && !('method' in message)
}

export function isClientSideServerSealedEnvelope(value: unknown): value is ClientSideServerSealedEnvelope {
  if (!isObject(value)) return false
  return value.platcss === 'sealed'
    && value.version === 1
    && typeof value.senderId === 'string'
    && typeof value.at === 'number'
    && Number.isFinite(value.at)
    && typeof value.nonce === 'string'
    && isPlainJsonWebKey(value.clientEphemeralPublicKeyJwk)
    && typeof value.ciphertext === 'string'
}

export function isClientSideServerSealedPayload(value: unknown): value is ClientSideServerSealedPayload {
  if (!isObject(value)) return false
  if (typeof value.connectionId !== 'string' || typeof value.serverName !== 'string') return false
  if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return false
  if (!isOptionalString(value.challengeNonce)) return false
  if (!isOptionalBoolean(value.requirePrivateChallenge)) return false
  if (!isOptionalClientSideServerPublicIdentity(value.clientIdentity)) return false
  if (!isOptionalAuthObject(value.auth)) return false

  switch (value.type) {
    case 'discover':
      return true
    case 'offer':
      return isRtcSessionDescriptionInit(value.description)
    case 'answer':
      return isRtcSessionDescriptionInit(value.description)
        && isOptionalClientSideServerPublicIdentity(value.identity)
        && isOptionalAuthorityRecord(value.authorityRecord)
        && isOptionalString(value.challengeSignature)
    case 'ice':
      return isRtcIceCandidateInit(value.candidate)
    case 'reject':
      return value.reason === 'auth-required'
        || value.reason === 'auth-failed'
        || value.reason === 'server-not-accepting'
        || value.reason === 'bad-message'
        || value.reason === 'timeout'
    default:
      return false
  }
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPlainJsonWebKey(value: unknown): value is JsonWebKey {
  return isObject(value)
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean'
}

function isRtcSessionDescriptionInit(value: unknown): value is RTCSessionDescriptionInit {
  return isObject(value)
    && (value.type === 'offer' || value.type === 'pranswer' || value.type === 'answer' || value.type === 'rollback')
    && isOptionalString(value.sdp)
}

function isRtcIceCandidateInit(value: unknown): value is RTCIceCandidateInit {
  return isObject(value)
    && isOptionalString(value.candidate)
    && (value.sdpMid === undefined || value.sdpMid === null || typeof value.sdpMid === 'string')
    && (value.sdpMLineIndex === undefined || value.sdpMLineIndex === null || typeof value.sdpMLineIndex === 'number')
    && (value.usernameFragment === undefined || value.usernameFragment === null || typeof value.usernameFragment === 'string')
}

function isClientSideServerPublicIdentityLike(value: unknown): value is ClientSideServerPublicIdentity {
  return isObject(value)
    && value.algorithm === 'ECDSA-P256'
    && isPlainJsonWebKey(value.publicKeyJwk)
    && typeof value.keyId === 'string'
    && typeof value.fingerprint === 'string'
    && (value.createdAt === undefined || typeof value.createdAt === 'number')
}

function isOptionalClientSideServerPublicIdentity(value: unknown): value is ClientSideServerPublicIdentity | undefined {
  return value === undefined || isClientSideServerPublicIdentityLike(value)
}

function isAuthorityRecord(value: unknown): value is ClientSideServerSignedAuthorityRecord | ClientSideServerSignedAuthorityRecordV2 {
  if (!isObject(value) || typeof value.serverName !== 'string' || typeof value.issuedAt !== 'number' || typeof value.signature !== 'string') {
    return false
  }
  if (value.protocol === 'plat-css-authority-v1') {
    return isPlainJsonWebKey(value.publicKeyJwk)
      && (value.keyId === undefined || typeof value.keyId === 'string')
      && (value.authorityName === undefined || typeof value.authorityName === 'string')
  }
  if (value.protocol === 'plat-css-authority-v2') {
    return isPlainJsonWebKey(value.signingPublicKeyJwk)
      && isPlainJsonWebKey(value.encryptionPublicKeyJwk)
      && (value.signingKeyId === undefined || typeof value.signingKeyId === 'string')
      && (value.encryptionKeyId === undefined || typeof value.encryptionKeyId === 'string')
      && (value.authorityName === undefined || typeof value.authorityName === 'string')
  }
  return false
}

function isOptionalAuthorityRecord(
  value: unknown,
): value is ClientSideServerSignedAuthorityRecord | ClientSideServerSignedAuthorityRecordV2 | undefined {
  return value === undefined || isAuthorityRecord(value)
}

function isOptionalAuthObject(value: unknown): value is { username: string; password: string } | undefined {
  return value === undefined || (
    isObject(value)
    && typeof value.username === 'string'
    && typeof value.password === 'string'
  )
}

