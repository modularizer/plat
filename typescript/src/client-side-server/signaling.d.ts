export interface ClientSideServerAddress {
    href: string;
    authority: string;
    serverName: string;
    topic?: string;
    peerId?: string;
    encryptionPublicKeyJwk?: JsonWebKey;
    params: Record<string, string>;
}
export type ClientSideServerMode = 'dmz' | 'authority';
export declare function parseClientSideServerAddress(input: string): ClientSideServerAddress;
export declare function getClientSideServerMode(input: string | Pick<ClientSideServerAddress, 'serverName'>): ClientSideServerMode;
export declare function isAuthorityClientSideServerAddress(input: string | Pick<ClientSideServerAddress, 'serverName'>): boolean;
export declare function isDmzClientSideServerAddress(input: string | Pick<ClientSideServerAddress, 'serverName'>): boolean;
//# sourceMappingURL=signaling.d.ts.map