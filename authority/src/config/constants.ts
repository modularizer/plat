export const AUTHORITY_CONNECT_TIMEOUT_MS = 15_000
export const AUTHORITY_HOST_RESPONSE_TIMEOUT_MS = 10_000
export const AUTHORITY_PENDING_CONNECTION_TTL_MS = 20_000

export const AUTHORITY_CONNECT_BODY_LIMIT_BYTES = 64 * 1024
export const AUTHORITY_CONNECT_BODY_HARD_MAX_BYTES = 128 * 1024
export const AUTHORITY_HOST_WS_FRAME_LIMIT_BYTES = 128 * 1024
export const AUTHORITY_PRESENCE_WS_FRAME_LIMIT_BYTES = 8 * 1024

export type AuthorityLoadLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'

export interface AuthorityRateWindow {
  burstPer30Seconds: number
  sustainedPer10Minutes: number
}

export const AUTHORITY_CONNECT_RATE_LEVELS: Record<AuthorityLoadLevel, AuthorityRateWindow> = {
  L0: { burstPer30Seconds: 500, sustainedPer10Minutes: 10_000 },
  L1: { burstPer30Seconds: 250, sustainedPer10Minutes: 5_000 },
  L2: { burstPer30Seconds: 100, sustainedPer10Minutes: 1_500 },
  L3: { burstPer30Seconds: 40, sustainedPer10Minutes: 400 },
  L4: { burstPer30Seconds: 10, sustainedPer10Minutes: 60 },
}

export const AUTHORITY_REJECTION_REASONS = [
  'server_offline',
  'unauthorized',
  'rejected',
  'timed_out',
  'rate_limited',
  'malformed',
] as const

