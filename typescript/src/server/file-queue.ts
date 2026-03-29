export interface PLATFileQueueRequest {
  id: string
  operationId?: string
  method: string
  path: string
  headers?: Record<string, string>
  input?: Record<string, any>
}

export interface PLATFileQueueSuccessResponse {
  id: string
  ok: true
  result: unknown
  statusCode: number
}

export interface PLATFileQueueErrorResponse {
  id: string
  ok: false
  error: {
    status?: number
    message: string
    data?: unknown
  }
}

export type PLATFileQueueResponse = PLATFileQueueSuccessResponse | PLATFileQueueErrorResponse
