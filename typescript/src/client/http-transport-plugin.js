import { ClientError, ServerError } from '../types/errors';
export function createHttpTransportPlugin(runtime) {
    return {
        name: 'http',
        canHandle: ({ transportMode }) => transportMode === 'http',
        connect() {
            return {};
        },
        async sendRequest(connection, request) {
            const { method, headers } = request;
            const url = request.url ?? `${runtime.baseUrl}${request.path}`;
            connection.response = await runtime.fetchHttp({
                method: method,
                url,
                headers,
                body: request.body,
                signal: request.signal,
                timeoutMs: request.timeoutMs ?? runtime.timeoutMs,
                fetchInit: runtime.fetchInit,
            });
        },
        async getResult(connection, request) {
            const response = connection.response;
            const url = request.url ?? `${runtime.baseUrl}${request.path}`;
            if (response.ok) {
                if (request.execution === 'deferred' && response.status === 202) {
                    const payload = await response.json();
                    return { id: request.id, ok: true, result: runtime.createDeferredHandle(payload.id, request.options) };
                }
                return {
                    id: request.id,
                    ok: true,
                    result: await runtime.parseResponse(response, request.responseFormat ?? runtime.detectResponseFormat(response, request.responseContentTypes ?? [])),
                };
            }
            const bodyText = await response.text();
            const bodyJson = runtime.parseJson(bodyText);
            return {
                id: request.id,
                ok: false,
                error: response.status >= 400 && response.status < 500
                    ? new ClientError({ url, method: request.method, status: response.status, statusText: response.statusText, headers: response.headers, bodyText, bodyJson })
                    : new ServerError({ url, method: request.method, status: response.status, statusText: response.statusText, headers: response.headers, bodyText, bodyJson }),
            };
        },
    };
}
//# sourceMappingURL=http-transport-plugin.js.map