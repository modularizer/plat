export interface Logger {
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}
export declare function getLogger(name?: string): Logger;
export declare const defaultLogger: Logger;
//# sourceMappingURL=logging.d.ts.map