import type { PLATRPCEventKind } from '../rpc'

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
