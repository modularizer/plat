import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { HttpError, type RouteContext } from '../types'
import type { PLATServerProtocolPlugin, PLATServerTransportRuntime } from './protocol-plugin'
import type { PLATFileQueueRequest, PLATFileQueueResponse } from './file-queue'
import type { FileQueueOptions } from './config/types'

export interface FileQueueProtocolPluginOptions {
  config: FileQueueOptions | false | undefined
}

export function createFileQueueProtocolPlugin(options: FileQueueProtocolPluginOptions): PLATServerProtocolPlugin {
  if (!options.config || typeof options.config !== 'object') {
    return { name: 'file' }
  }
  const config = options.config

  let runtime: PLATServerTransportRuntime | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let busy = false

  async function archiveRequest(sourcePath: string): Promise<void> {
    if (config.archive === false) {
      await rm(sourcePath, { force: true })
      return
    }
    if (typeof config.archive === 'string') {
      await rename(sourcePath, join(config.archive, basename(sourcePath)))
      return
    }
    await rm(sourcePath, { force: true })
  }

  async function processOnce(): Promise<void> {
    if (!runtime || busy) return
    busy = true
    try {
      await mkdir(config.inbox, { recursive: true })
      await mkdir(config.outbox, { recursive: true })
      if (config.archive && typeof config.archive === 'string') {
        await mkdir(config.archive, { recursive: true })
      }

      const files = (await readdir(config.inbox))
        .filter((name) => name.endsWith('.json'))
        .sort()

      for (const name of files) {
        const sourcePath = join(config.inbox, name)
        let request: PLATFileQueueRequest
        try {
          request = JSON.parse(await readFile(sourcePath, 'utf8')) as PLATFileQueueRequest
        } catch (error: any) {
          const invalidResponse: PLATFileQueueResponse = {
            id: basename(name, '.json'),
            ok: false,
            error: { status: 400, message: error?.message ?? 'Invalid file queue request' },
          }
          await writeFile(
            join(config.outbox, `${basename(name, '.json')}.response.json`),
            JSON.stringify(invalidResponse, null, 2),
          )
          await rm(sourcePath, { force: true })
          continue
        }

        const operation = runtime.resolveOperation({
          operationId: request.operationId,
          method: request.method,
          path: request.path,
        })

        if (!operation) {
          const notFoundResponse: PLATFileQueueResponse = {
            id: request.id,
            ok: false,
            error: { status: 404, message: `Operation not found for ${request.method} ${request.path}` },
          }
          await writeFile(
            join(config.outbox, `${request.id}.response.json`),
            JSON.stringify(notFoundResponse, null, 2),
          )
          await archiveRequest(sourcePath)
          continue
        }

        const eventsPath = join(config.outbox, `${request.id}.events.jsonl`)
        const normalizedInput = runtime.normalizeInput(request.input ?? {})

        const rt = runtime
        if (!rt) break

        const ctx: RouteContext = {
          method: request.method,
          url: request.path,
          headers: request.headers ?? {},
          opts: operation.routeMeta?.opts,
        }

        const abortController = new AbortController()
        rt.createCallContext({
          ctx,
          sessionId: request.id,
          mode: 'deferred',
          signal: abortController.signal,
          emit: async (event: 'progress' | 'log' | 'chunk' | 'message', data?: unknown) => {
            await writeFile(
              eventsPath,
              `${JSON.stringify({ id: request.id, event, data: rt.serializeValue(data) })}\n`,
              { flag: 'a' },
            )
          },
        })

        try {
          const envelope = rt.createEnvelope({
            protocol: 'file',
            operation,
            input: normalizedInput,
            headers: request.headers ?? {},
            ctx,
            requestId: request.id,
            req: { headers: request.headers ?? {} },
            allowHelp: false,
            helpRequested: false,
          })

          const execution = await rt.dispatch(operation, envelope)
          const response: PLATFileQueueResponse = {
            id: request.id,
            ok: true,
            result: rt.serializeValue(execution.result),
            statusCode: execution.statusCode,
          }
          await writeFile(
            join(config.outbox, `${request.id}.response.json`),
            JSON.stringify(response, null, 2),
          )
        } catch (error: any) {
          const status = error instanceof HttpError ? error.statusCode : 500
          const response: PLATFileQueueResponse = {
            id: request.id,
            ok: false,
            error: {
              status,
              message: error?.message ?? 'Internal server error',
              data: error instanceof HttpError ? error.data : undefined,
            },
          }
          await writeFile(
            join(config.outbox, `${request.id}.response.json`),
            JSON.stringify(response, null, 2),
          )
        }

        await archiveRequest(sourcePath)
      }
    } finally {
      busy = false
    }
  }

  return {
    name: 'file',

    setup(rt: PLATServerTransportRuntime) {
      runtime = rt
    },

    start() {
      if (!config || timer) return
      const pollIntervalMs = config.pollIntervalMs ?? 250
      void processOnce()
      timer = setInterval(() => { void processOnce() }, pollIntervalMs)
    },

    teardown() {
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }
      runtime = undefined
    },
  }
}
