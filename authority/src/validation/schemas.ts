import type {
  AuthorityClientAuthPayload,
  AuthorityClientMetadata,
  AuthorityConnectAnswerMessage,
  AuthorityConnectRejectMessage,
  AuthorityConnectRequest,
  AuthorityHelloMessage,
  AuthorityHostMessage,
  AuthorityPresenceMessage,
  AuthorityPresenceSubscribeMessage,
  AuthorityRejectReason,
  AuthorityRegisterOfflineMessage,
  AuthorityRegisterOnlineMessage,
  AuthorityServerRegistration,
  AuthoritySuppressClientMessage,
  RTCSessionDescriptionLike,
} from '../models/authority-types.js'
import {
  AUTHORITY_ALLOWED_AUTH_MODES,
  AUTHORITY_ALLOWED_SESSION_DESCRIPTION_TYPES,
  AUTHORITY_MAX_AUTH_TOKEN_LENGTH,
  AUTHORITY_MAX_CLIENT_KEY_LENGTH,
  AUTHORITY_MAX_CONNECTION_ID_LENGTH,
  AUTHORITY_MAX_IP_LENGTH,
  AUTHORITY_MAX_PRESENCE_SUBSCRIPTION_BATCH_SIZE,
  AUTHORITY_MAX_REASON_LENGTH,
  AUTHORITY_MAX_REGISTRATION_BATCH_SIZE,
  AUTHORITY_MAX_REQUEST_ID_LENGTH,
  AUTHORITY_MAX_SDP_LENGTH,
  AUTHORITY_MAX_SERVER_NAME_LENGTH,
  AUTHORITY_MAX_SUPPRESSION_TTL_SECONDS,
  AUTHORITY_MAX_USER_AGENT_LENGTH,
} from './limits.js'

export class AuthorityValidationError extends Error {
  readonly issues: string[]

  constructor(message: string, issues: string[] = [message]) {
    super(message)
    this.name = 'AuthorityValidationError'
    this.issues = issues
  }
}

const AUTHORITY_REJECT_REASONS: readonly AuthorityRejectReason[] = [
  'server_offline',
  'unauthorized',
  'rejected',
  'timed_out',
  'rate_limited',
  'malformed',
]

export function parseAuthorityConnectRequest(input: unknown): AuthorityConnectRequest {
  const object = expectPlainObject(input, 'connect request')
  expectExactKeys(object, ['server_name', 'offer', 'auth', 'client'], 'connect request')

  return {
    server_name: expectBoundedString(object.server_name, 'connect request.server_name', AUTHORITY_MAX_SERVER_NAME_LENGTH),
    offer: parseRTCSessionDescriptionLike(object.offer, 'connect request.offer'),
    auth: object.auth === undefined ? undefined : parseAuthorityClientAuthPayload(object.auth, 'connect request.auth'),
    client: object.client === undefined ? undefined : parseAuthorityClientMetadata(object.client, 'connect request.client'),
  }
}

export function parseAuthorityHostMessage(input: unknown): AuthorityHostMessage {
  const object = expectPlainObject(input, 'host message')
  const type = expectBoundedString(object.type, 'host message.type', 64)

  switch (type) {
    case 'hello':
      return parseAuthorityHelloMessage(object)
    case 'register_online':
      return parseAuthorityRegisterOnlineMessage(object)
    case 'register_offline':
      return parseAuthorityRegisterOfflineMessage(object)
    case 'connect_answer':
      return parseAuthorityConnectAnswerMessage(object)
    case 'connect_reject':
      return parseAuthorityConnectRejectMessage(object)
    case 'suppress_client':
      return parseAuthoritySuppressClientMessage(object)
    case 'ping':
    case 'pong':
      expectExactKeys(object, ['type'], `host message ${type}`)
      return { type }
    default:
      throw new AuthorityValidationError(`Unsupported host message type: ${type}`)
  }
}

