import { ClientError, ServerError } from '../types/errors';
import { ResponseFormats, RequestFormats } from '../types/client';
import { HttpMethods, ProxyProps, ParamLocations, ContentTypes } from '../types/http';
import { DEFAULT_RPC_PATH, } from '../rpc';
import { extractToolsFromOpenAPI } from './tools';
import { createHttpTransportPlugin } from './http-transport-plugin';
import { createRpcTransportPlugin } from './rpc-transport-plugin';
import { executeClientTransportPlugin } from './transport-plugin';
import { createClientSideServerMQTTWebRTCTransportPlugin } from '../client-side-server/mqtt-webrtc';
class OpenAPIClientImpl {
    openAPISpec;
    baseUrl;
    headers;
    fetchInit;
    timeoutMs;
    retryConfig;
    transportMode;
    rpcPath;
    callsPath;
    hooks;
    transportPlugins;
    openapi;
    cachedTools;
    rpcSocket;
    rpcSocketPromise;
    rpcPending = new Map();
    rpcCounter = 0;
    /** Typed accessor for spec paths, handling the optional field. */
    get _paths() {
        return (this.openapi.paths ?? {});
    }
    _opIndex;
    _segTree;
    _rootProxy;
    constructor(openAPISpec, options) {
        this.openAPISpec = openAPISpec;
        this.baseUrl = options.baseUrl;
        console.warn("building client proxy", options.baseUrl);
        this.headers = this.normalizeHeaders(options.headers);
        this.fetchInit = options.fetchInit;
        this.timeoutMs = options.timeoutMs ?? 30000;
        this.retryConfig = {
            maxAttempts: options.retry?.maxAttempts ?? 3,
            delayMs: options.retry?.delayMs ?? 1000,
            backoffMultiplier: options.retry?.backoffMultiplier ?? 2,
        };
        this.transportMode = this.resolveTransportMode(options.transport);
        this.rpcPath = options.rpcPath ?? DEFAULT_RPC_PATH;
        this.callsPath = options.callsPath ?? '/platCall';
        this.hooks = options.hooks;
        const builtInTransportRuntime = this.createBuiltInTransportRuntime();
        const defaultTransportPlugins = this.baseUrl.startsWith('css://')
            ? [createClientSideServerMQTTWebRTCTransportPlugin()]
            : [];
        this.transportPlugins = [
            ...(options.transportPlugins ?? []),
            ...defaultTransportPlugins,
            createHttpTransportPlugin(builtInTransportRuntime),
            createRpcTransportPlugin(builtInTransportRuntime),
        ];
        this.openapi = openAPISpec;
        // Return a Proxy that enables dot-notation route access:
        //   client.listProducts({ limit: 10 })
        //   client.products.listProducts({ limit: 10 })
        //   client.listProducts.get({ limit: 10 })
        //   client.routes → ['listProducts', 'products', ...]
        //   client.children → { listProducts: proxy, products: proxy, ... }
        const rootProxy = new Proxy(this, {
            get: (target, prop, receiver) => {
                if (typeof prop === 'symbol' || Reflect.has(target, prop)) {
                    return Reflect.get(target, prop, receiver);
                }
                const p = String(prop);
                if (p === ProxyProps.ROOT)
                    return rootProxy;
                if (p === ProxyProps.CLIENT)
                    return target;
                if (p === ProxyProps.ROUTES)
                    return target._rootRouteNames();
                if (p === ProxyProps.CHILDREN)
                    return target._rootChildren();
                return target._resolveRoute(p);
            },
        });
        this._rootProxy = rootProxy;
        return rootProxy;
    }
    normalizeHeaders(headers) {
        if (!headers)
            return {};
        if (headers instanceof Headers) {
            const result = {};
            headers.forEach((value, key) => {
                result[key] = value;
            });
            return result;
        }
        if (Array.isArray(headers)) {
            return Object.fromEntries(headers);
        }
        return headers;
    }
    /** Coerce all header values to strings for the fetch API. */
    stringifyHeaders(headers) {
        const out = {};
        for (const [k, v] of Object.entries(headers)) {
            if (v !== undefined)
                out[k] = String(v);
        }
        return out;
    }
    async buildHeaders() {
        return {};
    }
    resolveTransportMode(mode) {
        if (mode && mode !== 'auto')
            return mode;
        if (/^file:\/\//i.test(this.baseUrl))
            return 'file';
        if (/^css:\/\//i.test(this.baseUrl))
            return 'css';
        return /^wss?:\/\//i.test(this.baseUrl) ? 'rpc' : 'http';
    }
    resolveTransportPlugin() {
        return this.transportPlugins.find((plugin) => plugin.canHandle({ baseUrl: this.baseUrl, transportMode: this.transportMode }));
    }
    createBuiltInTransportRuntime() {
        return {
            baseUrl: this.baseUrl,
            callsPath: this.callsPath,
            delay: (ms) => this.delay(ms),
            nextRequestId: (prefix) => `${prefix}-${this.nextRpcId()}`,
            stringifyHeaders: (headers) => this.stringifyHeaders(headers),
            parseJson: (text) => this.tryParseJson(text),
            resolveRpcUrl: () => this.resolveRpcUrl(),
            ensureRpcSocket: () => this.ensureRpcSocket(),
            sendRpcCancel: (id) => this.sendRpcCancel(id),
            createDeferredHandle: (id, options) => this.createDeferredHandle(id, options),
            fetchHttp: async (request) => {
                return await Promise.race([
                    fetch(request.url, {
                        ...(request.fetchInit ?? this.fetchInit),
                        method: request.method,
                        headers: this.stringifyHeaders(request.headers),
                        body: request.body ?? undefined,
                        signal: request.signal,
                    }),
                    this.createTimeoutPromise(request.timeoutMs),
                ]);
            },
            parseResponse: (response, format) => this._parseResponse(response, format),
            detectResponseFormat: (response, specContentTypes) => this._detectResponseFormat(response, specContentTypes),
            fetchInit: this.fetchInit,
            timeoutMs: this.timeoutMs,
        };
    }
    /**
     * Get tool definitions for AI integrations (Claude, OpenAI, etc)
     * Tools are extracted from the OpenAPI spec and cached
     */
    get tools() {
        if (!this.cachedTools) {
            this.cachedTools = extractToolsFromOpenAPI(this.openAPISpec);
        }
        return this.cachedTools;
    }
    async get(path, params, options) {
        return this.call(HttpMethods.GET, path, params, options);
    }
    async post(path, params, options) {
        return this.call(HttpMethods.POST, path, params, options);
    }
    async put(path, params, options) {
        return this.call(HttpMethods.PUT, path, params, options);
    }
    async patch(path, params, options) {
        return this.call(HttpMethods.PATCH, path, params, options);
    }
    async delete(path, params, options) {
        return this.call(HttpMethods.DELETE, path, params, options);
    }
    async call(method, path, params, options) {
        console.log({ params, options, ok: 5 });
        // Find the operation in the OpenAPI spec by method and path
        const operation = this.findOperationByPath(method, path);
        if (!operation) {
            throw new Error(`Operation ${method} ${path} not found in OpenAPI spec`);
        }
        const { pathParams, queryParams, headerParams, requestBody, requestContentTypes, responseContentTypes } = operation;
        // Cast params to a plain record for runtime property access
        const p = params;
        // Replace path parameters
        let url = path;
        pathParams.forEach((param) => {
            const value = p[param];
            if (!value) {
                throw new Error(`Missing required path parameter: ${param}`);
            }
            url = url.replace(`{${param}}`, String(value));
        });
        // Add query parameters
        const queryString = new URLSearchParams();
        queryParams.forEach((param) => {
            if (param in p && p[param] !== undefined) {
                queryString.append(param, String(p[param]));
            }
        });
        if (queryString.toString()) {
            url += `?${queryString.toString()}`;
        }
        const fullUrl = `${this.baseUrl}${url}`;
        // Prepare request
        let headers = {
            'Content-Type': ContentTypes.JSON,
            ...this.headers,
            ...(await this.buildHeaders()),
        };
        if (options?.headers) {
            const optionHeaders = this.normalizeHeaders(options.headers);
            Object.assign(headers, optionHeaders);
        }
        // Set header params from the params object (declared via `in: 'header'` in the spec)
        for (const name of headerParams) {
            if (name in p && p[name] !== undefined) {
                headers[name] = String(p[name]);
            }
        }
        // Call buildHeaders hook
        const requestContext = { method, path: url, url: fullUrl, headers };
        if (this.hooks?.buildHeaders) {
            headers = await this.hooks.buildHeaders(headers, requestContext);
        }
        if (options?.execution === 'deferred') {
            headers['X-PLAT-Execution'] = 'deferred';
        }
        // Resolve timeout and retry config with per-call overrides
        const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
        // Handle retry disabled case
        const retryDisabled = options?.retry === false;
        const optionsRetry = options?.retry && typeof options.retry === 'object' ? options.retry : null;
        const retryConfig = {
            maxAttempts: retryDisabled
                ? 1
                : optionsRetry?.maxAttempts ?? this.retryConfig.maxAttempts,
            delayMs: retryDisabled
                ? 0
                : optionsRetry?.retryDelayMs && typeof optionsRetry.retryDelayMs === 'number'
                    ? optionsRetry.retryDelayMs
                    : this.retryConfig.delayMs,
        };
        // Serialize request body based on format
        let body;
        console.log({ p, requestBody, bod: options?.body });
        if (options?.body) {
            // Raw body passthrough
            body = options.body;
        }
        else {
            // Prefer explicit `_body` (lets callers mix a body with path/query/header
            // params in one args object). Otherwise treat the caller's leftover
            // fields — everything not consumed as a path/query/header param — as the
            // body, so the natural API `client.submitGuess({ sessionId, guess })`
            // works without requiring a manual `_body` wrapper.
            const payload = (p._body !== undefined)
                ? p._body
                : pickBodyFields(p, pathParams, queryParams, headerParams);
            const reqFormat = options?.requestFormat
                ?? this._detectRequestFormat(payload, requestContentTypes);
            if (reqFormat === RequestFormats.FORM) {
                const form = new URLSearchParams();
                for (const [k, v] of Object.entries(payload)) {
                    if (v !== undefined)
                        form.append(k, String(v));
                }
                body = form.toString();
                headers['Content-Type'] = ContentTypes.FORM;
            }
            else if (reqFormat === RequestFormats.MULTIPART) {
                const form = new FormData();
                for (const [k, v] of Object.entries(payload)) {
                    if (v instanceof Blob || typeof v === 'string') {
                        form.append(k, v);
                    }
                    else if (v !== undefined) {
                        form.append(k, String(v));
                    }
                }
                body = form;
                // Let the runtime set Content-Type with boundary
                delete headers['Content-Type'];
            }
            else if (reqFormat === RequestFormats.RAW) {
                body = payload;
            }
            else {
                body = JSON.stringify(payload);
            }
        }
        const customTransport = this.resolveTransportPlugin();
        if (customTransport) {
            return await executeClientTransportPlugin(customTransport, {
                id: customTransport.name === 'file' ? `file-${this.nextRpcId()}` : this.nextRpcId(),
                baseUrl: this.baseUrl,
                transportMode: this.transportMode,
                method,
                path: url,
                url: fullUrl,
                operationId: operation.operationId,
                params,
                headers,
                body,
                timeoutMs,
                execution: options?.execution,
                requestContext,
                signal: options?.signal,
                options,
                onEvent: options?.onRpcEvent,
                responseFormat: options?.responseFormat,
                responseContentTypes,
            });
        }
        if (this.transportMode === 'file') {
            throw new Error('File transport is not built into @modularizer/plat-client. Pass a custom transport plugin if you need to handle file:// URLs.');
        }
        // Make request with retries
        let lastError = null;
        for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
            try {
                // Call pre-request hook
                if (this.hooks?.onPreRequest) {
                    await this.hooks.onPreRequest(requestContext);
                }
                const response = await Promise.race([
                    fetch(fullUrl, {
                        ...this.fetchInit,
                        method,
                        headers: this.stringifyHeaders(headers),
                        body: body ?? undefined,
                        signal: options?.signal,
                    }),
                    this.createTimeoutPromise(timeoutMs),
                ]);
                // Call post-request hook
                if (this.hooks?.onPostRequest) {
                    await this.hooks.onPostRequest(requestContext, response);
                }
                if (response.ok) {
                    if (options?.execution === 'deferred' && response.status === 202) {
                        const payload = await response.json();
                        return this.createDeferredHandle(payload.id, options);
                    }
                    return this._parseResponse(response, options?.responseFormat
                        ?? this._detectResponseFormat(response, responseContentTypes));
                }
                const bodyText = await response.text();
                const bodyJson = this.tryParseJson(bodyText);
                const error = response.status >= 400 && response.status < 500
                    ? new ClientError({
                        url: fullUrl,
                        method,
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers,
                        bodyText,
                        bodyJson,
                    })
                    : new ServerError({
                        url: fullUrl,
                        method,
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers,
                        bodyText,
                        bodyJson,
                    });
                const retryContext = {
                    attempt,
                    maxAttempts: retryConfig.maxAttempts,
                    status: response.status,
                    error,
                };
                // Call onError hook
                if (this.hooks?.onError) {
                    await this.hooks.onError(error, retryContext);
                }
                // Determine if we should retry using hook or default logic
                const shouldRetryRequest = this.hooks?.shouldRetry?.(response.status, retryContext) ??
                    response.status >= 500;
                if (!shouldRetryRequest || attempt === retryConfig.maxAttempts) {
                    throw error;
                }
                lastError = error;
                // Delay before retry with exponential backoff
                await this.delay(retryConfig.delayMs * Math.pow(2, attempt - 1));
            }
            catch (error) {
                if (error instanceof ClientError || error instanceof ServerError) {
                    const retryContext = {
                        attempt,
                        maxAttempts: retryConfig.maxAttempts,
                        error,
                    };
                    // Call onError hook for client/server errors
                    if (this.hooks?.onError) {
                        await this.hooks.onError(error, retryContext);
                    }
                    throw error;
                }
                lastError = error;
                if (attempt < retryConfig.maxAttempts) {
                    await this.delay(retryConfig.delayMs * Math.pow(2, attempt - 1));
                }
            }
        }
        throw lastError || new Error('Request failed after retries');
    }
    findOperationByPath(method, path) {
        const pathItem = this._paths[path];
        if (!pathItem) {
            return null;
        }
        const op = pathItem[method.toLowerCase()];
        if (!op) {
            return null;
        }
        const pathParams = this.extractPathParams(path);
        const queryParams = this.extractQueryParams(op);
        const headerParams = this.extractHeaderParams(op);
        const reqBody = op.requestBody;
        const requestBody = !!reqBody;
        const reqBodyContent = reqBody?.content;
        const requestContentTypes = reqBodyContent ? Object.keys(reqBodyContent) : [];
        // Collect response content types from the success response (200 or 201)
        const responses = op.responses;
        const successResponse = responses?.['200'] ?? responses?.['201'];
        const respContent = successResponse?.content;
        const responseContentTypes = respContent ? Object.keys(respContent) : [];
        return {
            operationId: typeof op.operationId === 'string' ? op.operationId : undefined,
            pathParams,
            queryParams,
            headerParams,
            requestBody,
            requestContentTypes,
            responseContentTypes,
        };
    }
    nextRpcId() {
        this.rpcCounter += 1;
        return `rpc-${this.rpcCounter}`;
    }
    resolveRpcUrl() {
        const url = new URL(this.baseUrl);
        if (!/^wss?:$/i.test(url.protocol)) {
            throw new Error(`RPC transport requires ws:// or wss:// baseUrl, got ${this.baseUrl}`);
        }
        if (!url.pathname || url.pathname === '/' || url.pathname === '') {
            url.pathname = this.rpcPath;
        }
        return url.toString();
    }
    async sendRpcCancel(id) {
        try {
            const socket = await this.ensureRpcSocket();
            socket.send(JSON.stringify({
                jsonrpc: '2.0',
                id,
                method: 'CANCEL',
                path: '',
                cancel: true,
            }));
        }
        catch {
            // Best effort; cancellation should still reject locally even if the socket is unavailable.
        }
    }
    async ensureRpcSocket() {
        if (this.rpcSocket && this.rpcSocket.readyState === WebSocket.OPEN) {
            return this.rpcSocket;
        }
        if (this.rpcSocketPromise)
            return this.rpcSocketPromise;
        this.rpcSocketPromise = new Promise((resolve, reject) => {
            const socket = new WebSocket(this.resolveRpcUrl());
            socket.addEventListener('open', () => {
                this.rpcSocket = socket;
                resolve(socket);
            }, { once: true });
            socket.addEventListener('message', (event) => {
                const payload = this.tryParseJson(String(event.data));
                if (!payload || typeof payload !== 'object' || !('id' in payload))
                    return;
                const pending = this.rpcPending.get(String(payload.id));
                if (!pending)
                    return;
                if ('event' in payload && typeof payload.event === 'string') {
                    void pending.onEvent?.({
                        id: String(payload.id),
                        event: payload.event,
                        data: payload.data,
                    });
                    return;
                }
                this.rpcPending.delete(String(payload.id));
                pending.resolve(payload);
            });
            socket.addEventListener('close', () => {
                this.rpcSocket = undefined;
                this.rpcSocketPromise = undefined;
                for (const [id, pending] of Array.from(this.rpcPending.entries())) {
                    this.rpcPending.delete(id);
                    pending.reject(new Error('RPC socket closed'));
                }
            }, { once: true });
            socket.addEventListener('error', () => {
                reject(new Error(`Failed to connect to RPC socket at ${this.resolveRpcUrl()}`));
            }, { once: true });
        });
        return this.rpcSocketPromise;
    }
    createDeferredHandle(id, options) {
        return {
            id,
            status: async () => {
                return await this.fetchDeferredJson(`${this.callsPath}Status?id=${encodeURIComponent(id)}`, options);
            },
            events: async (args) => {
                const search = new URLSearchParams();
                search.set('id', id);
                if (args?.since)
                    search.set('since', String(args.since));
                if (args?.event)
                    search.set('event', args.event);
                const payload = await this.fetchDeferredJson(`${this.callsPath}Events?${search.toString()}`, options);
                return payload.events;
            },
            logs: async (since) => {
                const search = new URLSearchParams();
                search.set('id', id);
                if (since)
                    search.set('since', String(since));
                search.set('event', 'log');
                const payload = await this.fetchDeferredJson(`${this.callsPath}Events?${search.toString()}`, options);
                return payload.events;
            },
            result: async () => {
                const payload = await this.fetchDeferredJson(`${this.callsPath}Result?id=${encodeURIComponent(id)}`, options);
                if (payload.status === 'completed') {
                    return payload.result;
                }
                if (payload.status === 'failed') {
                    throw new Error(payload.error?.message || 'Deferred call failed');
                }
                if (payload.status === 'cancelled') {
                    throw new DOMException('Deferred call was cancelled', 'AbortError');
                }
                throw new Error(`Deferred call ${id} is still ${payload.status}`);
            },
            wait: async (args) => {
                const pollIntervalMs = args?.pollIntervalMs ?? options?.pollIntervalMs ?? 1000;
                while (true) {
                    if (args?.signal?.aborted) {
                        throw new DOMException('Deferred wait aborted', 'AbortError');
                    }
                    const snapshot = await this.fetchDeferredJson(`${this.callsPath}Result?id=${encodeURIComponent(id)}`, options);
                    if (snapshot.status === 'completed') {
                        return snapshot.result;
                    }
                    if (snapshot.status === 'failed') {
                        throw new Error(snapshot.error?.message || 'Deferred call failed');
                    }
                    if (snapshot.status === 'cancelled') {
                        throw new DOMException('Deferred call was cancelled', 'AbortError');
                    }
                    await this.delay(pollIntervalMs);
                }
            },
            cancel: async () => {
                const payload = await this.fetchDeferredJson(`${this.callsPath}Cancel`, options, 'POST', { id });
                return payload.cancelled;
            },
        };
    }
    async fetchDeferredJson(path, options, method = 'GET', bodyPayload) {
        const headers = {
            ...this.stringifyHeaders({
                ...this.headers,
                ...(await this.buildHeaders()),
            }),
            ...(options?.headers ? this.stringifyHeaders(this.normalizeHeaders(options.headers)) : {}),
        };
        const response = await fetch(`${this.baseUrl}${path}`, {
            ...this.fetchInit,
            method,
            headers: bodyPayload === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
            body: bodyPayload === undefined ? undefined : JSON.stringify(bodyPayload),
            signal: options?.signal,
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error((payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string')
                ? payload.error
                : `Deferred call request failed with ${response.status}`);
        }
        return payload;
    }
    extractPathParams(path) {
        const matches = path.match(/{(\w+)}/g) || [];
        return matches.map((m) => m.slice(1, -1));
    }
    extractQueryParams(operation) {
        const params = (operation.parameters ?? []);
        return params
            .filter((p) => p.in === ParamLocations.QUERY)
            .map((p) => p.name);
    }
    extractHeaderParams(operation) {
        const params = (operation.parameters ?? []);
        return params
            .filter((p) => p.in === ParamLocations.HEADER)
            .map((p) => p.name);
    }
    async _parseResponse(response, format) {
        switch (format) {
            case ResponseFormats.RAW: return response;
            case ResponseFormats.TEXT: return await response.text();
            case ResponseFormats.BLOB: return await response.blob();
            case ResponseFormats.ARRAY_BUFFER: return await response.arrayBuffer();
            default: return await response.json();
        }
    }
    createTimeoutPromise(timeoutMs) {
        return new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), timeoutMs));
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    tryParseJson(text) {
        try {
            return JSON.parse(text);
        }
        catch {
            return text;
        }
    }
    /**
     * Detect request format from body values and OpenAPI spec content types.
     * Priority: Blob/File in values → spec declares multipart → spec declares form → json
     */
    _detectRequestFormat(payload, specContentTypes) {
        // If any value is a Blob or File, it must be multipart
        for (const v of Object.values(payload)) {
            if (v instanceof Blob)
                return RequestFormats.MULTIPART;
        }
        // Check what the OpenAPI spec declares
        for (const ct of specContentTypes) {
            if (ct.includes('multipart'))
                return RequestFormats.MULTIPART;
            if (ct.includes('x-www-form-urlencoded'))
                return RequestFormats.FORM;
        }
        return RequestFormats.JSON;
    }
    /** Detect the best response format from the OpenAPI spec and response headers. */
    _detectResponseFormat(response, specContentTypes) {
        // Check spec-declared content types first (known at build time)
        if (specContentTypes.length > 0) {
            const detected = this._contentTypeToFormat(specContentTypes[0]);
            if (detected)
                return detected;
        }
        // Fall back to the actual response Content-Type header
        const ct = response.headers.get('content-type');
        if (ct) {
            const detected = this._contentTypeToFormat(ct);
            if (detected)
                return detected;
        }
        return ResponseFormats.JSON;
    }
    /** Map a MIME content type string to a ResponseFormat. */
    _contentTypeToFormat(ct) {
        if (ct.includes('json'))
            return ResponseFormats.JSON;
        if (ct.startsWith('text/'))
            return ResponseFormats.TEXT;
        if (ct.includes('image/') || ct.includes('audio/') || ct.includes('video/') || ct.includes('octet-stream')) {
            return ResponseFormats.BLOB;
        }
        return null;
    }
    // ── Route proxy ────────────────────────────────────────────
    _ensureIndexes() {
        if (this._opIndex)
            return;
        this._opIndex = new Map();
        this._segTree = { methods: new Map(), children: new Map() };
        for (const [urlPath, pathItem] of Object.entries(this._paths)) {
            const segments = urlPath.split('/').filter(Boolean);
            // Walk/create segment tree nodes
            let node = this._segTree;
            for (const seg of segments) {
                if (!node.children.has(seg)) {
                    node.children.set(seg, { methods: new Map(), children: new Map() });
                }
                node = node.children.get(seg);
            }
            // Register each HTTP method at this path
            for (const [httpMethod, op] of Object.entries(pathItem)) {
                const method = httpMethod.toUpperCase();
                const operation = op;
                const routeOp = {
                    method,
                    path: urlPath,
                    operation,
                };
                node.methods.set(method, routeOp);
                const opId = operation.operationId;
                if (opId) {
                    if (!this._opIndex.has(opId))
                        this._opIndex.set(opId, []);
                    this._opIndex.get(opId).push(routeOp);
                }
            }
        }
    }
    /** All unique route names accessible from the root (operationIds + top-level segments). */
    _rootRouteNames() {
        this._ensureIndexes();
        const names = new Set();
        this._opIndex.forEach((_, name) => names.add(name));
        this._segTree.children.forEach((_, name) => names.add(name));
        return Array.from(names);
    }
    /** Object mapping each root route name → its route proxy. */
    _rootChildren() {
        const out = {};
        for (const name of this._rootRouteNames()) {
            out[name] = this._resolveRoute(name);
        }
        return out;
    }
    /**
     * Resolve a property name to a callable route proxy.
     * Checks operationId first, then path segment children.
     */
    _resolveRoute(name) {
        this._ensureIndexes();
        const ops = this._opIndex.get(name) ?? [];
        const segChild = this._segTree.children.get(name);
        if (ops.length === 0 && !segChild)
            return undefined;
        return this._createCallableNode(ops, segChild ?? null);
    }
    /**
     * Create a callable Proxy node for a route.
     *
     * The node is a function that can be called directly (if exactly one
     * HTTP method is registered) and also supports:
     *   .get(params)   .post(params)   etc. — explicit HTTP method
     *   .child         — nested path segment navigation
     */
    _createCallableNode(ops, segNode) {
        // Merge methods from operationId matches and segment node
        const methods = new Map();
        for (const op of ops)
            methods.set(op.method, op);
        if (segNode) {
            segNode.methods.forEach((routeOp, method) => {
                if (!methods.has(method))
                    methods.set(method, routeOp);
            });
        }
        // Build the .spec object — raw OpenAPI operation(s) with path/method added
        const specObj = this._buildSpec(methods);
        const client = this;
        // Direct-call function: works when exactly one HTTP method
        const fn = function (params, options) {
            if (methods.size === 0) {
                throw new Error('No HTTP methods at this route — use a child segment');
            }
            if (methods.size > 1) {
                const available = Array.from(methods.keys()).join(', ');
                throw new Error(`Ambiguous: multiple methods (${available}). Use .get(), .post(), etc.`);
            }
            const [, routeOp] = Array.from(methods.entries())[0];
            return client._callRoute(routeOp, params ?? {}, options);
        };
        return new Proxy(fn, {
            get: (_target, prop) => {
                if (typeof prop === 'symbol')
                    return Reflect.get(fn, prop);
                const p = String(prop);
                if (p === ProxyProps.THEN)
                    return undefined;
                if (p === ProxyProps.ROOT)
                    return client._rootProxy;
                if (p === ProxyProps.CLIENT)
                    return client;
                if (p === ProxyProps.SPEC)
                    return specObj;
                if (p === ProxyProps.ROUTES) {
                    return segNode ? Array.from(segNode.children.keys()) : [];
                }
                if (p === ProxyProps.CHILDREN) {
                    const out = {};
                    if (segNode) {
                        segNode.children.forEach((child, name) => {
                            out[name] = client._createCallableNode([], child);
                        });
                    }
                    return out;
                }
                // HTTP method accessor: .get(), .post(), .put(), .patch(), .delete()
                const upper = p.toUpperCase();
                if (upper in HttpMethods) {
                    const httpMethod = upper;
                    const routeOp = methods.get(httpMethod);
                    if (routeOp) {
                        return (params, options) => client._callRoute(routeOp, params ?? {}, options);
                    }
                }
                // Child segment navigation
                if (segNode) {
                    const child = segNode.children.get(p);
                    if (child)
                        return client._createCallableNode([], child);
                }
                // Fall through to native function properties (bind, call, apply, etc.)
                return Reflect.get(fn, prop);
            },
            apply: (_target, _thisArg, args) => {
                return fn(args[0], args[1]);
            },
        });
    }
    /**
     * Build a .spec object from the route's registered methods.
     *
     * Uses standard OpenAPI field names:
     *   operationId, summary, description, parameters,
     *   requestBody, responses
     *
     * Single-method routes return the operation directly.
     * Multi-method routes return { GET: {...}, POST: {...} }.
     */
    _callRoute(routeOp, params, options) {
        return this.call(routeOp.method, routeOp.path, params, options);
    }
    _buildSpec(methods) {
        const buildOne = (httpMethod, routeOp) => {
            const op = routeOp.operation;
            return {
                method: httpMethod,
                path: routeOp.path,
                operationId: op.operationId,
                summary: op.summary,
                description: op.description,
                tags: op.tags,
                parameters: op.parameters,
                requestBody: op.requestBody,
                responses: op.responses,
            };
        };
        if (methods.size === 1) {
            const [method, routeOp] = Array.from(methods.entries())[0];
            return buildOne(method, routeOp);
        }
        const spec = {};
        methods.forEach((routeOp, method) => {
            spec[method] = buildOne(method, routeOp);
        });
        return spec;
    }
}
function pickBodyFields(p, pathParams, queryParams, headerParams) {
    const consumed = new Set([...pathParams, ...queryParams, ...headerParams, '_body']);
    console.log({ p, pathParams, queryParams, headerParams });
    const out = {};
    for (const k of Object.keys(p)) {
        if (!consumed.has(k))
            out[k] = p[k];
    }
    return out;
}
/**
 * Fetches the OpenAPI spec from the given baseUrl and returns a new OpenAPIClient instance.
 * @param baseUrl The base URL of the API server
 * @param options Optional OpenAPIClient options
 */
export async function createClient(baseUrl, options) {
    const spec = await fetch(`${baseUrl.replace(/\/$/, '')}/openapi.json`).then(r => r.json());
    return new OpenAPIClient(spec, { ...options, baseUrl });
}
export const OpenAPIClient = OpenAPIClientImpl;
//# sourceMappingURL=openapi-client.js.map