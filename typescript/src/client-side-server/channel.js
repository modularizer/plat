// Stay well below the common WebRTC SCTP maxMessageSize (~256 KB). Chrome's
// default is 262144, Firefox 1073741823. 64 KB leaves headroom for both.
const BINARY_CHUNK_SIZE = 64 * 1024;
function toUint8Array(value) {
    if (value instanceof Uint8Array)
        return value;
    if (value instanceof ArrayBuffer)
        return new Uint8Array(value);
    if (ArrayBuffer.isView(value))
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
}
function splitBinaryFileMessage(message) {
    if (!message || typeof message !== 'object')
        return null;
    const m = message;
    if (m.jsonrpc !== '2.0' || m.ok !== true || !m.result || typeof m.result !== 'object')
        return null;
    if (m.result._type !== 'file')
        return null;
    const bytes = toUint8Array(m.result.content);
    if (!bytes)
        return null;
    const meta = {
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
    };
    return { meta, bytes };
}
function chunkBytes(bytes) {
    if (bytes.byteLength <= BINARY_CHUNK_SIZE)
        return [bytes];
    const chunks = [];
    for (let offset = 0; offset < bytes.byteLength; offset += BINARY_CHUNK_SIZE) {
        const end = Math.min(offset + BINARY_CHUNK_SIZE, bytes.byteLength);
        chunks.push(bytes.subarray(offset, end));
    }
    return chunks;
}
function createAssembler() {
    let current = null;
    const queue = [];
    const start = (meta) => {
        if (current) {
            queue.push(meta);
            return;
        }
        current = { meta, received: new Uint8Array(meta.byteLength), offset: 0 };
    };
    const push = (bytes) => {
        if (!current)
            return null;
        current.received.set(bytes, current.offset);
        current.offset += bytes.byteLength;
        if (current.offset < current.meta.byteLength)
            return null;
        const done = current;
        current = null;
        const next = queue.shift();
        if (next)
            current = { meta: next, received: new Uint8Array(next.byteLength), offset: 0 };
        return done;
    };
    return { start, push };
}
function isBinaryFileMetaMessage(message) {
    return Boolean(message
        && typeof message === 'object'
        && message.platcss === 'file-binary-meta'
        && message.jsonrpc === '2.0'
        && message.ok === true);
}
const BUFFERED_AMOUNT_HIGH_WATER = 1 * 1024 * 1024;
const BUFFERED_AMOUNT_LOW_WATER = 256 * 1024;
function waitForDrain(channel) {
    if (channel.bufferedAmount <= BUFFERED_AMOUNT_LOW_WATER)
        return Promise.resolve();
    return new Promise((resolve) => {
        const prev = channel.bufferedAmountLowThreshold;
        channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_WATER;
        const onLow = () => {
            channel.removeEventListener('bufferedamountlow', onLow);
            channel.bufferedAmountLowThreshold = prev;
            resolve();
        };
        channel.addEventListener('bufferedamountlow', onLow);
    });
}
export function createRTCDataChannelAdapter(channel) {
    // Default binaryType is 'blob' in Chrome — blob.arrayBuffer() is async, which
    // races chunks out of order. Force synchronous ArrayBuffer delivery.
    channel.binaryType = 'arraybuffer';
    const assembler = createAssembler();
    const emitAssembled = (done, listener) => {
        const reconstructed = {
            ...done.meta,
            result: {
                ...done.meta.result,
                content: done.received,
            },
        };
        void listener(reconstructed);
    };
    return {
        async send(message) {
            const binary = splitBinaryFileMessage(message);
            if (binary) {
                channel.send(JSON.stringify(binary.meta));
                for (const chunk of chunkBytes(binary.bytes)) {
                    if (channel.bufferedAmount > BUFFERED_AMOUNT_HIGH_WATER) {
                        await waitForDrain(channel);
                    }
                    const standalone = new Uint8Array(chunk.byteLength);
                    standalone.set(chunk);
                    channel.send(standalone);
                }
                return;
            }
            channel.send(JSON.stringify(message));
        },
        subscribe(listener) {
            const onMessage = (event) => {
                if (typeof event.data === 'string') {
                    const parsed = JSON.parse(event.data);
                    if (isBinaryFileMetaMessage(parsed)) {
                        assembler.start(parsed);
                        return;
                    }
                    void listener(parsed);
                    return;
                }
                if (event.data instanceof ArrayBuffer) {
                    const done = assembler.push(new Uint8Array(event.data));
                    if (done)
                        emitAssembled(done, listener);
                    return;
                }
                if (event.data instanceof Blob) {
                    // Shouldn't happen — we set binaryType='arraybuffer' above — but keep
                    // a safe synchronous fallback that preserves order via a chain.
                    console.warn('[plat channel] unexpected Blob data; ordering fallback');
                    return;
                }
            };
            channel.addEventListener('message', onMessage);
            return () => channel.removeEventListener('message', onMessage);
        },
        close() {
            channel.close();
        },
    };
}
export function createWeriftDataChannelAdapter(channel) {
    const assembler = createAssembler();
    return {
        send(message) {
            const binary = splitBinaryFileMessage(message);
            if (binary) {
                channel.send(JSON.stringify(binary.meta));
                for (const chunk of chunkBytes(binary.bytes)) {
                    const standalone = new Uint8Array(chunk.byteLength);
                    standalone.set(chunk);
                    channel.send(standalone);
                }
                return;
            }
            channel.send(JSON.stringify(message));
        },
        subscribe(listener) {
            const subscription = channel.onMessage.subscribe((data) => {
                if (typeof data === 'string') {
                    const parsed = JSON.parse(data);
                    if (isBinaryFileMetaMessage(parsed)) {
                        assembler.start(parsed);
                        return;
                    }
                    void listener(parsed);
                    return;
                }
                const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
                const done = assembler.push(bytes);
                if (done) {
                    const reconstructed = {
                        ...done.meta,
                        result: {
                            ...done.meta.result,
                            content: done.received,
                        },
                    };
                    void listener(reconstructed);
                    return;
                }
            });
            return () => {
                subscription.unSubscribe();
            };
        },
        close() {
            channel.close();
        },
    };
}
//# sourceMappingURL=channel.js.map