import type { AuthorityLoadLevel } from '../config/constants.js'

export type AuthorityMode = 'dmz' | 'authority'
export type AuthorityAuthMode = 'public' | 'private' | 'anonymous'

export interface RTCSessionDescriptionLike {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback'
  sdp?: string
}

export interface AuthorityClientAuthPayload {
  mode: AuthorityAuthMode
  credentials: unknown
}

export interface AuthorityClientMetadata {
  ip?: string
  ip_hint?: string
  request_id?: string
  user_agent?: string
}

export interface AuthorityConnectRequest {
  server_name: string
  offer: RTCSessionDescriptionLike
  auth?: AuthorityClientAuthPayload
  client?: AuthorityClientMetadata
}

export type AuthorityRejectReason =
  | 'server_offline'
  | 'unauthorized'
  | 'rejected'
  | 'timed_out'
  | 'rate_limited'
  | 'malformed'

export interface AuthorityConnectSuccess {
  ok: true
  answer: RTCSessionDescriptionLike
  /**
   * Canonical server name that the authority matched for this connection.
   * If the client sent a multi-segment `server_name` like `ns/foo/bar/baz` and only
   * `ns/foo` is registered, this echoes the longest registered prefix (`ns/foo`).
   * Equal to the request's `server_name` for exact matches.
   */
  server_name: string
  /**
   * Leftover path after matching. Begins with '/' when present, or is empty when the
   * request's server_name was an exact match. Clients should use this as the initial
   * request path against the connected server.
   */
  path: string
}

export interface AuthorityConnectFailure {
  ok: false
  error: AuthorityRejectReason
}

export type AuthorityConnectResponse = AuthorityConnectSuccess | AuthorityConnectFailure

export interface AuthorityServerRegistration {
  server_name: string
  auth_mode: AuthorityAuthMode
  endpoint_type?: string // 'http', 'ws', 'webrtc', etc.
  address?: string // URL or host:port
  allowed_origins?: string[]
  metadata?: Record<string, any>
}

export type AuthorityRegistrationRejectionCode =
  | 'namespace_reserved'
  | 'duplicate_server_name'
  | 'server_not_owned'
  | 'namespace_quota_exceeded'
  | 'server_not_authorized'

export interface AuthorityAcceptedServerRegistration extends AuthorityServerRegistration {
  owner_google_sub: string
  last_updated?: string // ISO timestamp
}

export interface AuthorityRejectedServerRegistration extends AuthorityServerRegistration {
  code: AuthorityRegistrationRejectionCode
  message: string
}

export interface AuthorityHelloMessage {
  type: 'hello'
  token: string
}

export interface AuthorityRegisterOnlineMessage {
  type: 'register_online'
  servers: AuthorityServerRegistration[]
}

export interface AuthorityRegisterOfflineMessage {
  type: 'register_offline'
  server_names: string[]
}

export interface AuthorityConnectRequestMessage {
  type: 'connect_request'
  connection_id: string
  server_name: string
  offer: RTCSessionDescriptionLike
  auth?: AuthorityClientAuthPayload
  client?: AuthorityClientMetadata
}

export interface AuthorityConnectAnswerMessage {
  type: 'connect_answer'
  connection_id: string
  answer: RTCSessionDescriptionLike
}

export interface AuthorityConnectRejectMessage {
  type: 'connect_reject'
  connection_id: string
  reason: AuthorityRejectReason
}

export interface AuthoritySuppressClientMessage {
  type: 'suppress_client'
  server_name: string
  client_key: string
  ttl_seconds: number
  reason?: string
}

export interface AuthorityAuthorizeSubpathHostMessage {
  type: 'authorize_subpath_host'
  server_name: string
  host_google_sub: string
}

export interface AuthorityPingMessage {
  type: 'ping' | 'pong'
}

export type AuthorityHostMessage =
  | AuthorityHelloMessage
  | AuthorityRegisterOnlineMessage
  | AuthorityRegisterOfflineMessage
  | AuthorityConnectRequestMessage
  | AuthorityConnectAnswerMessage
  | AuthorityConnectRejectMessage
  | AuthoritySuppressClientMessage
  | AuthorityAuthorizeSubpathHostMessage
  | AuthorityPingMessage

export interface AuthorityPresenceSubscribeMessage {
  type: 'subscribe' | 'unsubscribe'
  server_names: string[]
}

export interface AuthorityPresenceSnapshotMessage {
  type: 'presence_snapshot'
  servers: Array<{ server_name: string; online: boolean }>
}

export interface AuthorityPresenceUpdateMessage {
  type: 'presence_update'
  server_name: string
  online: boolean
}

export type AuthorityPresenceMessage =
  | AuthorityPresenceSubscribeMessage
  | AuthorityPresenceSnapshotMessage
  | AuthorityPresenceUpdateMessage
  | AuthorityPingMessage

export interface AuthorityLiveHostSession {
  hostSessionId: string
  googleSub: string
  serverNames: string[]
  authModes: Record<string, AuthorityAuthMode>
  connectedAt: number
  lastPongAt?: number
}

export interface AuthorityPendingConnection {
  connectionId: string
  serverName: string
  createdAt: number
  expiresAt: number
}

export interface AuthorityHostTimeout {
  serverName: string
  clientKey: string
  expiresAt: number
}

export interface AuthorityLoadState {
  level: AuthorityLoadLevel
  updatedAt: number
}

export interface AuthorityRegistrationResult {
  accepted: AuthorityAcceptedServerRegistration[]
  rejected: AuthorityRejectedServerRegistration[]
  snapshot: AuthorityLiveHostSession
}

