import { PYTHON_BROWSER_SOURCES } from '../generated/python-browser-sources'
import {
  createClientSideServerMQTTWebRTCServer,
  createClientSideServerMQTTWebRTCTransportPlugin,
  type ClientSideServerIdentityOptions,
  type ClientSideServerMQTTWebRTCOptions,
  type ClientSideServerMQTTWebRTCServer,
} from '../client-side-server/mqtt-webrtc'
import { createFetchClientSideServerAuthorityServer } from '../client-side-server/identity'
import { fetchClientSideServerOpenAPI } from '../client-side-server/bootstrap'
import { OpenAPIClient } from '../client/openapi-client'
import type { OpenAPIClientTransportPlugin } from '../client/transport-plugin'
import type { OpenAPISpec } from '../types/openapi'
import type { ClientSideServerChannel } from '../client-side-server/channel'
import type { ClientSideServerMessage, ClientSideServerRequest } from '../client-side-server/protocol'

interface PythonRuntimeModule {
  loadPyodide: (options: { indexURL: string }) => Promise<PythonRuntimeHandle>
}

interface PythonRuntimeHandle {
  FS: {
    mkdirTree(path: string): void
    writeFile(path: string, data: string): void
  }
  globals: {
    set(name: string, value: unknown): void
    get(name: string): any
  }
  loadPackage(packages: string | string[]): Promise<void>
  runPythonAsync(code: string): Promise<any>
}

interface PythonPreparedPlan {
  python_source: string
  requested_packages: string[]
  imported_modules: string[]
  import_rewrites?: string[]
}

interface PythonServerStartResult {
  server_name: string
  openapi: Record<string, any>
}

export interface StartPythonClientSideServerFromSourceOptions extends ClientSideServerMQTTWebRTCOptions {
  source: string
  pythonRuntimeUrl?: string
}

export interface StartedPythonClientSideServer {
  connectionUrl: string
  openapi: Record<string, any>
  signaler: ClientSideServerMQTTWebRTCServer
  stop(): Promise<void>
}

export interface PythonClientSideServerHostState {
  status: 'idle' | 'starting' | 'live' | 'error'
  connectionUrl: string | null
  openapi: Record<string, any> | null
  error: string | null
}

export interface PythonClientSideClientState {
  status: 'idle' | 'connecting' | 'connected' | 'running' | 'error'
  baseUrl: string | null
  result: unknown
  openapi: OpenAPISpec | null
  error: string | null
}

export async function startPythonClientSideServerFromSource(
  options: StartPythonClientSideServerFromSourceOptions,
): Promise<StartedPythonClientSideServer> {
  const runtime = await createPythonBrowserRuntime({
    pythonRuntimeUrl: options.pythonRuntimeUrl,
  })
  const serverHandle = await runtime.startServer(options.source)
  const adapter = new PythonClientSideServerAdapter(runtime, serverHandle.openapi)

  const signaler = createClientSideServerMQTTWebRTCServer({
    server: adapter as any,
    serverName: serverHandle.server_name,
    mqttBroker: options.mqttBroker,
    mqttTopic: options.mqttTopic,
    mqttOptions: options.mqttOptions,
    iceServers: options.iceServers,
    connectionTimeoutMs: options.connectionTimeoutMs,
    announceIntervalMs: options.announceIntervalMs,
    clientIdPrefix: options.clientIdPrefix,
    identity: options.identity,
    secureSignaling: options.secureSignaling,
    anonymousRouting: options.anonymousRouting,
    sealedTopic: options.sealedTopic,
    maxSealedMessageBytes: options.maxSealedMessageBytes,
    replayWindowMs: options.replayWindowMs,
    clockSkewToleranceMs: options.clockSkewToleranceMs,
    serverEncryptionKeyPair: options.serverEncryptionKeyPair,
  })

  await signaler.start()

  return {
    connectionUrl: signaler.connectionUrl,
    openapi: serverHandle.openapi,
    signaler,
    stop: async () => {
      await signaler.stop()
      await runtime.dispose()
    },
  }
}

export const startClientSidePythonServerFromSource = startPythonClientSideServerFromSource

