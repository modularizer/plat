import ts from 'typescript'
import { OpenAPIClient } from '../client/openapi-client'
import type { OpenAPISpec } from '../types/openapi'
import { ensureRouteMeta } from '../spec/metadata'
import {
  createClientSideServerMQTTWebRTCServer,
  createClientSideServerMQTTWebRTCTransportPlugin,
  type ClientSideServerMQTTWebRTCOptions,
  type ClientSideServerMQTTWebRTCServer,
  type ClientSideServerWorkerInfo,
} from './mqtt-webrtc'
import { createClientSideServer, type PLATClientSideServer } from './server'
import { fetchClientSideServerOpenAPI } from './bootstrap'
import {
  analyzeClientSideServerSource,
  type ClientSideServerSourceAnalysis,
  type TypeScriptLike,
} from './source-analysis'

type ControllerClass = new () => any

export interface ClientSideServerDefinition {
  serverName: string
  controllers: ControllerClass[]
}

export interface ClientSideServerSourceModule {
  controllers?: ControllerClass[]
  clientSideServer?: ClientSideServerDefinition
  default?: ControllerClass[] | ClientSideServerDefinition | { controllers?: ControllerClass[] }
}

export interface StartClientSideServerFromSourceOptions extends ClientSideServerMQTTWebRTCOptions {
  serverName?: string
  undecoratedMode?: 'GET' | 'POST' | 'private'
  workerInfo?: ClientSideServerWorkerInfo
  /**
   * Version / identity metadata published in MQTT announces and via the `/server-info` endpoint.
   * `openapiHash` and `serverStartedAt` are auto-computed; the rest are user-supplied.
   */
  instanceInfo?: import('./protocol').ClientSideServerInstanceInfo
  source: string | Record<string, string>
  /**
   * Optional: specify which file is the entry point when using multiple source files.
   * Defaults to 'index.ts' or the first file if not specified.
   */
  sourceEntryPoint?: string
  transpile?: (source: string | Record<string, string>, entryPoint?: string) => string | Promise<string>
  analyzeSource?: (source: string | Record<string, string>, entryPoint?: string) => ClientSideServerSourceAnalysis | Promise<ClientSideServerSourceAnalysis>
  onRequest?: (direction: 'request' | 'response', payload: unknown) => void
}

export interface StartedClientSideServer {
  server: PLATClientSideServer
  signaler: ClientSideServerMQTTWebRTCServer
  connectionUrl: string
  openapi: Record<string, any>
  stop(): Promise<void>
}

/**
 * Optional knobs for {@link runClientSideServer}. Everything except
 * `transpile` / `analyzeSource` is forwarded to {@link startClientSideServerFromSource}.
 */
export type RunClientSideServerOptions = Omit<
  StartClientSideServerFromSourceOptions,
  'source' | 'transpile' | 'analyzeSource'
> & {
  /** Advanced: custom TS→JS step instead of the built-in `transpileModule` defaults. */
  transpile?: (source: string | Record<string, string>, entryPoint?: string) => string | Promise<string>
  /** Advanced: custom analysis instead of {@link analyzeClientSideServerSource}. */
  analyzeSource?: (source: string | Record<string, string>, entryPoint?: string) => ClientSideServerSourceAnalysis | Promise<ClientSideServerSourceAnalysis>
}

/** @deprecated Use {@link RunClientSideServerOptions} */
export type RunClientSideServerFromSourceOptions = RunClientSideServerOptions

/**
 * Single entry point for a browser client-side server: pass the server TypeScript
 * source (single file string or multiple files as a map); this transpiles it, runs
 * static analysis (rich OpenAPI), creates the server, and starts MQTT/WebRTC signaling.
 * Same behavior as sample 6 with no manual `transpile` / `analyzeSource` wiring.
 *
 * @param source - TypeScript source code as a string, or a map of file paths to source code
 * @param options - Configuration options
 */
