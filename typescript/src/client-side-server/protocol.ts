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

export type ClientSideServerResponse =
  | ClientSideServerSuccessResponse
  | ClientSideServerErrorResponse

export type ClientSideServerMessage =
  | ClientSideServerRequest
  | ClientSideServerResponse
  | ClientSideServerEventMessage
