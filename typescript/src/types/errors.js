function asErrorPayload(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    return value;
}
function buildHttpErrorMessage(status, statusText, bodyJson, bodyText) {
    const jsonMessage = bodyJson &&
        typeof bodyJson === 'object' &&
        'message' in bodyJson &&
        typeof bodyJson.message === 'string'
        ? bodyJson.message
        : undefined;
    return jsonMessage || bodyText || `HTTP ${status} ${statusText}`;
}
export class HttpError extends Error {
    statusCode;
    data;
    constructor(statusCode, message, data) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = statusCode;
        this.data = data;
    }
}
export class HttpProxyError extends Error {
    route;
    url;
    method;
    status;
    statusText;
    headers;
    bodyText;
    bodyJson;
    cause;
    constructor(args) {
        super(args.message, { cause: args.cause });
        this.name = args.name;
        this.route = args.route;
        this.url = args.url;
        this.method = args.method;
        this.status = args.status;
        this.statusText = args.statusText;
        this.headers = args.headers;
        this.bodyText = args.bodyText;
        this.bodyJson = args.bodyJson;
        this.cause = args.cause;
    }
}
export class ClientError extends HttpProxyError {
    payload;
    constructor(args) {
        super({
            name: 'ClientError',
            message: buildHttpErrorMessage(args.status, args.statusText, args.bodyJson, args.bodyText),
            route: args.route,
            url: args.url,
            method: args.method,
            status: args.status,
            statusText: args.statusText,
            headers: args.headers,
            bodyText: args.bodyText,
            bodyJson: args.bodyJson,
            cause: undefined,
        });
        this.payload = asErrorPayload(args.bodyJson);
    }
    get isUnauthorized() {
        return this.status === 401;
    }
    get isForbidden() {
        return this.status === 403;
    }
    get isNotFound() {
        return this.status === 404;
    }
    get isConflict() {
        return this.status === 409;
    }
    get isUnprocessable() {
        return this.status === 422;
    }
    get isRateLimited() {
        return this.status === 429;
    }
    get retryAfterMs() {
        const raw = this.headers?.get('retry-after');
        if (!raw)
            return undefined;
        const seconds = Number(raw);
        if (Number.isFinite(seconds)) {
            return Math.max(0, seconds * 1000);
        }
        const dateMs = Date.parse(raw);
        if (Number.isFinite(dateMs)) {
            return Math.max(0, dateMs - Date.now());
        }
        return undefined;
    }
}
export class ServerError extends HttpProxyError {
    payload;
    constructor(args) {
        super({
            name: 'ServerError',
            message: buildHttpErrorMessage(args.status, args.statusText, args.bodyJson, args.bodyText),
            route: args.route,
            url: args.url,
            method: args.method,
            status: args.status,
            statusText: args.statusText,
            headers: args.headers,
            bodyText: args.bodyText,
            bodyJson: args.bodyJson,
            cause: undefined,
        });
        this.payload = asErrorPayload(args.bodyJson);
    }
}
export class NetworkError extends HttpProxyError {
    constructor(args) {
        super({
            name: 'NetworkError',
            message: `Network error calling ${args.method} ${args.url}`,
            route: args.route,
            url: args.url,
            method: args.method,
            status: undefined,
            statusText: undefined,
            headers: undefined,
            bodyText: undefined,
            bodyJson: undefined,
            cause: args.cause,
        });
    }
}
export class TimeoutError extends HttpProxyError {
    constructor(args) {
        super({
            name: 'TimeoutError',
            message: `Timed out calling ${args.method} ${args.url}`,
            route: args.route,
            url: args.url,
            method: args.method,
            status: undefined,
            statusText: undefined,
            headers: undefined,
            bodyText: undefined,
            bodyJson: undefined,
            cause: args.cause,
        });
    }
}
//# sourceMappingURL=errors.js.map