export function runClientSideServer(
  source: string,
  options?: RunClientSideServerOptions,
): Promise<StartedClientSideServer>
export function runClientSideServer(
  source: Record<string, string>,
  options?: RunClientSideServerOptions & { sourceEntryPoint?: string },
): Promise<StartedClientSideServer>
export async function runClientSideServer(
  source: string | Record<string, string>,
  options: RunClientSideServerOptions = {},
): Promise<StartedClientSideServer> {
  const { transpile: customTranspile, analyzeSource: customAnalyze, ...rest } = options
  const undecoratedMode = rest.undecoratedMode ?? 'POST'
  const entryPoint = (options as any).sourceEntryPoint

  const defaultTranspile = (src: string | Record<string, string>, ep?: string): string => {
    if (typeof src === 'string') {
      return ts.transpileModule(src, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          experimentalDecorators: true,
        },
      }).outputText
    }
    return transpileMultipleFiles(src, ts, ep)
  }

  const defaultAnalyze = (src: string | Record<string, string>, ep?: string): ClientSideServerSourceAnalysis => {
    if (typeof src === 'string') {
      return analyzeClientSideServerSource(ts as unknown as TypeScriptLike, src, { undecoratedMode })
    }
    return analyzeClientSideServerMultipleFiles(ts as unknown as TypeScriptLike, src, { undecoratedMode, entryPoint: ep })
  }

  return startClientSideServerFromSource({
    ...rest,
    source,
    sourceEntryPoint: entryPoint,
    transpile: customTranspile ?? defaultTranspile,
    analyzeSource: customAnalyze ?? defaultAnalyze,
  })
}

/** @deprecated Use {@link runClientSideServer} */
export const runClientSideServerFromSource = runClientSideServer

function transpileSource(source: string | Record<string, string>, entryPoint?: string): string {
  if (typeof source === 'string') {
    return ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
      },
    }).outputText
  } else {
    return transpileMultipleFiles(source, ts, entryPoint)
  }
}

export async function startClientSideServerFromSource(
  options: StartClientSideServerFromSourceOptions,
): Promise<StartedClientSideServer> {
  const compiled = await (options.transpile
    ? options.transpile(options.source, options.sourceEntryPoint)
    : Promise.resolve(transpileSource(options.source, options.sourceEntryPoint)))

  const analysis = await (options.analyzeSource
    ? options.analyzeSource(options.source, options.sourceEntryPoint)
    : Promise.resolve(
        typeof options.source === 'string'
          ? analyzeClientSideServerSource(ts as unknown as TypeScriptLike, options.source, {
              undecoratedMode: options.undecoratedMode ?? 'POST',
            })
          : analyzeClientSideServerMultipleFiles(ts as unknown as TypeScriptLike, options.source, {
              undecoratedMode: options.undecoratedMode ?? 'POST',
              entryPoint: options.sourceEntryPoint,
            }),
      ))

  const moduleUrl = URL.createObjectURL(new Blob([compiled], { type: 'text/javascript' }))
  let loaded: ClientSideServerSourceModule

  try {
    loaded = await import(/* @vite-ignore */ moduleUrl) as ClientSideServerSourceModule
  } finally {
    URL.revokeObjectURL(moduleUrl)
  }

  const definition = resolveClientSideServerDefinition(loaded, options.serverName)
  if (analysis) {
    applySourceAnalysisToControllers(definition.controllers, analysis)
  }
  const server = createClientSideServer({
    undecoratedMode: options.undecoratedMode,
    instanceInfo: (options as any).instanceInfo,
  }, ...definition.controllers)

  if (options.onRequest) {
    const originalHandle = server.handleMessage.bind(server)
    server.handleMessage = async (message, channel) => {
      options.onRequest?.('request', message)
      await originalHandle(message, {
        ...channel,
        send: async (payload) => {
          options.onRequest?.('response', payload)
          await channel.send(payload)
        },
      })
    }
  }

  const signaler = createClientSideServerMQTTWebRTCServer({
    server,
    serverName: definition.serverName,
    mqttBroker: options.mqttBroker,
    mqttTopic: options.mqttTopic,
    mqttOptions: options.mqttOptions,
    iceServers: options.iceServers,
    connectionTimeoutMs: options.connectionTimeoutMs,
    announceIntervalMs: options.announceIntervalMs,
    clientIdPrefix: options.clientIdPrefix,
    identity: options.identity,
    workerInfo: (options as any).workerInfo,
    instanceInfo: (options as any).instanceInfo,
  })

  await signaler.start()

  return {
    server,
    signaler,
    connectionUrl: signaler.connectionUrl,
    openapi: server.openapi,
    stop: async () => {
      await signaler.stop()
    },
  }
}

