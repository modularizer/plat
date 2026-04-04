export interface ClientSideServerAddress {
  href: string
  authority: string
  serverName: string
  topic?: string
  peerId?: string
  params: Record<string, string>
}

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
