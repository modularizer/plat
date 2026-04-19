import type { RouteContext } from '../types';
export interface PLATServerResolvedOperation {
    method: string;
    path: string;
    methodName: string;
    boundMethod: Function;
    controllerTag: string;
    routeMeta: any;
    controllerMeta: any;
}
export interface PLATServerCallEnvelope {
    protocol: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    input: Record<string, any>;
    ctx: RouteContext;
    operationId?: string;
    requestId?: string;
    req?: unknown;
    res?: unknown;
    allowHelp: boolean;
    helpRequested?: boolean;
}
//# sourceMappingURL=transports.d.ts.map