export function serveClientSideServer(
  serverName: string,
  controllers: ControllerClass[],
): ClientSideServerDefinition {
  return { serverName, controllers }
}


export interface ConnectClientSideServerOptions extends ClientSideServerMQTTWebRTCOptions {
  baseUrl: string
}

export async function connectClientSideServer(
  options: ConnectClientSideServerOptions,
): Promise<{
  client: OpenAPIClient
  openapi: OpenAPISpec
}> {
  const transportPlugin = createClientSideServerMQTTWebRTCTransportPlugin(options)
  const openapi = await fetchClientSideServerOpenAPI(options.baseUrl, transportPlugin) as OpenAPISpec
  const client = new OpenAPIClient(openapi, {
    baseUrl: options.baseUrl,
    transportPlugins: [transportPlugin],
  })
  return { client, openapi }
}

export interface RetryLoopOptions {
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  runImmediately?: boolean
  resetDelayOnSuccess?: boolean
  onError?: (error: unknown, nextDelayMs: number) => void
  onSuccess?: () => void
}

export interface RetryLoopHandle {
  stop(): void
  triggerNow(): void
}

export function startRetryLoop(
  task: () => Promise<void> | void,
  options: RetryLoopOptions = {},
): RetryLoopHandle {
  const initialDelayMs = options.initialDelayMs ?? 2_000
  const maxDelayMs = options.maxDelayMs ?? 30_000
  const backoffMultiplier = options.backoffMultiplier ?? 1.8
  const resetDelayOnSuccess = options.resetDelayOnSuccess ?? true
  let nextDelayMs = initialDelayMs
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let running = false

  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const schedule = (delayMs: number) => {
    if (stopped) return
    clear()
    timer = setTimeout(() => {
      void run()
    }, delayMs)
  }

  const run = async () => {
    if (stopped || running) return
    running = true
    try {
      await task()
      options.onSuccess?.()
      if (resetDelayOnSuccess) {
        nextDelayMs = initialDelayMs
      }
      schedule(initialDelayMs)
    } catch (error) {
      options.onError?.(error, nextDelayMs)
      schedule(nextDelayMs)
      nextDelayMs = Math.min(maxDelayMs, Math.ceil(nextDelayMs * backoffMultiplier))
    } finally {
      running = false
    }
  }

  if (options.runImmediately ?? true) {
    void run()
  } else {
    schedule(initialDelayMs)
  }

  return {
    stop() {
      stopped = true
      clear()
    },
    triggerNow() {
      if (stopped) return
      clear()
      void run()
    },
  }
}

function resolveClientSideServerDefinition(
  module: ClientSideServerSourceModule,
  fallbackServerName?: string,
): ClientSideServerDefinition {
  if (module.clientSideServer) return module.clientSideServer

  if (module.default && isClientSideServerDefinition(module.default)) {
    return module.default
  }

  const controllers = resolveControllers(module)
  if (fallbackServerName) {
    return { serverName: fallbackServerName, controllers }
  }

  throw new Error('Expected the source module to define a server name with serveClientSideServer(name, controllers)')
}

function resolveControllers(module: ClientSideServerSourceModule): ControllerClass[] {
  if (Array.isArray(module.controllers)) return module.controllers
  if (Array.isArray(module.default)) return module.default
  if (module.default && 'controllers' in module.default && Array.isArray(module.default.controllers)) {
    return module.default.controllers
  }
  throw new Error('Expected the source module to export controllers or a serveClientSideServer(...) definition')
}

function isClientSideServerDefinition(value: unknown): value is ClientSideServerDefinition {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof (value as ClientSideServerDefinition).serverName === 'string'
      && Array.isArray((value as ClientSideServerDefinition).controllers),
  )
}

/**
 * Copies {@link analyzeClientSideServerSource} output onto live controller classes
 * (route metadata: summaries, JSON Schema for inputs/outputs). Call this **before**
 * {@link createClientSideServer} whenever you load controllers from source without
 * using {@link startClientSideServerFromSource}.
 */