export function parseAuthorityPresenceMessage(input: unknown): AuthorityPresenceMessage {
  const object = expectPlainObject(input, 'presence message')
  const type = expectBoundedString(object.type, 'presence message.type', 64)

  switch (type) {
    case 'subscribe':
    case 'unsubscribe':
      return parseAuthorityPresenceSubscribeMessage(object, type)
    case 'ping':
    case 'pong':
      expectExactKeys(object, ['type'], `presence message ${type}`)
      return { type }
    default:
      throw new AuthorityValidationError(`Unsupported presence message type: ${type}`)
  }
}

export function parseAuthorityHelloMessage(input: unknown): AuthorityHelloMessage {
  const object = expectPlainObject(input, 'hello message')
  expectExactKeys(object, ['type', 'token'], 'hello message')
  if (object.type !== 'hello') {
    throw new AuthorityValidationError('hello message.type must be "hello"')
  }
  return {
    type: 'hello',
    token: expectBoundedString(object.token, 'hello message.token', AUTHORITY_MAX_AUTH_TOKEN_LENGTH),
  }
}

export function parseAuthorityRegisterOnlineMessage(input: unknown): AuthorityRegisterOnlineMessage {
  const object = expectPlainObject(input, 'register_online message')
  expectExactKeys(object, ['type', 'servers'], 'register_online message')
  if (object.type !== 'register_online') {
    throw new AuthorityValidationError('register_online message.type must be "register_online"')
  }
  return {
    type: 'register_online',
    servers: expectArray(object.servers, 'register_online message.servers', AUTHORITY_MAX_REGISTRATION_BATCH_SIZE)
      .map((value, index) => parseAuthorityServerRegistration(value, `register_online message.servers[${index}]`)),
  }
}

export function parseAuthorityRegisterOfflineMessage(input: unknown): AuthorityRegisterOfflineMessage {
  const object = expectPlainObject(input, 'register_offline message')
  expectExactKeys(object, ['type', 'server_names'], 'register_offline message')
  if (object.type !== 'register_offline') {
    throw new AuthorityValidationError('register_offline message.type must be "register_offline"')
  }
  return {
    type: 'register_offline',
    server_names: expectArray(object.server_names, 'register_offline message.server_names', AUTHORITY_MAX_REGISTRATION_BATCH_SIZE)
      .map((value, index) => expectBoundedString(value, `register_offline message.server_names[${index}]`, AUTHORITY_MAX_SERVER_NAME_LENGTH)),
  }
}

export function parseAuthorityConnectAnswerMessage(input: unknown): AuthorityConnectAnswerMessage {
  const object = expectPlainObject(input, 'connect_answer message')
  expectExactKeys(object, ['type', 'connection_id', 'answer'], 'connect_answer message')
  if (object.type !== 'connect_answer') {
    throw new AuthorityValidationError('connect_answer message.type must be "connect_answer"')
  }
  return {
    type: 'connect_answer',
    connection_id: expectBoundedString(object.connection_id, 'connect_answer message.connection_id', AUTHORITY_MAX_CONNECTION_ID_LENGTH),
    answer: parseRTCSessionDescriptionLike(object.answer, 'connect_answer message.answer'),
  }
}

export function parseAuthorityConnectRejectMessage(input: unknown): AuthorityConnectRejectMessage {
  const object = expectPlainObject(input, 'connect_reject message')
  expectExactKeys(object, ['type', 'connection_id', 'reason'], 'connect_reject message')
  if (object.type !== 'connect_reject') {
    throw new AuthorityValidationError('connect_reject message.type must be "connect_reject"')
  }
  const reason = expectBoundedString(object.reason, 'connect_reject message.reason', AUTHORITY_MAX_REASON_LENGTH)
  if (!AUTHORITY_REJECT_REASONS.includes(reason as AuthorityRejectReason)) {
    throw new AuthorityValidationError(`connect_reject message.reason has unsupported value: ${reason}`)
  }
  return {
    type: 'connect_reject',
    connection_id: expectBoundedString(object.connection_id, 'connect_reject message.connection_id', AUTHORITY_MAX_CONNECTION_ID_LENGTH),
    reason: reason as AuthorityRejectReason,
  }
}

