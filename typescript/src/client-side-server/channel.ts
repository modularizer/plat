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
  byteLength: number
  result: Record<string, unknown>
}

// Stay well below the common WebRTC SCTP maxMessageSize (~256 KB). Chrome's
// default is 262144, Firefox 1073741823. 64 KB leaves headroom for both.
const BINARY_CHUNK_SIZE = 64 * 1024
const BINARY_CHUNK_FRAME_MAGIC = 0x50424631 // "PBF1"
const BINARY_CHUNK_FRAME_VERSION = 1
const BINARY_CHUNK_FRAME_HEADER_BYTES = 12
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

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
  const rawBytes = toUint8Array(m.result.content)
  if (!rawBytes) return null
  // If rawBytes is a view into a larger buffer, copy to a new Uint8Array
  const bytes = (rawBytes.byteOffset === 0 && rawBytes.byteLength === rawBytes.buffer.byteLength)
    ? rawBytes
    : new Uint8Array(rawBytes) // copies only the intended slice
  const meta: BinaryFileMetaMessage = {
    platcss: 'file-binary-meta',
    jsonrpc: '2.0',
    id: String(m.id ?? ''),
    ok: true,
    byteLength: bytes.byteLength,
    result: {
      ...m.result,
      content: null,
      contentEncoding: 'binary',
    },
  }
  return { meta, bytes }
}

function chunkBytes(bytes: Uint8Array): Array<{ offset: number; bytes: Uint8Array }> {
  if (bytes.byteLength <= BINARY_CHUNK_SIZE) return [{ offset: 0, bytes }]
  const chunks: Array<{ offset: number; bytes: Uint8Array }> = []
  for (let offset = 0; offset < bytes.byteLength; offset += BINARY_CHUNK_SIZE) {
    const end = Math.min(offset + BINARY_CHUNK_SIZE, bytes.byteLength)
    chunks.push({ offset, bytes: bytes.subarray(offset, end) })
  }
  return chunks
}

function encodeBinaryChunkFrame(id: string, offset: number, bytes: Uint8Array): Uint8Array {
  const idBytes = textEncoder.encode(id)
  const framed = new Uint8Array(BINARY_CHUNK_FRAME_HEADER_BYTES + idBytes.byteLength + bytes.byteLength)
  const view = new DataView(framed.buffer, framed.byteOffset, framed.byteLength)
  view.setUint32(0, BINARY_CHUNK_FRAME_MAGIC)
  view.setUint8(4, BINARY_CHUNK_FRAME_VERSION)
  view.setUint8(5, 0)
  view.setUint16(6, idBytes.byteLength)
  view.setUint32(8, offset)
  framed.set(idBytes, BINARY_CHUNK_FRAME_HEADER_BYTES)
  framed.set(bytes, BINARY_CHUNK_FRAME_HEADER_BYTES + idBytes.byteLength)
  return framed
}

function decodeBinaryChunkFrame(value: unknown): { id: string; offset: number; bytes: Uint8Array } | null {
  const framed = toUint8Array(value)
  if (!framed || framed.byteLength < BINARY_CHUNK_FRAME_HEADER_BYTES) return null
  const view = new DataView(framed.buffer, framed.byteOffset, framed.byteLength)
  if (view.getUint32(0) !== BINARY_CHUNK_FRAME_MAGIC) return null
  if (view.getUint8(4) !== BINARY_CHUNK_FRAME_VERSION) return null
  const idByteLength = view.getUint16(6)
  const offset = view.getUint32(8)
  const payloadStart = BINARY_CHUNK_FRAME_HEADER_BYTES + idByteLength
  if (payloadStart > framed.byteLength) return null
  const id = textDecoder.decode(framed.subarray(BINARY_CHUNK_FRAME_HEADER_BYTES, payloadStart))
  return {
    id,
    offset,
    bytes: framed.subarray(payloadStart),
  }
}

interface BinaryAssembly {
  meta: BinaryFileMetaMessage
  received: Uint8Array
  receivedBytes: number
  chunks: Map<number, number>
}

