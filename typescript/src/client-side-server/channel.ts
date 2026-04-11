import type { ClientSideServerMessage } from './protocol'

export interface ClientSideServerChannel {
  send(message: ClientSideServerMessage): void | Promise<void>
  subscribe(listener: (message: ClientSideServerMessage) => void | Promise<void>): () => void
  close?(): void | Promise<void>
}

interface BinaryFileMetaMessage {
  platcss: 'file-binary-meta'
  jsonrpc: '2.0'
  id: string
  ok: true
  result: Record<string, unknown>
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return null
}

function splitBinaryFileMessage(message: unknown): { meta: BinaryFileMetaMessage; bytes: Uint8Array } | null {
  if (!message || typeof message !== 'object') return null
  const m = message as any
  if (m.jsonrpc !== '2.0' || m.ok !== true || !m.result || typeof m.result !== 'object') return null
  if (m.result._type !== 'file') return null
  const bytes = toUint8Array(m.result.content)
  if (!bytes) return null
  const meta: BinaryFileMetaMessage = {
    platcss: 'file-binary-meta',
    jsonrpc: '2.0',
    id: String(m.id ?? ''),
    ok: true,
    result: {
      ...m.result,
      content: null,
      contentEncoding: 'binary',
    },
  }
  return { meta, bytes }
}

function isBinaryFileMetaMessage(message: unknown): message is BinaryFileMetaMessage {
  return Boolean(
    message
    && typeof message === 'object'
    && (message as any).platcss === 'file-binary-meta'
    && (message as any).jsonrpc === '2.0'
    && (message as any).ok === true,
  )
}

export function createRTCDataChannelAdapter(channel: RTCDataChannel): ClientSideServerChannel {
  const pendingBinaryMeta: BinaryFileMetaMessage[] = []

  const emitBinary = (raw: ArrayBuffer | Uint8Array, listener: (message: ClientSideServerMessage) => void | Promise<void>) => {
    const meta = pendingBinaryMeta.shift()
    if (!meta) return
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    const reconstructed = {
      ...meta,
      result: {
        ...meta.result,
        content: bytes,
      },
    }
    void listener(reconstructed as ClientSideServerMessage)
  }

  return {
    send(message) {
      const binary = splitBinaryFileMessage(message)
      if (binary) {
        channel.send(JSON.stringify(binary.meta))
        const payload = Uint8Array.from(binary.bytes) as Uint8Array<ArrayBuffer>
        channel.send(payload)
        return
      }
      channel.send(JSON.stringify(message))
    },
    subscribe(listener) {
      const onMessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          const parsed = JSON.parse(event.data)
          if (isBinaryFileMetaMessage(parsed)) {
            pendingBinaryMeta.push(parsed)
            return
          }
          void listener(parsed as ClientSideServerMessage)
          return
        }
        if (event.data instanceof ArrayBuffer) {
          emitBinary(event.data, listener)
          return
        }
        if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then((buffer) => emitBinary(buffer, listener))
          return
        }
        const raw = String(event.data)
        const parsed = JSON.parse(raw)
        void listener(parsed as ClientSideServerMessage)
      }
      channel.addEventListener('message', onMessage)
      return () => channel.removeEventListener('message', onMessage)
    },
    close() {
      channel.close()
    },
  }
}

export function createWeriftDataChannelAdapter(
  channel: {
    send(data: string | Buffer | Uint8Array): void
    close(): void
    onMessage: {
      subscribe(listener: (data: string | Buffer) => void): { unSubscribe(): void }
    }
  },
): ClientSideServerChannel {
  const pendingBinaryMeta: BinaryFileMetaMessage[] = []

  return {
    send(message) {
      const binary = splitBinaryFileMessage(message)
      if (binary) {
        channel.send(JSON.stringify(binary.meta))
        channel.send(binary.bytes)
        return
      }
      channel.send(JSON.stringify(message))
    },
    subscribe(listener) {
      const subscription = channel.onMessage.subscribe((data) => {
        if (typeof data === 'string') {
          const parsed = JSON.parse(data)
          if (isBinaryFileMetaMessage(parsed)) {
            pendingBinaryMeta.push(parsed)
            return
          }
          void listener(parsed as ClientSideServerMessage)
          return
        }

        const meta = pendingBinaryMeta.shift()
        if (meta) {
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
          const reconstructed = {
            ...meta,
            result: {
              ...meta.result,
              content: bytes,
            },
          }
          void listener(reconstructed as ClientSideServerMessage)
          return
        }

        const raw = data.toString('utf8')
        void listener(JSON.parse(raw) as ClientSideServerMessage)
      })
      return () => {
        subscription.unSubscribe()
      }
    },
    close() {
      channel.close()
    },
  }
}
