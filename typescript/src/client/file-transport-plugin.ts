import type {
  OpenAPIClientTransportOutcome,
  OpenAPIClientTransportPlugin,
  OpenAPIClientTransportRequest,
} from './transport-plugin'

interface FileTransportRuntime {
  nextRequestId(prefix: string): string
  stringifyHeaders(headers: Record<string, string | number | boolean | undefined>): Record<string, string>
  parseJson(text: string): unknown
  delay(ms: number): Promise<void>
  fileQueue?: {
    resolvePaths(): Promise<{ inbox: string; outbox: string }> | { inbox: string; outbox: string }
    pollIntervalMs: number
    mkdir(path: string): Promise<void>
    write(path: string, content: string): Promise<void>
    read(path: string): Promise<string>
  }
}

interface FileConnection {
  responsePath: string
  eventsPath: string
  seenEvents: number
}

export function createFileTransportPlugin(runtime: FileTransportRuntime): OpenAPIClientTransportPlugin<FileConnection> {
  return {
    name: 'file',
    canHandle: ({ transportMode }) => transportMode === 'file',
    async connect(request: OpenAPIClientTransportRequest): Promise<FileConnection> {
      if (!runtime.fileQueue) {
        throw new Error('File transport runtime is not configured')
      }
      const { inbox, outbox } = await runtime.fileQueue.resolvePaths()
      await runtime.fileQueue.mkdir(inbox)
      await runtime.fileQueue.mkdir(outbox)
      return {
        responsePath: `${outbox}/${request.id}.response.json`,
        eventsPath: `${outbox}/${request.id}.events.jsonl`,
        seenEvents: 0,
      }
    },
    async sendRequest(connection: FileConnection, request: OpenAPIClientTransportRequest): Promise<void> {
      if (!runtime.fileQueue) {
        throw new Error('File transport runtime is not configured')
      }
      const { inbox } = await runtime.fileQueue.resolvePaths()
      await runtime.fileQueue.write(
        `${inbox}/${request.id}.json`,
        JSON.stringify({
          id: request.id,
          operationId: request.operationId,
          method: request.method,
          path: request.path,
          headers: runtime.stringifyHeaders(request.headers),
          input: request.params,
        }, null, 2),
      )
    },
    async getUpdate(connection: FileConnection, request: OpenAPIClientTransportRequest) {
      if (!runtime.fileQueue) return null
      while (true) {
        try {
          const eventsRaw = await runtime.fileQueue.read(connection.eventsPath)
          const lines = eventsRaw.split('\n').filter(Boolean)
          const line = lines[connection.seenEvents]
          if (line) {
            const payload = runtime.parseJson(line) as { id?: string; event?: any; data?: unknown }
            if (payload?.event) {
              connection.seenEvents += 1
              return { id: payload.id ?? request.id, event: payload.event, data: payload.data }
            }
          }
        } catch {}
        return null
      }
    },
    async getResult(connection: FileConnection, request: OpenAPIClientTransportRequest): Promise<OpenAPIClientTransportOutcome> {
      if (!runtime.fileQueue) {
        return { id: request.id, ok: false, error: new Error('File transport runtime is not configured') }
      }
      while (true) {
        const update = await this.getUpdate?.(connection, request)
        if (update) {
          await request.onEvent?.({ id: update.id, event: update.event as any, data: update.data })
          continue
        }
        try {
          const response = runtime.parseJson(await runtime.fileQueue.read(connection.responsePath)) as
            | { ok: true; result: unknown }
            | { ok: false; error?: { message?: string } }
          if (response?.ok) return { id: request.id, ok: true, result: response.result }
          if (response && response.ok === false) {
            return { id: request.id, ok: false, error: new Error(response.error?.message ?? 'File transport request failed') }
          }
        } catch (error) {
          if (!(error instanceof Error) || !/ENOENT/.test(error.message)) {
            throw error
          }
        }
        await runtime.delay(runtime.fileQueue.pollIntervalMs)
      }
    },
  }
}
