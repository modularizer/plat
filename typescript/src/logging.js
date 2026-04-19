function formatMessage(message, args) {
    if (args.length === 0)
        return message;
    let i = 0;
    return message.replace(/%[sdjoO%]/g, (match) => {
        if (match === '%%')
            return '%';
        if (i >= args.length)
            return match;
        const arg = args[i++];
        switch (match) {
            case '%s': return String(arg);
            case '%d': return String(Number(arg));
            case '%j': try {
                return JSON.stringify(arg);
            }
            catch {
                return '[Circular]';
            }
            case '%o':
            case '%O': try {
                return JSON.stringify(arg);
            }
            catch {
                return '[Circular]';
            }
            default: return match;
        }
    });
}
class StreamLogger {
    _name;
    constructor(_name = 'plat') {
        this._name = _name;
    }
    write(level, message, args) {
        const rendered = formatMessage(message, args);
        if (level === 'warn')
            console.warn(rendered);
        else if (level === 'error')
            console.error(rendered);
        else if (level === 'debug')
            console.debug(rendered);
        else
            console.log(rendered);
    }
    debug(message, ...args) {
        this.write('debug', message, args);
    }
    info(message, ...args) {
        this.write('info', message, args);
    }
    warn(message, ...args) {
        this.write('warn', message, args);
    }
    error(message, ...args) {
        this.write('error', message, args);
    }
}
export function getLogger(name = 'plat') {
    return new StreamLogger(name);
}
export const defaultLogger = getLogger('plat');
//# sourceMappingURL=logging.js.map