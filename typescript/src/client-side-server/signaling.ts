export interface ClientSideServerAddress {
  href: string
  authority: string
  serverName: string
  topic?: string
  peerId?: string
  encryptionPublicKeyJwk?: JsonWebKey
  params: Record<string, string>
}

export type ClientSideServerMode = 'dmz' | 'authority'

export function parseClientSideServerAddress(input: string): ClientSideServerAddress {
  const url = new URL(input)
  if (url.protocol !== 'css:') {
    throw new Error(`Client-side server URLs must use css://, got ${input}`)
  }

  const params: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    params[key] = value
  })

  return {
    href: input,
    authority: url.host,
    serverName: url.host || decodeURIComponent(url.pathname.replace(/^\/+/, '')),
    topic: decodeURIComponent(url.pathname.replace(/^\/+/, '')) || undefined,
    peerId: url.searchParams.get('peer') ?? undefined,
    params,
  }
}

export function getClientSideServerMode(
  input: string | Pick<ClientSideServerAddress, 'serverName'>,
): ClientSideServerMode {
  const serverName = typeof input === 'string'
    ? parseClientSideServerAddress(input).serverName
    : input.serverName
  return serverName.startsWith('dmz/') ? 'dmz' : 'authority'
}

export function isAuthorityClientSideServerAddress(
  input: string | Pick<ClientSideServerAddress, 'serverName'>,
): boolean {
  return getClientSideServerMode(input) === 'authority'
}

export function isDmzClientSideServerAddress(
  input: string | Pick<ClientSideServerAddress, 'serverName'>,
): boolean {
  return getClientSideServerMode(input) === 'dmz'
}