export function parseAuthoritySuppressClientMessage(input: unknown): AuthoritySuppressClientMessage {
  const object = expectPlainObject(input, 'suppress_client message')
  expectExactKeys(object, ['type', 'server_name', 'client_key', 'ttl_seconds', 'reason'], 'suppress_client message')
  if (object.type !== 'suppress_client') {
    throw new AuthorityValidationError('suppress_client message.type must be "suppress_client"')
  }

  const ttlSeconds = expectIntegerInRange(
    object.ttl_seconds,
    'suppress_client message.ttl_seconds',
    1,
    AUTHORITY_MAX_SUPPRESSION_TTL_SECONDS,
  )

  return {
    type: 'suppress_client',
    server_name: expectBoundedString(object.server_name, 'suppress_client message.server_name', AUTHORITY_MAX_SERVER_NAME_LENGTH),
    client_key: expectBoundedString(object.client_key, 'suppress_client message.client_key', AUTHORITY_MAX_CLIENT_KEY_LENGTH),
    ttl_seconds: ttlSeconds,
    reason: object.reason === undefined ? undefined : expectBoundedString(object.reason, 'suppress_client message.reason', AUTHORITY_MAX_REASON_LENGTH),
  }
}

export function parseAuthorityPresenceSubscribeMessage(
  input: unknown,
  expectedType?: AuthorityPresenceSubscribeMessage['type'],
): AuthorityPresenceSubscribeMessage {
  const object = expectPlainObject(input, 'presence subscribe message')
  expectExactKeys(object, ['type', 'server_names'], 'presence subscribe message')
  const type = expectBoundedString(object.type, 'presence subscribe message.type', 64)
  if (type !== 'subscribe' && type !== 'unsubscribe') {
    throw new AuthorityValidationError('presence subscribe message.type must be "subscribe" or "unsubscribe"')
  }
  if (expectedType && type !== expectedType) {
    throw new AuthorityValidationError(`presence subscribe message.type must be "${expectedType}"`)
  }
  return {
    type,
    server_names: expectArray(
      object.server_names,
      'presence subscribe message.server_names',
      AUTHORITY_MAX_PRESENCE_SUBSCRIPTION_BATCH_SIZE,
    ).map((value, index) => expectBoundedString(value, `presence subscribe message.server_names[${index}]`, AUTHORITY_MAX_SERVER_NAME_LENGTH)),
  }
}

export function parseAuthorityServerRegistration(input: unknown, label = 'server registration'): AuthorityServerRegistration {
  const object = expectPlainObject(input, label)
  expectExactKeys(object, ['server_name', 'auth_mode'], label)

  const authMode = expectBoundedString(object.auth_mode, `${label}.auth_mode`, 32)
  if (!AUTHORITY_ALLOWED_AUTH_MODES.includes(authMode as typeof AUTHORITY_ALLOWED_AUTH_MODES[number])) {
    throw new AuthorityValidationError(`${label}.auth_mode has unsupported value: ${authMode}`)
  }

  return {
    server_name: expectBoundedString(object.server_name, `${label}.server_name`, AUTHORITY_MAX_SERVER_NAME_LENGTH),
    auth_mode: authMode as AuthorityServerRegistration['auth_mode'],
  }
}

export function parseAuthorityClientAuthPayload(input: unknown, label = 'auth payload'): AuthorityClientAuthPayload {
  const object = expectPlainObject(input, label)
  expectExactKeys(object, ['mode', 'credentials'], label)
  const mode = expectBoundedString(object.mode, `${label}.mode`, 32)
  if (!AUTHORITY_ALLOWED_AUTH_MODES.includes(mode as typeof AUTHORITY_ALLOWED_AUTH_MODES[number])) {
    throw new AuthorityValidationError(`${label}.mode has unsupported value: ${mode}`)
  }
  return {
    mode: mode as AuthorityClientAuthPayload['mode'],
    credentials: object.credentials,
  }
}

