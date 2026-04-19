export type CallEventKind = 'progress' | 'log' | 'chunk' | 'message';
export type CallSessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface CallSessionEvent {
    seq: number;
    at: string;
    event: CallEventKind;
    data?: unknown;
}
export interface CallSessionRecord {
    id: string;
    operationId: string;
    method: string;
    path: string;
    status: CallSessionStatus;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    completedAt?: string;
    statusCode?: number;
    result?: unknown;
    error?: {
        message: string;
        statusCode?: number;
        data?: unknown;
    };
    events: CallSessionEvent[];
}
export declare class InMemoryCallSessionController {
    private sessions;
    private seq;
    private activeCancels;
    create(args: {
        operationId: string;
        method: string;
        path: string;
    }): CallSessionRecord;
    get(id: string): CallSessionRecord | undefined;
    setCancel(id: string, cancel: () => void): void;
    start(id: string): void;
    appendEvent(id: string, event: CallEventKind, data?: unknown): void;
    complete(id: string, result: unknown, statusCode: number): void;
    fail(id: string, error: {
        message: string;
        statusCode?: number;
        data?: unknown;
    }): void;
    cancel(id: string): boolean;
    listEvents(id: string, since?: number, event?: CallEventKind): CallSessionEvent[];
}
//# sourceMappingURL=call-sessions.d.ts.map