export async function connectPythonClientSideServer(
  options: ClientSideServerMQTTWebRTCOptions & { baseUrl: string },
): Promise<{ client: OpenAPIClient; openapi: OpenAPISpec }> {
  const { openapi, transportPlugins } = await connectPythonBrowserBaseUrl(options)
  const client = new OpenAPIClient(openapi, {
    baseUrl: options.baseUrl,
    transportPlugins,
  })
  return { client, openapi }
}

export const connectClientSidePythonServer = connectPythonClientSideServer

async function connectPythonBrowserBaseUrl(
  options: ClientSideServerMQTTWebRTCOptions & { baseUrl: string },
): Promise<{
  openapi: OpenAPISpec
  transportPlugins: OpenAPIClientTransportPlugin[]
}> {
  if (options.baseUrl.startsWith('css://')) {
    const transportPlugin = createClientSideServerMQTTWebRTCTransportPlugin(options)
    const openapi = await fetchClientSideServerOpenAPI(options.baseUrl, transportPlugin) as OpenAPISpec
    return {
      openapi,
      transportPlugins: [transportPlugin],
    }
  }

  const openapiUrl = resolveHttpOpenAPIUrl(options.baseUrl)
  const response = await fetch(openapiUrl, {
    headers: {
      accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw new Error(`Could not load OpenAPI from ${openapiUrl}: ${response.status} ${response.statusText}`)
  }
  const openapi = await response.json() as OpenAPISpec
  return {
    openapi,
    transportPlugins: [],
  }
}

export function createPythonClientSideServerHost(
  options: Omit<StartPythonClientSideServerFromSourceOptions, 'source'> = {},
): {
  getState(): PythonClientSideServerHostState
  subscribe(listener: (state: PythonClientSideServerHostState) => void): () => void
  start(source: string): Promise<PythonClientSideServerHostState>
  stop(): Promise<void>
} {
  let activeServer: StartedPythonClientSideServer | null = null
  let state: PythonClientSideServerHostState = {
    status: 'idle',
    connectionUrl: null,
    openapi: null,
    error: null,
  }
  const listeners = new Set<(state: PythonClientSideServerHostState) => void>()

  const publish = () => {
    for (const listener of listeners) {
      listener(state)
    }
  }

  const setState = (patch: Partial<PythonClientSideServerHostState>) => {
    state = { ...state, ...patch }
    publish()
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    async start(source) {
      setState({ status: 'starting', error: null })
      if (activeServer) {
        await activeServer.stop()
        activeServer = null
      }
      try {
        activeServer = await startPythonClientSideServerFromSource({
          ...options,
          source,
        })
        setState({
          status: 'live',
          connectionUrl: activeServer.connectionUrl,
          openapi: activeServer.openapi,
          error: null,
        })
      } catch (error) {
        setState({
          status: 'error',
          error: formatPythonBrowserValue(error),
          connectionUrl: null,
          openapi: null,
        })
        console.error(error)
      }
      return state
    },
    async stop() {
      if (activeServer) {
        await activeServer.stop()
        activeServer = null
      }
      setState({
        status: 'idle',
        connectionUrl: null,
        openapi: null,
        error: null,
      })
    },
  }
}

export function createPythonClientSideClientRunner(
  options: Omit<ClientSideServerMQTTWebRTCOptions, 'baseUrl'> = {},
): {
  getState(): PythonClientSideClientState
  subscribe(listener: (state: PythonClientSideClientState) => void): () => void
  connect(baseUrl: string): Promise<PythonClientSideClientState>
  run(source: string): Promise<unknown>
  runAgainst(baseUrl: string, source: string): Promise<unknown>
} {
  let client: OpenAPIClient | null = null
  let state: PythonClientSideClientState = {
    status: 'idle',
    baseUrl: null,
    result: null,
    openapi: null,
    error: null,
  }
  const listeners = new Set<(state: PythonClientSideClientState) => void>()

  const publish = () => {
    for (const listener of listeners) {
      listener(state)
    }
  }

  const setState = (patch: Partial<PythonClientSideClientState>) => {
    state = { ...state, ...patch }
    publish()
  }

  const connect = async (baseUrl: string) => {
    setState({
      status: 'connecting',
      baseUrl,
      result: `Connecting to ${baseUrl}...`,
      error: null,
    })
    try {
      const connected = await connectPythonClientSideServer({
        ...options,
        baseUrl,
      })
      client = connected.client
      setState({
        status: 'connected',
        baseUrl,
        openapi: connected.openapi,
        result: `Connected to ${baseUrl}`,
        error: null,
      })
    } catch (error) {
      setState({
        status: 'error',
        baseUrl,
        error: formatPythonBrowserValue(error),
        result: formatPythonBrowserValue(error),
        openapi: null,
      })
      console.error(error)
    }
    return state
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    connect,
    async run(source: string) {
      if (!client) {
        if (!state.baseUrl) {
          throw new Error('Cannot run without connecting to a browser Python server first.')
        }
        await connect(state.baseUrl)
        if (!client) {
          throw new Error(state.error ?? 'Could not connect to browser Python server.')
        }
      }
      setState({
        status: 'running',
        result: 'Running...',
        error: null,
      })
      try {
        const fn = compileClientSnippet(source)
        const result = await fn(client)
        setState({
          status: 'connected',
          result,
          error: null,
        })
        return result
      } catch (error) {
        setState({
          status: 'error',
          result: formatPythonBrowserValue(error),
          error: formatPythonBrowserValue(error),
        })
        console.error(error)
        throw error
      }
    },
    async runAgainst(baseUrl: string, source: string) {
      if (!client || state.baseUrl !== baseUrl || state.status === 'error') {
        await connect(baseUrl)
      }
      return this.run(source)
    },
  }
}

export interface CreatePythonBrowserRuntimeOptions {
  pythonRuntimeUrl?: string
}

export interface RunPythonBrowserClientSourceOptions extends CreatePythonBrowserRuntimeOptions {}

export async function createPythonBrowserRuntime(
  options: CreatePythonBrowserRuntimeOptions = {},
): Promise<PythonBrowserRuntime> {
  const runtimeModule = await importPythonRuntimeModule(options.pythonRuntimeUrl)
  const indexURL = resolveIndexUrl(options.pythonRuntimeUrl)
  const py = await runtimeModule.loadPyodide({ indexURL })
  const runtime = new PythonBrowserRuntime(py)
  await runtime.boot()
  return runtime
}

export async function runPythonBrowserClientSource(
  source: string,
  options: RunPythonBrowserClientSourceOptions = {},
): Promise<unknown> {
  const runtime = await createPythonBrowserRuntime(options)
  try {
    return await runtime.runClientSource(source)
  } finally {
    await runtime.dispose()
  }
}

export function createPythonBrowserClientExecutor(
  options: CreatePythonBrowserRuntimeOptions = {},
): {
  run(source: string): Promise<unknown>
  dispose(): Promise<void>
} {
  let runtimePromise: Promise<PythonBrowserRuntime> | null = null

  const getRuntime = () => {
    if (!runtimePromise) {
      runtimePromise = createPythonBrowserRuntime(options)
    }
    return runtimePromise
  }

  return {
    async run(source: string) {
      const runtime = await getRuntime()
      return runtime.runClientSource(source)
    },
    async dispose() {
      if (!runtimePromise) return
      const runtime = await runtimePromise
      await runtime.dispose()
      runtimePromise = null
    },
  }
}

class PythonBrowserRuntime {
  private booted = false
  private readonly activeServerKey = '__plat_browser_active_server'
  private nextClientId = 1
  private readonly connectedClients = new Map<number, OpenAPIClient>()

  constructor(private py: PythonRuntimeHandle) {}

  async boot(): Promise<void> {
    if (this.booted) return
    this.installSourceFiles()
    await this.py.runPythonAsync(`
import sys
if "/plat_runtime" not in sys.path:
    sys.path.insert(0, "/plat_runtime")
`)
    this.py.globals.set('__plat_browser_js_connect_client', async (baseUrl: string, connectOptions?: unknown) => {
      const { client, openapi } = await connectPythonClientSideServer({
        baseUrl,
        identity: normalizePythonClientIdentityOptions(normalizePythonBridgeValue(connectOptions)),
      })
      const clientId = this.nextClientId++
      this.connectedClients.set(clientId, client)
      return {
        client_id: clientId,
        base_url: baseUrl,
        openapi,
      }
    })
    this.py.globals.set(
      '__plat_browser_js_call_client',
      async (clientId: number, methodName: string, payload: unknown) => {
        const client = this.connectedClients.get(clientId)
        if (!client) {
          throw new Error(`No browser Python client connection found for id ${clientId}.`)
        }
        const method = (client as Record<string, any>)[methodName]
        if (typeof method !== 'function') {
          throw new Error(`Client has no callable method named "${methodName}".`)
        }
        return await method(normalizePythonBridgeValue(payload) ?? {})
      },
    )
    await this.py.runPythonAsync(`
from plat_browser import prepare_python_source, create_browser_server
from plat_browser.client import _set_browser_client_bridge, run_python_client_source
__plat_browser_servers = {}
_set_browser_client_bridge(__plat_browser_js_connect_client, __plat_browser_js_call_client)

def __plat_browser_start_server(source):
    module_globals = {"__name__": "__plat_browser_user__"}
    exec(source, module_globals)
    definition = (
        module_globals.get("__plat_browser_server_definition__")
        or module_globals.get("client_side_server")
        or module_globals.get("default")
    )
    if definition is None:
        raise RuntimeError("Expected the source to call serve_server(name, [Controller]) or serve_client_side_server(name, [Controller])")
    server = create_browser_server(
        definition.options,
        *definition.controllers,
        server_name=definition.server_name,
        undecorated_mode=definition.options.get("undecorated_mode", "POST"),
    )
    __plat_browser_servers["default"] = server
    return {"server_name": definition.server_name, "openapi": server.openapi}

async def __plat_browser_handle_request(message):
    server = __plat_browser_servers.get("default")
    if server is None:
        raise RuntimeError("No active browser python server.")
    events = []
    result = await server.handle_request(message, emit=events.append)
    return {"result": result, "events": events}

def __plat_browser_prepare_source(source):
    plan = prepare_python_source(source)
    return {
        "python_source": plan.python_source,
        "requested_packages": plan.requested_packages,
        "imported_modules": plan.imported_modules,
        "import_rewrites": plan.import_rewrites,
    }

async def __plat_browser_run_client_source(source):
    plan = prepare_python_source(source)
    return await run_python_client_source(plan.python_source)
`)
    this.booted = true
  }

  async startServer(source: string): Promise<PythonServerStartResult> {
    const plan = await this.prepareSource(source)
    this.logPlanRewrites(plan)
    await this.installPackages(plan)
    const result = await this.callPythonFunction<PythonServerStartResult>(
      '__plat_browser_start_server',
      plan.python_source,
    )
    return result
  }

  async handleRequest(message: Record<string, any>): Promise<{ result: unknown; events: Array<{ event: string; data: unknown }> }> {
    return this.callPythonFunction('__plat_browser_handle_request', message)
  }

  async runClientSource(source: string): Promise<unknown> {
    const plan = await this.prepareSource(source)
    this.logPlanRewrites(plan)
    await this.installPackages(plan)
    return this.callPythonFunction('__plat_browser_run_client_source', plan.python_source)
  }

  async dispose(): Promise<void> {
    this.py.globals.set(this.activeServerKey, null)
    this.connectedClients.clear()
  }

  private installSourceFiles() {
    for (const [relativePath, source] of Object.entries(PYTHON_BROWSER_SOURCES)) {
      const absolutePath = `/plat_runtime/${relativePath}`
      const directory = absolutePath.slice(0, absolutePath.lastIndexOf('/'))
      this.py.FS.mkdirTree(directory)
      this.py.FS.writeFile(absolutePath, source)
    }
  }

  private async prepareSource(source: string): Promise<PythonPreparedPlan> {
    return await this.callPythonFunction<PythonPreparedPlan>(
      '__plat_browser_prepare_source',
      source,
    )
  }

  private logPlanRewrites(plan: PythonPreparedPlan): void {
    const rewrites = plan.import_rewrites ?? []
    for (const rewrite of rewrites) {
      console.warn(`[plat/python-browser] ${rewrite}`)
    }
  }

  private async installPackages(plan: PythonPreparedPlan): Promise<void> {
    const requested = dedupeKeepOrder([
      ...plan.requested_packages,
      ...plan.imported_modules,
    ])
    for (const name of requested) {
      await this.installPackage(name)
    }
  }

  private async installPackage(name: string): Promise<void> {
    try {
      await this.py.loadPackage(name)
      return
    } catch {
      // Fall through to hidden pip install
    }
    await this.py.loadPackage('micropip')
    this.py.globals.set('__plat_browser_package_name', name)
    try {
      await this.py.runPythonAsync(`
import micropip
await micropip.install(__plat_browser_package_name)
`)
    } catch (error) {
      throw new Error(`Could not install Python package "${name}" in the browser runtime: ${String(error)}`)
    }
  }

  private async callPythonFunction<T>(name: string, arg: unknown): Promise<T> {
    this.py.globals.set('__plat_browser_arg', arg)
    const proxy = await this.py.runPythonAsync(`
result = ${name}(__plat_browser_arg)
if hasattr(result, "__await__"):
    result = await result
result
`)
    const value = typeof proxy?.toJs === 'function' ? proxy.toJs({ dict_converter: Object.fromEntries }) : proxy
    if (typeof proxy?.destroy === 'function') {
      proxy.destroy()
    }
    return value as T
  }
}

class PythonClientSideServerAdapter {
  constructor(
    private runtime: PythonBrowserRuntime,
    public openapi: Record<string, any>,
  ) {}

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

    try {
      const { result, events } = await this.runtime.handleRequest({
        operationId: message.operationId,
        method: message.method,
        path: message.path,
        input: message.input ?? {},
        headers: message.headers ?? {},
      })
      for (const event of events) {
        await channel.send({
          jsonrpc: '2.0',
          id: message.id,
          ok: true,
          event: event.event as any,
          data: event.data,
        })
      }
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: true,
        result,
      })
    } catch (error: any) {
      await channel.send({
        jsonrpc: '2.0',
        id: message.id,
        ok: false,
        error: {
          status: 500,
          message: error?.message ?? 'Python browser server error',
        },
      })
    }
  }

  serveChannel(channel: ClientSideServerChannel): () => void {
    return channel.subscribe((message) => void this.handleMessage(message, channel))
  }
}

