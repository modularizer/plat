import { ClientError, ServerError } from '../types/errors';
import { getClientSideServerMode, parseClientSideServerAddress, } from '../client-side-server/signaling';
export function createClientSideServerTransportPlugin(options) {
    return {
        name: 'css',
        canHandle: ({ baseUrl, transportMode }) => transportMode === 'css' || baseUrl.startsWith('css://'),
        async connect(request) {
            const address = parseClientSideServerAddress(request.baseUrl);
            const channel = await options.connect({ address, mode: getClientSideServerMode(address), request });
            return { channel };
        },
        async sendRequest(connection, request) {
            const rpcRequest = {
                jsonrpc: '2.0',
                id: request.id,
                operationId: request.operationId,
                method: request.method,
                path: request.path,
                headers: stringifyHeaders(request.headers),
                input: request.params,
            };
            connection.result = await new Promise((resolve, reject) => {
                const abort = () => reject(new DOMException('Client-side server request was aborted', 'AbortError'));
                if (request.signal?.aborted) {
                    abort();
                    return;
                }
                connection.unsubscribe = connection.channel.subscribe(async (payload) => {
                    const message = payload;
                    if (!message || typeof message !== 'object' || message.id !== rpcRequest.id)
                        return;
                    if ('event' in message && message.event) {
                        await request.onEvent?.({ id: message.id, event: message.event, data: message.data });
                        return;
                    }
                    connection.unsubscribe?.();
                    request.signal?.removeEventListener('abort', abort);
                    resolve(message);
                });
                request.signal?.addEventListener('abort', abort, { once: true });
                void connection.channel.send(rpcRequest);
            });
        },
        async getResult(connection, request) {
            const response = connection.result;
            if (response.ok)
                return { id: request.id, ok: true, result: response.result };
            const status = response.error.status ?? 500;
            const common = {
                url: request.baseUrl,
                method: request.method,
                status,
                statusText: response.error.message,
                headers: new Headers(),
                bodyText: JSON.stringify(response.error.data ?? response.error.message),
                bodyJson: response.error.data ?? response.error.message,
            };
            return {
                id: request.id,
                ok: false,
                error: status >= 400 && status < 500 ? new ClientError(common) : new ServerError(common),
            };
        },
        async disconnect(connection) {
            connection.unsubscribe?.();
            await connection.channel.close?.();
        },
    };
}
function stringifyHeaders(headers) {
    const result = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined)
            result[key] = String(value);
    }
    return result;
}
//# sourceMappingURL=css-transport-plugin.js.map