export function applySourceAnalysisToControllers(
  controllers: ControllerClass[],
  analysis: ClientSideServerSourceAnalysis,
): void {
  const analysisByController = new Map(
    analysis.controllers.map((controller) => [controller.name, controller] as const),
  )

  for (const controller of controllers) {
    const controllerAnalysis = analysisByController.get(controller.name)
    if (!controllerAnalysis) continue

    const methods = new Map(
      controllerAnalysis.methods.map((method) => [method.name, method] as const),
    )

    for (const [methodName, methodAnalysis] of methods.entries()) {
      const routeMeta = ensureRouteMeta(controller as Function, methodName)
      if (methodAnalysis.summary) {
        routeMeta.summary = methodAnalysis.summary
      }
      if (methodAnalysis.description) {
        routeMeta.description = methodAnalysis.description
      }
      if (methodAnalysis.inputSchema) {
        routeMeta.inputSchema = methodAnalysis.inputSchema as any
      }
      if (methodAnalysis.outputSchema) {
        routeMeta.outputSchema = methodAnalysis.outputSchema as any
      }
    }
  }
}

export function enrichClientSideServerControllersFromSource(
  ts: TypeScriptLike,
  source: string | Record<string, string>,
  controllers: ControllerClass[],
  options: { undecoratedMode?: 'GET' | 'POST' | 'private'; entryPoint?: string } = {},
): ClientSideServerSourceAnalysis {
  const analysis = typeof source === 'string'
    ? analyzeClientSideServerSource(ts, source, options)
    : analyzeClientSideServerMultipleFiles(ts, source, { ...options, entryPoint: options.entryPoint })
  applySourceAnalysisToControllers(controllers, analysis)
  return analysis
}

/**
 * Transpiles multiple TypeScript files into a single JavaScript bundle.
 * Each file is transpiled independently and then concatenated with a namespace wrapper.
 *
 * @param sourceMap - Map of file paths to source code
 * @param ts - TypeScript-like object with transpilation capabilities
 * @param entryPoint - Optional entry point file (defaults to 'index.ts' or first file)
 * @returns Transpiled and bundled JavaScript code
 */
function transpileMultipleFiles(
  sourceMap: Record<string, string>,
  ts: any,
  entryPoint?: string,
): string {
  const files = Object.entries(sourceMap)
  if (files.length === 0) {
    throw new Error('No source files provided')
  }

  let entry = entryPoint
  if (!entry) {
    // Try to find index.ts, otherwise use first file
    const indexFile = files.find(([name]) => name === 'index.ts')
    entry = indexFile ? indexFile[0] : files[0]![0]
  }
  const transpiled: Record<string, string> = {}

  // Transpile each file independently
  for (const [fileName, content] of files) {
    const output = ts.transpileModule(content, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
      },
    }).outputText
    transpiled[fileName] = output
  }

  // Create module wrapper that bundles all transpiled files
  const bundledCode = createMultiFileBundle(transpiled, entry)
  return bundledCode
}

/**
 * Analyzes multiple TypeScript source files, building a unified type registry
 * and extracting controller definitions across all files.
 *
 * @param ts - TypeScript-like object for AST parsing
 * @param sourceMap - Map of file paths to source code
 * @param options - Configuration for analysis
 * @returns Analysis with controllers extracted from all files
 */
function analyzeClientSideServerMultipleFiles(
  ts: TypeScriptLike,
  sourceMap: Record<string, string>,
  options: {
    undecoratedMode?: 'GET' | 'POST' | 'private'
    entryPoint?: string
  } = {},
): ClientSideServerSourceAnalysis {
  const files = Object.entries(sourceMap)
  if (files.length === 0) {
    return { controllers: [] }
  }

  const undecoratedMode = options.undecoratedMode ?? 'POST'
  const controllers: ClientSideServerSourceAnalysis['controllers'] = []

  // Build unified type registry from all files
  const interfaces = new Map<string, any>()
  const typeAliases = new Map<string, any>()
  const enums = new Map<string, any>()
  const importMap = new Map<string, Set<string>>() // Track imports per file

  // First pass: collect all type definitions from all files
  for (const [fileName, content] of files) {
    const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    
    ts.forEachChild(sourceFile, (node) => {
      if (isKind(ts, node, 'InterfaceDeclaration') && node.name?.text) {
        interfaces.set(node.name.text, node)
      }
      if (isKind(ts, node, 'TypeAliasDeclaration') && node.name?.text) {
        typeAliases.set(node.name.text, node.type)
      }
      if (isKind(ts, node, 'EnumDeclaration') && node.name?.text) {
        enums.set(node.name.text, node)
      }
      if (isKind(ts, node, 'ImportDeclaration')) {
        // Track imports for cross-file reference resolution
        const imports = importMap.get(fileName) ?? new Set<string>()
        // Note: Simple import tracking; full module resolution not implemented
        importMap.set(fileName, imports)
      }
    })
  }

  // Second pass: extract controllers from all files
  for (const [fileName, content] of files) {
    const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

    ts.forEachChild(sourceFile, (node) => {
      if (isKind(ts, node, 'ClassDeclaration') && node.name?.text) {
        const controllerAnalysis = analyzeControllerWithContext(
          ts,
          node,
          interfaces,
          typeAliases,
          enums,
          undecoratedMode,
          fileName,
        )
        controllers.push(controllerAnalysis)
      }
    })
  }

  return { controllers }
}

