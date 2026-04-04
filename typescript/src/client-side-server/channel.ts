import type { ClientSideServerMessage } from './protocol'

export interface ClientSideServerChannel {
  send(message: ClientSideServerMessage): void | Promise<void>
  subscribe(listener: (message: ClientSideServerMessage) => void | Promise<void>): () => void
  close?(): void | Promise<void>
}

export function createRTCDataChannelAdapter(channel: RTCDataChannel): ClientSideServerChannel {
  return {
    send(message) {
      channel.send(JSON.stringify(message))
    },
    subscribe(listener) {
      const onMessage = (event: MessageEvent) => {
        const raw = typeof event.data === 'string' ? event.data : String(event.data)
        listener(JSON.parse(raw) as ClientSideServerMessage)
      }
      channel.addEventListener('message', onMessage)
      return () => channel.removeEventListener('message', onMessage)
    },
    close() {
      channel.close()
    },
  }
}