function isRequestMessage(message: ClientSideServerMessage): message is ClientSideServerRequest {
  return 'method' in message && 'path' in message
}

async function importPythonRuntimeModule(runtimeUrl?: string): Promise<PythonRuntimeModule> {
  const url = runtimeUrl ?? 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs'
  return import(/* @vite-ignore */ url) as Promise<PythonRuntimeModule>
}

function resolveIndexUrl(runtimeUrl?: string): string {
  const url = runtimeUrl ?? 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs'
  return url.replace(/pyodide\.mjs$/, '')
}

function dedupeKeepOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    deduped.push(value)
  }
  return deduped
}

export function formatPythonBrowserValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function compileClientSnippet(source: string): (client: OpenAPIClient) => Promise<unknown> {
  const trimmed = source.trim()
  if (!trimmed) {
    return async () => undefined
  }

  try {
    return new Function('client', `return (async () => (${trimmed}))()`) as (client: OpenAPIClient) => Promise<unknown>
  } catch {
    return new Function('client', `return (async () => { ${source} })()`) as (client: OpenAPIClient) => Promise<unknown>
  }
}

function resolveHttpOpenAPIUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/openapi.json')) {
    return trimmed
  }
  return `${trimmed}/openapi.json`
}

function normalizePythonBridgeValue(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const toJs = (value as any).toJs
    if (typeof toJs === 'function') {
      try {
        return toJs.call(value, { dict_converter: Object.fromEntries })
      } catch {
        try {
          return toJs.call(value)
        } catch {
          return value
        }
      }
    }
  }
  return value
}

function normalizePythonClientIdentityOptions(value: unknown): ClientSideServerIdentityOptions | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, any>
  const identity = raw.identity && typeof raw.identity === 'object' ? raw.identity as Record<string, any> : raw
  const authorityServers = Array.isArray(identity.authority_servers ?? identity.authorityServers)
    ? (identity.authority_servers ?? identity.authorityServers).map((server: any) => createFetchClientSideServerAuthorityServer({
      baseUrl: String(server.base_url ?? server.baseUrl),
      publicKeyJwk: server.public_key_jwk ?? server.publicKeyJwk,
      authorityName: server.authority_name ?? server.authorityName,
      resolvePath: server.resolve_path ?? server.resolvePath,
    }))
    : undefined

  return {
    knownHosts: identity.known_hosts ?? identity.knownHosts,
    trustOnFirstUse: identity.trust_on_first_use ?? identity.trustOnFirstUse,
    authorityServers,
  }
}