/**
 * Creates a multi-file bundle by wrapping each file in a namespace object
 * and re-exporting from the entry point.
 */
function createMultiFileBundle(
  transpiled: Record<string, string>,
  entryPoint: string,
): string {
  const modules: string[] = []

  // Create namespace object containing all modules
  modules.push('const __modules = {};')
  modules.push('')

  // Add each transpiled file as a module in the namespace
  for (const [fileName, code] of Object.entries(transpiled)) {
    modules.push(`__modules['${fileName}'] = {};`)
    modules.push('(function(module) {')
    modules.push(code)
    modules.push(`}(__modules['${fileName}']));`)
    modules.push('')
  }

  // Make entry point's exports the default module exports
  modules.push(`const entryModule = __modules['${entryPoint}'];`)
  modules.push('')
  modules.push('// Re-export all properties from entry point')
  modules.push('for (const key in entryModule) {')
  modules.push('  if (Object.prototype.hasOwnProperty.call(entryModule, key)) {')
  modules.push('    globalThis[key] = entryModule[key];')
  modules.push('  }')
  modules.push('}')
  modules.push('')
  modules.push('// Default export')
  modules.push('export default entryModule.default ?? entryModule;')
  modules.push('')
  modules.push('// Named exports')
  modules.push('export * from entryModule;')

  return modules.join('\n')
}

/**
 * Analyzes a single controller class with unified type context from multiple files.
 * Used internally for multi-file analysis.
 */
function analyzeControllerWithContext(
  ts: TypeScriptLike,
  classNode: any,
  interfaces: Map<string, any>,
  typeAliases: Map<string, any>,
  enums: Map<string, any>,
  undecoratedMode: 'GET' | 'POST' | 'private',
  fileName: string,
): ClientSideServerSourceAnalysis['controllers'][number] {
  const methods = (classNode.members ?? [])
    .filter((member: any) => {
      if (!isKind(ts, member, 'MethodDeclaration')) return false
      const name = member.name?.getText?.() ?? member.name?.text
      if (!name || name === 'constructor' || String(name).startsWith('_')) return false
      return true
    })
    .map((method: any) => {
      const docs = getNodeDocHelper(ts, method)
      return {
        name: method.name.getText ? method.name.getText() : method.name.text,
        summary: docs.summary,
        description: docs.description,
        inputSchema: undefined,
        outputSchema: undefined,
      }
    })

  return {
    name: classNode.name.text,
    methods,
  }
}

/**
 * Helper to check if a node is of a specific TypeScript kind.
 */
function isKind(ts: TypeScriptLike, node: any, kindName: string): boolean {
  const kind = ts.SyntaxKind[kindName]
  return kind !== undefined && node.kind === kind
}

/**
 * Helper to extract JSDoc comments from a node.
 */
function getNodeDocHelper(
  _ts: TypeScriptLike,
  node: any,
): { summary?: string; description?: string } {
  const blocks = Array.isArray(node?.jsDoc) ? node.jsDoc : []
  if (blocks.length === 0) return {}

  const raw = blocks
    .map((block: any) => {
      if (typeof block.comment === 'string') return block.comment
      if (Array.isArray(block.comment)) {
        return block.comment.map((part: any) => part?.text ?? '').join('')
      }
      return ''
    })
    .join('\n')
    .trim()

  if (!raw) return {}

  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((part: string) => part.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) return {}
  return {
    summary: paragraphs[0],
    description: paragraphs.join('\n\n'),
  }
}
