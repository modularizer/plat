import type { HttpMethod } from '../types/http';
import type { ResponseFormat } from '../types/client';
import type { OpenAPIClientTransportPlugin } from './transport-plugin';
interface HttpTransportRuntime {
    baseUrl: string;
    timeoutMs: number;
    fetchInit?: RequestInit;
    fetchHttp(request: {
        method: HttpMethod;
        url: string;
        headers: Record<string, string | number | boolean | undefined>;
        body?: BodyInit;
        signal?: AbortSignal;
        timeoutMs: number;
        fetchInit?: RequestInit;
    }): Promise<Response>;
    parseJson(text: string): unknown;
    parseResponse<T>(response: Response, format: ResponseFormat): Promise<T>;
    detectResponseFormat(response: Response, specContentTypes: string[]): ResponseFormat;
    createDeferredHandle<TResult>(id: string, options?: unknown): any;
}
interface HttpConnection {
    response?: Response;
}
export declare function createHttpTransportPlugin(runtime: HttpTransportRuntime): OpenAPIClientTransportPlugin<HttpConnection>;
export {};
//# sourceMappingURL=http-transport-plugin.d.ts.map