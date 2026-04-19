import { ClientError, ServerError } from '../types/errors';
export function createRpcTransportPlugin(runtime) {
    return {
        name: 'rpc',
        canHandle: ({ transportMode }) => transportMode === 'rpc',
        async connect() {
            return { socket: await runtime.ensureRpcSocket() };
        },
        async sendRequest(connection, request) {
            const rpcRequest = {
                jsonrpc: '2.0',
                id: runtime.nextRequestId('rpc'),
                operationId: request.operationId,
                method: request.method,
                path: request.path,
                headers: runtime.stringifyHeaders(request.headers),
                input: request.params,
            };
            connection.result = await new Promise((resolve, reject) => {
                const abort = () => {
                    void runtime.sendRpcCancel(rpcRequest.id);
                    reject(new DOMException('RPC request was aborted', 'AbortError'));
                };
                if (request.signal?.aborted) {
                    abort();
                    return;
                }
                const onMessage = async (event) => {
                    if (!(event instanceof MessageEvent))
                        return;
                    const payload = runtime.parseJson(String(event.data));
                    if (!payload || typeof payload !== 'object' || payload.id !== rpcRequest.id)
                        return;
                    if ('event' in payload && payload.event) {
                        await request.onEvent?.({ id: payload.id, event: payload.event, data: payload.data });
                        return;
                    }
                    connection.socket.removeEventListener('message', onMessage);
                    request.signal?.removeEventListener('abort', abort);
                    resolve(payload);
                };
                connection.socket.addEventListener('message', onMessage);
                request.signal?.addEventListener('abort', abort, { once: true });
                connection.socket.send(JSON.stringify(rpcRequest));
            });
        },
        async getResult(connection, request) {
            const response = connection.result;
            if (response.ok)
                return { id: request.id, ok: true, result: response.result };
            const status = response.error.status ?? 500;
            const common = {
                url: runtime.resolveRpcUrl(),
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
    };
}
//# sourceMappingURL=rpc-transport-plugin.js.map