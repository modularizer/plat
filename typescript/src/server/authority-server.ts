import { Controller, GET } from '../spec'
import type {
  ClientSideServerAnyAuthorityRecord,
  ClientSideServerAnyTrustedServerRecord,
  ClientSideServerExportedKeyPair,
  ClientSideServerSignedAuthorityRecord,
} from '../client-side-server/identity'
import {
  createSignedClientSideServerAuthorityRecord,
  createSignedClientSideServerAuthorityRecordV2,
  isClientSideServerTrustedServerRecordV2,
} from '../client-side-server/identity'

export interface AuthorityHostSummary {
  serverName: string
  keyId?: string
  fingerprint: string
  source: string
  trustedAt: number
}

export interface AuthorityHostListResponse {
  authorityName?: string
  total: number
  hosts: AuthorityHostSummary[]
}

export interface AuthorityHostExportResponse {
  authorityName?: string
  total: number
  records: ClientSideServerAnyAuthorityRecord[]
}

export interface PLATAuthorityServerOptions {
  authorityName?: string
  authorityKeyPair: ClientSideServerExportedKeyPair
  knownHosts: Record<string, ClientSideServerAnyTrustedServerRecord | ClientSideServerAnyTrustedServerRecord[]>
  allowServerNames?: string[]
  allow?: (serverName: string, record: ClientSideServerAnyTrustedServerRecord) => boolean
}

export function createAuthorityServerController(
  options: PLATAuthorityServerOptions,
): new () => any {
  const authorityName = options.authorityName

  @Controller('authority')
  class AuthorityServerApi {
    @GET()
    async resolveAuthorityHost(
      { serverName }: { serverName: string },
    ): Promise<ClientSideServerAnyAuthorityRecord | ClientSideServerAnyAuthorityRecord[] | null> {
      const records = getAuthorityHostRecords(options, serverName)
      if (records.length === 0) return null
      if (records.length === 1) {
        return signAuthorityHostRecord(options, serverName, records[0]!, authorityName)
      }
      return Promise.all(records.map((record) => signAuthorityHostRecord(options, serverName, record, authorityName)))
    }

    @GET()
    async listAuthorityHosts(
      input: { q?: string; limit?: number; offset?: number; serverNames?: string[] } = {},
    ): Promise<AuthorityHostListResponse> {
      const records = selectAuthorityHostRecords(options, input)
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
      }
    }

    @GET()
    async exportAuthorityHosts(
      input: { q?: string; limit?: number; offset?: number; serverNames?: string[] } = {},
    ): Promise<AuthorityHostExportResponse> {
      const records = selectAuthorityHostRecords(options, input)
      return {
        authorityName,
        total: records.length,
        records: await Promise.all(
            records.map(async ([serverName, record]) => signAuthorityHostRecord(options, serverName, record, authorityName)),
        ),
      }
    }
  }

  return AuthorityServerApi
}

function getAuthorityHostRecords(
  options: PLATAuthorityServerOptions,
  serverName: string,
): ClientSideServerAnyTrustedServerRecord[] {
  const entry = options.knownHosts[serverName]
  if (!entry) return []
  if (options.allowServerNames && !options.allowServerNames.includes(serverName)) return []
  const records = Array.isArray(entry) ? entry : [entry]
  return records.filter((record) => !options.allow || options.allow(serverName, record))
}

function selectAuthorityHostRecords(
  options: PLATAuthorityServerOptions,
  input: { q?: string; limit?: number; offset?: number; serverNames?: string[] },
): Array<[string, ClientSideServerAnyTrustedServerRecord]> {
  const pairs: Array<[string, ClientSideServerAnyTrustedServerRecord]> = []
  for (const [serverName, entry] of Object.entries(options.knownHosts)) {
    const records = getAuthorityHostRecords(options, serverName)
    for (const record of records) {
      pairs.push([serverName, record])
    }
  }

  const filtered = pairs
    .filter(([serverName]) => !input.serverNames?.length || input.serverNames.includes(serverName))
    .filter(([serverName]) => !input.q || serverName.toLowerCase().includes(input.q.toLowerCase()))
    .sort(([left], [right]) => left.localeCompare(right))

  const offset = Math.max(0, input.offset ?? 0)
  const limit = Math.max(1, input.limit ?? (filtered.length || 1))
  return filtered.slice(offset, offset + limit)
}

async function signAuthorityHostRecord(
  options: PLATAuthorityServerOptions,
  serverName: string,
  record: ClientSideServerAnyTrustedServerRecord,
  authorityName?: string,
): Promise<ClientSideServerSignedAuthorityRecord | ClientSideServerAnyAuthorityRecord> {
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
      })
}