export function parseAuthorityClientMetadata(input: unknown, label = 'client metadata'): AuthorityClientMetadata {
  const object = expectPlainObject(input, label)
  expectExactKeys(object, ['ip', 'ip_hint', 'request_id', 'user_agent'], label)
  return {
    ip: object.ip === undefined ? undefined : expectBoundedString(object.ip, `${label}.ip`, AUTHORITY_MAX_IP_LENGTH),
    ip_hint: object.ip_hint === undefined ? undefined : expectBoundedString(object.ip_hint, `${label}.ip_hint`, AUTHORITY_MAX_IP_LENGTH),
    request_id: object.request_id === undefined ? undefined : expectBoundedString(object.request_id, `${label}.request_id`, AUTHORITY_MAX_REQUEST_ID_LENGTH),
    user_agent: object.user_agent === undefined ? undefined : expectBoundedString(object.user_agent, `${label}.user_agent`, AUTHORITY_MAX_USER_AGENT_LENGTH),
  }
}

export function parseRTCSessionDescriptionLike(input: unknown, label = 'session description'): RTCSessionDescriptionLike {
  const object = expectPlainObject(input, label)
  expectExactKeys(object, ['type', 'sdp'], label)
  const type = expectBoundedString(object.type, `${label}.type`, 32)
  if (!AUTHORITY_ALLOWED_SESSION_DESCRIPTION_TYPES.includes(type as typeof AUTHORITY_ALLOWED_SESSION_DESCRIPTION_TYPES[number])) {
    throw new AuthorityValidationError(`${label}.type has unsupported value: ${type}`)
  }
  return {
    type: type as RTCSessionDescriptionLike['type'],
    sdp: object.sdp === undefined ? undefined : expectBoundedRawString(object.sdp, `${label}.sdp`, AUTHORITY_MAX_SDP_LENGTH),
  }
}

function expectPlainObject(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AuthorityValidationError(`${label} must be an object`)
  }
  return input as Record<string, unknown>
}

function expectExactKeys(object: Record<string, unknown>, allowedKeys: string[], label: string): void {
  const allowed = new Set(allowedKeys)
  const unknownKeys = Object.keys(object).filter(key => !allowed.has(key))
  if (unknownKeys.length > 0) {
    throw new AuthorityValidationError(`${label} contains unknown field(s): ${unknownKeys.join(', ')}`)
  }
}

function expectBoundedString(input: unknown, label: string, maxLength: number): string {
  if (typeof input !== 'string') {
    throw new AuthorityValidationError(`${label} must be a string`)
  }
  const value = input.trim()
  if (!value) {
    throw new AuthorityValidationError(`${label} must not be empty`)
  }
  if (value.length > maxLength) {
    throw new AuthorityValidationError(`${label} exceeds max length ${maxLength}`)
  }
  return value
}

function expectBoundedRawString(input: unknown, label: string, maxLength: number): string {
  if (typeof input !== 'string') {
    throw new AuthorityValidationError(`${label} must be a string`)
  }
  if (!input.trim()) {
    throw new AuthorityValidationError(`${label} must not be empty`)
  }
  if (input.length > maxLength) {
    throw new AuthorityValidationError(`${label} exceeds max length ${maxLength}`)
  }
  return input
}

function expectArray(input: unknown, label: string, maxLength: number): unknown[] {
  if (!Array.isArray(input)) {
    throw new AuthorityValidationError(`${label} must be an array`)
  }
  if (input.length > maxLength) {
    throw new AuthorityValidationError(`${label} exceeds max length ${maxLength}`)
  }
  return input
}

function expectIntegerInRange(input: unknown, label: string, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isInteger(input)) {
    throw new AuthorityValidationError(`${label} must be an integer`)
  }
  if (input < min || input > max) {
    throw new AuthorityValidationError(`${label} must be between ${min} and ${max}`)
  }
  return input
}

