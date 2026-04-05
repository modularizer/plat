import { Controller, GET } from '../spec'
import type { ClientSideServerExportedKeyPair, ClientSideServerSignedAuthorityRecord, ClientSideServerTrustedServerRecord } from '../client-side-server/identity'
import { createSignedClientSideServerAuthorityRecord } from '../client-side-server/identity'

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
  records: ClientSideServerSignedAuthorityRecord[]
}

export interface PLATAuthorityServerOptions {
  authorityName?: string
  authorityKeyPair: ClientSideServerExportedKeyPair
  knownHosts: Record<string, ClientSideServerTrustedServerRecord>
  allowServerNames?: string[]
  allow?: (serverName: string, record: ClientSideServerTrustedServerRecord) => boolean
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
    ): Promise<ClientSideServerSignedAuthorityRecord | null> {
      const record = getAuthorityHostRecord(options, serverName)
      if (!record) return null
      return createSignedClientSideServerAuthorityRecord(options.authorityKeyPair, {
        serverName,
        publicKeyJwk: record.publicKeyJwk,
        keyId: record.keyId,
        authorityName,
      })
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
          keyId: record.keyId,
          fingerprint: record.fingerprint,
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
          records.map(async ([serverName, record]) => createSignedClientSideServerAuthorityRecord(options.authorityKeyPair, {
            serverName,
            publicKeyJwk: record.publicKeyJwk,
            keyId: record.keyId,
            authorityName,
          })),
        ),
      }
    }
  }

  return AuthorityServerApi
}

function getAuthorityHostRecord(
  options: PLATAuthorityServerOptions,
  serverName: string,
): ClientSideServerTrustedServerRecord | null {
  const record = options.knownHosts[serverName]
  if (!record) return null
  if (options.allowServerNames && !options.allowServerNames.includes(serverName)) return null
  if (options.allow && !options.allow(serverName, record)) return null
  return record
}

function selectAuthorityHostRecords(
  options: PLATAuthorityServerOptions,
  input: { q?: string; limit?: number; offset?: number; serverNames?: string[] },
): Array<[string, ClientSideServerTrustedServerRecord]> {
  const filtered = Object.entries(options.knownHosts)
    .filter(([serverName, record]) => getAuthorityHostRecord(options, serverName) === record)
    .filter(([serverName]) => !input.serverNames?.length || input.serverNames.includes(serverName))
    .filter(([serverName]) => !input.q || serverName.toLowerCase().includes(input.q.toLowerCase()))
    .sort(([left], [right]) => left.localeCompare(right))

  const offset = Math.max(0, input.offset ?? 0)
  const limit = Math.max(1, input.limit ?? (filtered.length || 1))
  return filtered.slice(offset, offset + limit)
}
