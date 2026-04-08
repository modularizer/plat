import type { PLATRPCEventKind } from '../rpc'

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
  clientIdentity?: import('./identity').ClientSideServerPublicIdentity
}

export interface ClientSideServerPrivateChallengeResponse {
  platcss: 'private-challenge-response'
  challengeNonce: string
  challengeSignature: string
  identity: import('./identity').ClientSideServerPublicIdentity
  authorityRecord?: import('./identity').ClientSideServerSignedAuthorityRecord
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
