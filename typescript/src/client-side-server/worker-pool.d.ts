import type { ClientSideServerMessage } from './protocol';
import type { ClientSideServerAddress } from './signaling';
import type { ClientSideServerMQTTWebRTCOptions, ClientSideServerWorkerState } from './mqtt-webrtc';
export interface ClientSideServerWorkerPoolSession {
    readonly address: ClientSideServerAddress;
    readonly workers: ReadonlyArray<ClientSideServerWorkerState>;
    isOpen(): boolean;
    send(message: ClientSideServerMessage): Promise<void>;
    subscribe(listener: (message: any) => void | Promise<void>): () => void;
    rediscover(): Promise<void>;
    setWorkerWeight(instanceId: string, weight: number): void;
    close(): Promise<void>;
}
export interface ClientSideServerMultiWorkerPool {
    connect(address: string | ClientSideServerAddress): Promise<ClientSideServerWorkerPoolSession>;
    close(address: string | ClientSideServerAddress): Promise<void>;
    closeAll(): Promise<void>;
}
export declare function createClientSideServerMultiWorkerPool(options?: ClientSideServerMQTTWebRTCOptions): ClientSideServerMultiWorkerPool;
//# sourceMappingURL=worker-pool.d.ts.map