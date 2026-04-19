/**
 * plat HTTP⇄WebRTC bridge.
 *
 * Registers with an MQTT signaling topic like a regular `css://` server,
 * but every inbound `PLAT_REQUEST` is forwarded to a configured upstream
 * HTTP server on the same LAN. Responses are shipped back as
 * `PLAT_RESPONSE` messages on the same data channel.
 */
import {
  createClientSideServerMQTTWebRTCServer,
  type ClientSideServerMQTTWebRTCOptions,
  type ClientSideServerMQTTWebRTCServer,
  type ClientSideServerWorkerInfo,
} from '../client-side-server/mqtt-webrtc'
import type { ClientSideServerInstanceInfo } from '../client-side-server/protocol'
import {
  createHTTPForwarder,
  type HTTPForwarderOptions,
} from './http-forwarder'

export { createHTTPForwarder, type HTTPForwarderOptions } from './http-forwarder'

export interface PLATHTTPBridgeOptions extends ClientSideServerMQTTWebRTCOptions {
  /** css:// name the bridge registers as (e.g. "my-api" or "authority.com/my-api"). */
  name: string
  /** Base URL of the upstream HTTP server the bridge forwards to. */
  upstream: string
  /** Label used in X-Forwarded-By / Forwarded by=. Defaults to `name`. */
  bridgeName?: string
  /** If true, append to a client-supplied X-Forwarded-For rather than overwrite. */
  trustClientForwarded?: boolean
  /** If true, skip all X-Forwarded-* / Forwarded header injection. */
  disableForwardedHeaders?: boolean
  /** Optional method allowlist (e.g. ['GET', 'POST']); others return 405. */
  allowMethods?: string[]
  /** Optional path allowlist (regex or string → regex); non-matching return 403. */
  allowPaths?: (RegExp | string)[]
  /** Optional overrides for the announced instanceInfo. */
  instanceInfo?: ClientSideServerInstanceInfo
  /** Optional load-balancing worker info. */
  workerInfo?: ClientSideServerWorkerInfo
  /** Override fetch (e.g. for tests). */
  fetchImpl?: typeof fetch
  /** Upstream request timeout, ms. Default 30s. */
  requestTimeoutMs?: number
}

export interface PLATHTTPBridge {
  readonly cssUrl: string
  start(): Promise<void>
  stop(): Promise<void>
}

export function createHTTPBridge(options: PLATHTTPBridgeOptions): PLATHTTPBridge {
  const forwarder = createHTTPForwarder({
    upstream: options.upstream,
    cssName: options.name,
    bridgeName: options.bridgeName,
    trustClientForwarded: options.trustClientForwarded,
    disableForwardedHeaders: options.disableForwardedHeaders,
    allowMethods: options.allowMethods,
    allowPaths: options.allowPaths,
    instanceInfo: options.instanceInfo,
    fetchImpl: options.fetchImpl,
    requestTimeoutMs: options.requestTimeoutMs,
  } satisfies HTTPForwarderOptions)

  let signaler: ClientSideServerMQTTWebRTCServer | undefined

  return {
    get cssUrl() {
      return `css://${options.name}`
    },
    async start() {
      const {
        name,
        upstream: _upstream,
        bridgeName: _bridgeName,
        trustClientForwarded: _trust,
        disableForwardedHeaders: _dis,
        allowMethods: _am,
        allowPaths: _ap,
        fetchImpl: _fetch,
        requestTimeoutMs: _timeout,
        instanceInfo,
        workerInfo,
        ...transport
      } = options
      signaler = createClientSideServerMQTTWebRTCServer({
        ...transport,
        serverName: name,
        server: forwarder,
        instanceInfo,
        workerInfo,
      })
      await signaler.start()
    },
    async stop() {
      if (!signaler) return
      const s = signaler
      signaler = undefined
      await s.stop()
    },
  }
}
