import type { ClientSideServerMessage } from './protocol';
export interface ClientSideServerChannel {
    send(message: ClientSideServerMessage): void | Promise<void>;
    subscribe(listener: (message: ClientSideServerMessage) => void | Promise<void>): () => void;
    close?(): void | Promise<void>;
}
export declare function createRTCDataChannelAdapter(channel: RTCDataChannel): ClientSideServerChannel;
export declare function createWeriftDataChannelAdapter(channel: {
    send(data: string | Buffer | Uint8Array): void;
    close(): void;
    onMessage: {
        subscribe(listener: (data: string | Buffer) => void): {
            unSubscribe(): void;
        };
    };
}): ClientSideServerChannel;
//# sourceMappingURL=channel.d.ts.map