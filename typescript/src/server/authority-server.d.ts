import type { ClientSideServerAnyAuthorityRecord, ClientSideServerAnyTrustedServerRecord, ClientSideServerExportedKeyPair } from '../client-side-server/identity';
export interface AuthorityHostSummary {
    serverName: string;
    keyId?: string;
    fingerprint: string;
    source: string;
    trustedAt: number;
}
export interface AuthorityHostListResponse {
    authorityName?: string;
    total: number;
    hosts: AuthorityHostSummary[];
}
export interface AuthorityHostExportResponse {
    authorityName?: string;
    total: number;
    records: ClientSideServerAnyAuthorityRecord[];
}
export interface PLATAuthorityServerOptions {
    authorityName?: string;
    authorityKeyPair: ClientSideServerExportedKeyPair;
    knownHosts: Record<string, ClientSideServerAnyTrustedServerRecord | ClientSideServerAnyTrustedServerRecord[]>;
    allowServerNames?: string[];
    allow?: (serverName: string, record: ClientSideServerAnyTrustedServerRecord) => boolean;
}
export declare function createAuthorityServerController(options: PLATAuthorityServerOptions): new () => any;
//# sourceMappingURL=authority-server.d.ts.map