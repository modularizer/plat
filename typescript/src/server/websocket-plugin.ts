import { WebSocketServer, WebSocket } from 'ws'
import type { PLATServerHostContext, PLATServerProtocolPlugin, PLATServerTransportRuntime } from './protocol-plugin'

export interface WebSocketSession {
  ws: WebSocket
  path: string
  headers: Record<string, string | string[] | undefined>
  send(message: unknown): void
  close(code?: number, reason?: string): void
  isOpen(): boolean
}

interface WebSocketHandler {
  messageType: string
  methodName: string | symbol
}

interface WebSocketControllerMeta {
  path: string
  handlers: WebSocketHandler[]
}

const websocketControllerMeta = new WeakMap<Function, WebSocketControllerMeta>()

export function WebSocketController(path: string) {
  return function (constructor: Function) {
    const existing = websocketControllerMeta.get(constructor)
    websocketControllerMeta.set(constructor, {
      path,
      handlers: existing?.handlers ?? [],
    })
  }
}

export function WebSocketMessage(type?: string) {
  return function (target: object, propertyKey: string | symbol) {
    const constructor = (target as any).constructor as Function
    const existing = websocketControllerMeta.get(constructor)
    const meta: WebSocketControllerMeta = existing ?? { path: '/', handlers: [] }

    meta.handlers.push({
      messageType: type ?? String(propertyKey),
      methodName: propertyKey,
    })

    websocketControllerMeta.set(constructor, meta)
  }
}

export function createWebSocketProtocolPlugin(controllers: Array<new () => any>): PLATServerProtocolPlugin {
  return {
    name: 'websocket-protocol-plugin',
    attach(_runtime: PLATServerTransportRuntime, host: PLATServerHostContext) {
      const httpServer = host.server as import('http').Server | undefined
      if (!httpServer) return

      const routeMap = new Map<string, { instance: any; handlers: Map<string, string | symbol> }>()

      for (const ControllerCtor of controllers) {
        const meta = websocketControllerMeta.get(ControllerCtor)
        if (!meta) continue
        const instance = new ControllerCtor()
        const handlers = new Map(meta.handlers.map((h) => [h.messageType, h.methodName]))
        routeMap.set(meta.path, { instance, handlers })
      }

      const wss = new WebSocketServer({ noServer: true })

      httpServer.on('upgrade', (req, socket, head) => {
        const path = (req.url ?? '/').split('?')[0] || '/'
        const route = routeMap.get(path)
        if (!route) {
          socket.destroy()
          return
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          const session: WebSocketSession = {
            ws,
            path,
            headers: req.headers as Record<string, string | string[] | undefined>,
            send(message: unknown) {
              ws.send(JSON.stringify(message))
            },
            close(code?: number, reason?: string) {
              ws.close(code, reason)
            },
            isOpen() {
              return ws.readyState === WebSocket.OPEN
            },
          }

          ws.on('message', async (data) => {
            try {
              const message = JSON.parse(String(data)) as Record<string, unknown>
              const messageType = typeof message.type === 'string' ? message.type : ''
              const methodName = route.handlers.get(messageType)
              if (!methodName) {
                session.send({ error: 'unknown_type', type: messageType })
                return
              }
              const method = route.instance[methodName]
              if (typeof method !== 'function') {
                session.send({ error: 'missing_handler', type: messageType })
                return
              }
              await method.call(route.instance, message, session)
            } catch (error: any) {
              session.send({ error: 'invalid_message', message: error?.message ?? 'Invalid message' })
            }
          })

          ws.on('close', async () => {
            if (typeof route.instance.onClose === 'function') {
              await route.instance.onClose(session)
            }
          })
        })
      })
    },
  }
}


