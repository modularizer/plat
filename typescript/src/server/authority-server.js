var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Controller, GET } from '../spec';
import { createSignedClientSideServerAuthorityRecord, createSignedClientSideServerAuthorityRecordV2, isClientSideServerTrustedServerRecordV2, } from '../client-side-server/identity';
export function createAuthorityServerController(options) {
    const authorityName = options.authorityName;
    let AuthorityServerApi = class AuthorityServerApi {
        async resolveAuthorityHost({ serverName }) {
            const records = getAuthorityHostRecords(options, serverName);
            if (records.length === 0)
                return null;
            if (records.length === 1) {
                return signAuthorityHostRecord(options, serverName, records[0], authorityName);
            }
            return Promise.all(records.map((record) => signAuthorityHostRecord(options, serverName, record, authorityName)));
        }
        async listAuthorityHosts(input = {}) {
            const records = selectAuthorityHostRecords(options, input);
            return {
                authorityName,
                total: records.length,
                hosts: records.map(([serverName, record]) => ({
                    serverName,
                    keyId: isClientSideServerTrustedServerRecordV2(record) ? record.signingKeyId : record.keyId,
                    fingerprint: isClientSideServerTrustedServerRecordV2(record) ? record.signingFingerprint : record.fingerprint,
                    source: record.source,
                    trustedAt: record.trustedAt,
                })),
            };
        }
        async exportAuthorityHosts(input = {}) {
            const records = selectAuthorityHostRecords(options, input);
            return {
                authorityName,
                total: records.length,
                records: await Promise.all(records.map(async ([serverName, record]) => signAuthorityHostRecord(options, serverName, record, authorityName))),
            };
        }
    };
    __decorate([
        GET(),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object]),
        __metadata("design:returntype", Promise)
    ], AuthorityServerApi.prototype, "resolveAuthorityHost", null);
    __decorate([
        GET(),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object]),
        __metadata("design:returntype", Promise)
    ], AuthorityServerApi.prototype, "listAuthorityHosts", null);
    __decorate([
        GET(),
        __metadata("design:type", Function),
        __metadata("design:paramtypes", [Object]),
        __metadata("design:returntype", Promise)
    ], AuthorityServerApi.prototype, "exportAuthorityHosts", null);
    AuthorityServerApi = __decorate([
        Controller('authority')
    ], AuthorityServerApi);
    return AuthorityServerApi;
}
function getAuthorityHostRecords(options, serverName) {
    const entry = options.knownHosts[serverName];
    if (!entry)
        return [];
    if (options.allowServerNames && !options.allowServerNames.includes(serverName))
        return [];
    const records = Array.isArray(entry) ? entry : [entry];
    return records.filter((record) => !options.allow || options.allow(serverName, record));
}
function selectAuthorityHostRecords(options, input) {
    const pairs = [];
    for (const [serverName, entry] of Object.entries(options.knownHosts)) {
        const records = getAuthorityHostRecords(options, serverName);
        for (const record of records) {
            pairs.push([serverName, record]);
        }
    }
    const filtered = pairs
        .filter(([serverName]) => !input.serverNames?.length || input.serverNames.includes(serverName))
        .filter(([serverName]) => !input.q || serverName.toLowerCase().includes(input.q.toLowerCase()))
        .sort(([left], [right]) => left.localeCompare(right));
    const offset = Math.max(0, input.offset ?? 0);
    const limit = Math.max(1, input.limit ?? (filtered.length || 1));
    return filtered.slice(offset, offset + limit);
}
async function signAuthorityHostRecord(options, serverName, record, authorityName) {
    return isClientSideServerTrustedServerRecordV2(record)
        ? createSignedClientSideServerAuthorityRecordV2(options.authorityKeyPair, {
            serverName,
            signingPublicKeyJwk: record.signingPublicKeyJwk,
            encryptionPublicKeyJwk: record.encryptionPublicKeyJwk,
            signingKeyId: record.signingKeyId,
            encryptionKeyId: record.encryptionKeyId,
            authorityName,
        })
        : createSignedClientSideServerAuthorityRecord(options.authorityKeyPair, {
            serverName,
            publicKeyJwk: record.publicKeyJwk,
            keyId: record.keyId,
            authorityName,
        });
}
//# sourceMappingURL=authority-server.js.map