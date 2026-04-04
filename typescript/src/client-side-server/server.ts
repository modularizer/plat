import { normalizeParameters } from '../server/param-aliases'
import { PLATServerCore } from '../server/core'
import { PLATOperationRegistry } from '../server/operation-registry'
import { HttpError, type RouteContext, type ToolDefinition } from '../types'
import type { OpenAPIInfo } from '../types/openapi'
import type { PLATServerResolvedOperation } from '../server/transports'
import type { ClientSideServerChannel } from './channel'
import type {
  ClientSideServerMessage,
  ClientSideServerRequest,
} from './protocol'

export interface ClientSideServerOptions {
  undecoratedMode?: 'GET' | 'POST' | 'private'
  allowedMethodPrefixes?: '*' | string[]
  disAllowedMethodPrefixes?: string[]
  paramCoercions?: Record<string, string>
  disAllowedParams?: string[]
  serializers?: Record<string, (value: any) => unknown>
  openapiInfo?: OpenAPIInfo
}

export class PLATClientSideServer {
  private routes: Array<{ method: string; path: string; methodName?: string }> = []
  private toolsStore = new Map<string, ToolDefinition>()
  private operationRegistry = new PLATOperationRegistry()
  private registeredMethodNames = new Set<string>()
  private registeredControllerNames = new Set<string>()
  private core: PLATServerCore
  private openapiCache?: Record<string, any>

  constructor(
    private options: ClientSideServerOptions = {},
    ...ControllerClasses: (new () => any)[]
  ) {
    this.core = new PLATServerCore({
      undecoratedMode: options.undecoratedMode,
      allowedMethodPrefixes: options.allowedMethodPrefixes,
      disAllowedMethodPrefixes: options.disAllowedMethodPrefixes,
    }, {
      routes: this.routes,
      tools: this.toolsStore,
      operationRegistry: this.operationRegistry,
      registeredMethodNames: this.registeredMethodNames,
      registeredControllerNames: this.registeredControllerNames,
    })

    if (ControllerClasses.length > 0) {
      this.register(...ControllerClasses)
    }
  }

  register(...ControllerClasses: (new () => any)[]): this {
    this.core.registerControllers(...ControllerClasses)
    this.openapiCache = undefined
    return this
  }

  get tools(): ToolDefinition[] {
    return Array.from(this.toolsStore.values())
  }

  get openapi(): Record<string, any> {
    if (!this.openapiCache) {
      this.openapiCache = this.generateOpenAPISpec()
    }
    return this.openapiCache
  }

  async handleMessage(
    message: ClientSideServerMessage,
    channel: ClientSideServerChannel,
  ): Promise<void> {
    if (!isRequestMessage(message) || message.cancel) {
      return
    }

    if (message.method.toUpperCase() === 'GET' && message.path === '/openapi.json') {
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: true,
        result: this.openapi,
      })
      return
    }

    if (message.method.toUpperCase() === 'GET' && message.path === '/tools') {
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: true,
        result: this.tools,
      })
      return
    }

    const operation = this.operationRegistry.resolve({
      operationId: message.operationId,
      method: message.method,
      path: message.path,
    })

    if (!operation) {
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: false,
        error: {
          status: 404,
          message: `Client-side server operation not found for ${message.method} ${message.path}`,
        },
      })
      return
    }

    try {
      const result = await this.executeOperation(operation, message, channel)
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: true,
        result: this.serializeValue(result),
      })
    } catch (error: any) {
      const status = error instanceof HttpError ? error.statusCode : 500
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: false,
        error: {
          status,
          message: error?.message ?? 'Internal client-side server error',
          data: error instanceof HttpError ? error.data : undefined,
        },
      })
    }
  }

  serveChannel(channel: ClientSideServerChannel): () => void {
    return channel.subscribe((message) => void this.handleMessage(message, channel))
  }

  private async executeOperation(
    operation: PLATServerResolvedOperation,
    request: ClientSideServerRequest,
    channel: ClientSideServerChannel,
  ): Promise<unknown> {
    const normalizedInput = normalizeParameters(
      typeof request.input === 'object' && request.input !== null
        ? request.input as Record<string, any>
        : {},
      this.options.paramCoercions,
      this.options.disAllowedParams,
    )

    const ctx: RouteContext = {
      method: operation.method,
      url: operation.path,
      headers: request.headers ?? {},
      opts: operation.routeMeta?.opts,
    }

    ctx.call = {
      id: request.id,
      mode: 'rpc',
      emit: async (event, data) => {
        await channel.send({
          jsonrpc: '2.0',
          id: request.id,
          ok: true,
          event,
          data: this.serializeValue(data),
        })
      },
      progress: async (data) => await ctx.call?.emit('progress', data),
      log: async (data) => await ctx.call?.emit('log', data),
      chunk: async (data) => await ctx.call?.emit('chunk', data),
      cancelled: () => false,
    }
    ctx.rpc = ctx.call

    return await operation.boundMethod(normalizedInput, ctx)
  }

  private serializeValue(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map((item) => this.serializeValue(item))
    if (value && typeof value === 'object') {
      for (const [typeName, serializer] of Object.entries(this.options.serializers ?? {})) {
        if ((value as any).constructor?.name === typeName) {
          return this.serializeValue(serializer(value))
        }
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.serializeValue(item)]),
      )
    }
    return value
  }

  private generateOpenAPISpec(): Record<string, any> {
    const paths: Record<string, any> = {}

    for (const tool of this.toolsStore.values()) {
      const method = tool.method.toLowerCase()
      const path = tool.path
      const operation: Record<string, any> = {
        operationId: tool.name,
        summary: tool.summary || tool.description,
        tags: tool.tags,
        responses: {
          '200': {
            description: 'Successful response',
            ...(tool.response_schema ? {
              content: { 'application/json': { schema: tool.response_schema } },
            } : {}),
          },
        },
      }

      const inputSchema = tool.input_schema
      if (inputSchema && Object.keys(inputSchema.properties ?? {}).length > 0) {
        if (method === 'get' || method === 'head' || method === 'delete') {
          operation.parameters = Object.entries(inputSchema.properties as Record<string, any>).map(
            ([name, schema]: [string, any]) => ({
              name,
              in: 'query',
              required: (inputSchema.required as string[] ?? []).includes(name),
              schema,
            }),
          )
        } else {
          operation.requestBody = {
            required: true,
            content: {
              'application/json': { schema: inputSchema },
            },
          }
        }
      }

      paths[path] = { ...(paths[path] ?? {}), [method]: operation }
    }

    return {
      openapi: '3.1.0',
      info: this.options.openapiInfo ?? {
        title: 'plat client-side server',
        version: '0.3.0',
      },
      paths,
    }
  }
}

function isRequestMessage(message: ClientSideServerMessage): message is ClientSideServerRequest {
  return 'method' in message && 'path' in message
}

export function createClientSideServer(
  options?: ClientSideServerOptions,
  ...ControllerClasses: (new () => any)[]
): PLATClientSideServer {
  return new PLATClientSideServer(options, ...ControllerClasses)
}