function createAssembler() {
  // Map of file id to BinaryAssembly
  const assemblies = new Map<string, BinaryAssembly>()

  const start = (meta: BinaryFileMetaMessage) => {
    if (assemblies.has(meta.id)) {
      console.warn('[assembler] Duplicate start for file id', { id: meta.id })
      return
    }
    console.log('[assembler] Starting new file', {
      id: meta.id,
      byteLength: meta.byteLength
    })
    assemblies.set(meta.id, {
      meta,
      received: new Uint8Array(meta.byteLength),
      receivedBytes: 0,
      chunks: new Map<number, number>(),
    })
  }

  // Returns BinaryAssembly if complete, else null
  const push = (id: string, offset: number, bytes: Uint8Array): BinaryAssembly | null => {
    const assembly = assemblies.get(id)
    if (!assembly) {
      console.warn('[assembler] Received chunk for unknown file id', { id, offset, chunkSize: bytes.byteLength })
      return null
    }
    if (offset + bytes.byteLength > assembly.received.length) {
      console.error('BinaryAssembly overflow: chunk too large', {
        id,
        offset,
        chunk: bytes.byteLength,
        buffer: assembly.received.length
      })
      return null
    }
    const priorChunkLength = assembly.chunks.get(offset)
    if (priorChunkLength !== undefined) {
      console.warn('[assembler] Duplicate chunk ignored', { id, offset, chunkSize: bytes.byteLength, priorChunkLength })
      return null
    }
    for (const [existingOffset, existingLength] of assembly.chunks) {
      const overlaps = offset < existingOffset + existingLength && existingOffset < offset + bytes.byteLength
      if (overlaps) {
        console.error('[assembler] Overlapping chunk rejected', {
          id,
          offset,
          chunk: bytes.byteLength,
          existingOffset,
          existingLength,
        })
        return null
      }
    }
    assembly.received.set(bytes, offset)
    assembly.chunks.set(offset, bytes.byteLength)
    assembly.receivedBytes += bytes.byteLength
    if (assembly.receivedBytes < assembly.meta.byteLength) return null
    assemblies.delete(id)
    return assembly
  }

  return { start, push }
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

const BUFFERED_AMOUNT_HIGH_WATER = 1 * 1024 * 1024
const BUFFERED_AMOUNT_LOW_WATER = 256 * 1024

function waitForDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount <= BUFFERED_AMOUNT_LOW_WATER) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const prev = channel.bufferedAmountLowThreshold
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_WATER
    const onLow = () => {
      channel.removeEventListener('bufferedamountlow', onLow)
      channel.bufferedAmountLowThreshold = prev
      resolve()
    }
    channel.addEventListener('bufferedamountlow', onLow)
  })
}

export function createRTCDataChannelAdapter(channel: RTCDataChannel): ClientSideServerChannel {
  // Default binaryType is 'blob' in Chrome — blob.arrayBuffer() is async, which
  // races chunks out of order. Force synchronous ArrayBuffer delivery.
  channel.binaryType = 'arraybuffer'

  const assembler = createAssembler()
  const listeners = new Set<(message: ClientSideServerMessage) => void | Promise<void>>()

  const emit = (message: ClientSideServerMessage) => {
    for (const listener of listeners) {
      void listener(message)
    }
  }

  const emitAssembled = (done: BinaryAssembly) => {
    const reconstructed = {
      ...done.meta,
      result: {
        ...done.meta.result,
        content: done.received,
      },
    }
    emit(reconstructed as ClientSideServerMessage)
  }

  const onMessage = (event: MessageEvent) => {
    if (typeof event.data === 'string') {
      const parsed = JSON.parse(event.data)
      if (isBinaryFileMetaMessage(parsed)) {
        assembler.start(parsed)
        return
      }
      emit(parsed as ClientSideServerMessage)
      return
    }
    if (event.data instanceof ArrayBuffer) {
      const framed = decodeBinaryChunkFrame(event.data)
      if (!framed) {
        console.error('[assembler] Received malformed binary chunk frame')
        return
      }
      const done = assembler.push(framed.id, framed.offset, framed.bytes)
      if (done) {
        emitAssembled(done)
      }
      return
    }
    if (event.data instanceof Blob) {
      console.warn('[plat channel] unexpected Blob data; ordering fallback')
      return
    }
  }
  channel.addEventListener('message', onMessage)

  return {
    async send(message) {
      const binary = splitBinaryFileMessage(message)
      if (binary) {
        channel.send(JSON.stringify(binary.meta))
        for (const chunk of chunkBytes(binary.bytes)) {
          if (channel.bufferedAmount > BUFFERED_AMOUNT_HIGH_WATER) {
            await waitForDrain(channel)
          }
          const framed = encodeBinaryChunkFrame(binary.meta.id, chunk.offset, chunk.bytes)
          channel.send(framed as Uint8Array<ArrayBuffer>)
        }
        return
      }
      channel.send(JSON.stringify(message))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      channel.removeEventListener('message', onMessage)
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
  const assembler = createAssembler()
  const listeners = new Set<(message: ClientSideServerMessage) => void | Promise<void>>()

  const emit = (message: ClientSideServerMessage) => {
    for (const listener of listeners) {
      void listener(message)
    }
  }

  const subscription = channel.onMessage.subscribe((data) => {
    if (typeof data === 'string') {
      const parsed = JSON.parse(data)
      if (isBinaryFileMetaMessage(parsed)) {
        assembler.start(parsed)
        return
      }
      emit(parsed as ClientSideServerMessage)
      return
    }

    const framed = decodeBinaryChunkFrame(data)
    if (!framed) {
      console.error('[assembler] Received malformed binary chunk frame')
      return
    }
    const done = assembler.push(framed.id, framed.offset, framed.bytes)
    if (done) {
      const reconstructed = {
        ...done.meta,
        result: {
          ...done.meta.result,
          content: done.received,
        },
      }
      emit(reconstructed as ClientSideServerMessage)
      return
    }
  })

  return {
    send(message) {
      const binary = splitBinaryFileMessage(message)
      if (binary) {
        channel.send(JSON.stringify(binary.meta))
        for (const chunk of chunkBytes(binary.bytes)) {
          channel.send(encodeBinaryChunkFrame(binary.meta.id, chunk.offset, chunk.bytes))
        }
        return
      }
      channel.send(JSON.stringify(message))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      subscription.unSubscribe()
      channel.close()
    },
  }
}
