export class InMemoryCallSessionController {
    sessions = new Map();
    seq = 0;
    activeCancels = new Map();
    create(args) {
        this.seq += 1;
        const now = new Date().toISOString();
        const session = {
            id: `call-${this.seq}`,
            operationId: args.operationId,
            method: args.method,
            path: args.path,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            events: [],
        };
        this.sessions.set(session.id, session);
        return session;
    }
    get(id) {
        return this.sessions.get(id);
    }
    setCancel(id, cancel) {
        this.activeCancels.set(id, cancel);
    }
    start(id) {
        const session = this.sessions.get(id);
        if (!session)
            return;
        const now = new Date().toISOString();
        session.status = 'running';
        session.startedAt = session.startedAt ?? now;
        session.updatedAt = now;
    }
    appendEvent(id, event, data) {
        const session = this.sessions.get(id);
        if (!session)
            return;
        session.events.push({
            seq: session.events.length + 1,
            at: new Date().toISOString(),
            event,
            data,
        });
        session.updatedAt = new Date().toISOString();
    }
    complete(id, result, statusCode) {
        const session = this.sessions.get(id);
        if (!session)
            return;
        const now = new Date().toISOString();
        session.status = 'completed';
        session.completedAt = now;
        session.updatedAt = now;
        session.statusCode = statusCode;
        session.result = result;
        this.activeCancels.delete(id);
    }
    fail(id, error) {
        const session = this.sessions.get(id);
        if (!session)
            return;
        const now = new Date().toISOString();
        session.status = 'failed';
        session.completedAt = now;
        session.updatedAt = now;
        session.error = error;
        this.activeCancels.delete(id);
    }
    cancel(id) {
        const session = this.sessions.get(id);
        if (!session)
            return false;
        this.activeCancels.get(id)?.();
        const now = new Date().toISOString();
        session.status = 'cancelled';
        session.completedAt = now;
        session.updatedAt = now;
        this.activeCancels.delete(id);
        return true;
    }
    listEvents(id, since = 0, event) {
        const session = this.sessions.get(id);
        if (!session)
            return [];
        return session.events.filter((item) => item.seq > since && (!event || item.event === event));
    }
}
//# sourceMappingURL=call-sessions.js.map