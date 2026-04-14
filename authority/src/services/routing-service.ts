import type { AuthorityMode } from '../models/authority-types'

function normalizeServerNameInput(serverName: string): string {
  const trimmed = serverName.trim().toLowerCase()
  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//, '')
  return withoutScheme.replace(/\/+$/, '')
}

export interface ParsedServerName {
  origin: string
  namespace: string
  subpath: string
}

export function getConfiguredAuthorityOrigins(): string[] {
  const raw = process.env.AUTHORITY_ALLOWED_ORIGINS || ''
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export function getDisallowedNamespaceGlobs(): string[] {
  const raw = process.env.AUTHORITY_DISALLOWED_NAMESPACE_GLOBS || ''
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegExp(glob: string): RegExp {
  const pattern = escapeRegex(glob).replace(/\*/g, '.*')
  return new RegExp(`^${pattern}$`)
}

function splitHostAndPath(input: string): { host: string; path: string } {
  const slashIndex = input.indexOf('/')
  if (slashIndex < 0) {
    return { host: input, path: '' }
  }
  return {
    host: input.slice(0, slashIndex),
    path: input.slice(slashIndex + 1),
  }
}

function parseSubdomainServerName(host: string, baseDomain: string): string[] | null {
  if (!baseDomain || !host) {
    return null
  }

  const hostWithoutPort = host.split(':')[0] || ''
  if (!hostWithoutPort.endsWith(`.${baseDomain}`)) {
    return null
  }

  const prefix = hostWithoutPort.slice(0, -(baseDomain.length + 1))
  const labels = prefix.split('.').map((label) => label.trim()).filter(Boolean)
  if (labels.length === 0) {
    return null
  }

  // Rightmost label before the base domain is the owned namespace.
  const namespace = labels[labels.length - 1]
  if (!namespace) {
    return null
  }
  const subpath = labels.slice(0, -1)
  return [namespace, ...subpath]
}

export function splitServerName(serverName: string): string[] {
  const normalized = normalizeServerNameInput(serverName)
  const { host, path } = splitHostAndPath(normalized)

  const origins = getConfiguredAuthorityOrigins()
  if (origins.length > 0) {
    const parsed = parseServerNameWithOrigins(host, path, origins)
    if (parsed) {
      return [parsed.namespace, ...parsed.subpath.split('/').filter(Boolean)]
    }
  }

  const pathSegments = path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (pathSegments.length > 0) {
    return [host, ...pathSegments].filter(Boolean)
  }

  const subdomainSegments = parseSubdomainServerName(host, (process.env.AUTHORITY_SUBDOMAIN_BASE_DOMAIN || '').trim().toLowerCase())
  if (subdomainSegments) {
    return subdomainSegments
  }

  return host
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function parseServerNameWithOrigins(host: string, path: string, origins: string[]): ParsedServerName | null {
  const hostWithoutPort = (host.split(':')[0] || '').toLowerCase()

  for (const origin of origins) {
    if (hostWithoutPort === origin) {
      const pathSegments = path.split('/').map((segment) => segment.trim()).filter(Boolean)
      const [namespace, ...rest] = pathSegments
      if (!namespace) {
        return null
      }
      return {
        origin,
        namespace: namespace.toLowerCase(),
        subpath: rest.join('/'),
      }
    }

    if (hostWithoutPort.endsWith(`.${origin}`)) {
      const prefix = hostWithoutPort.slice(0, -(origin.length + 1))
      const labels = prefix.split('.').map((label) => label.trim()).filter(Boolean)
      const namespace = labels[labels.length - 1]
      if (!namespace) {
        return null
      }
      const subpath = labels.slice(0, -1).join('/')
      return {
        origin,
        namespace: namespace.toLowerCase(),
        subpath,
      }
    }
  }

  return null
}

function getDefaultAuthorityOrigin(): string {
  const raw = process.env.AUTHORITY_URL
  if (!raw) return ''
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function parseServerNameScope(serverName: string): ParsedServerName {
  const normalized = normalizeServerNameInput(serverName)
  const { host, path } = splitHostAndPath(normalized)
  const origins = getConfiguredAuthorityOrigins()

  if (origins.length > 0) {
    const parsed = parseServerNameWithOrigins(host, path, origins)
    if (!parsed) {
      throw new Error(`Server name must match one configured origin: ${origins.join(', ')}`)
    }
    return parsed
  }

  const segments = splitServerName(serverName)
  return {
    origin: getDefaultAuthorityOrigin(),
    namespace: segments[0] || '',
    subpath: segments.slice(1).join('/'),
  }
}

export function getNamespaceOwnershipKey(origin: string, namespace: string): string {
  const normalizedNamespace = namespace.trim().toLowerCase()
  const normalizedOrigin = origin.trim().toLowerCase()
  return normalizedOrigin ? `${normalizedOrigin}::${normalizedNamespace}` : normalizedNamespace
}

export function getOwnershipKeyFromServerName(serverName: string): string {
  const parsed = parseServerNameScope(serverName)
  return getNamespaceOwnershipKey(parsed.origin, parsed.namespace)
}

export function getNamespaceFromServerName(serverName: string): string {
  return parseServerNameScope(serverName).namespace
}

export function getSubpathFromServerName(serverName: string): string {
  return parseServerNameScope(serverName).subpath
}

export function isNamespaceReserved(namespace: string): boolean {
  const lowered = namespace.trim().toLowerCase()
  if (lowered === 'dmz' || lowered === 'x' || lowered === 'api') {
    return true
  }

  return getDisallowedNamespaceGlobs().some((glob) => globToRegExp(glob).test(lowered))
}

export function isSubpathSameOrDescendant(baseSubpath: string, targetSubpath: string): boolean {
  const base = baseSubpath.trim().replace(/^\/+/g, '').replace(/\/+$/g, '')
  const target = targetSubpath.trim().replace(/^\/+/g, '').replace(/\/+$/g, '')
  if (!base) {
    return true
  }
  return target === base || target.startsWith(`${base}/`)
}

export function getAuthorityModeForServerName(serverName: string): AuthorityMode {
  return getNamespaceFromServerName(serverName) === 'dmz' ? 'dmz' : 'authority'
}

export function isDmzServerName(serverName: string): boolean {
  return getAuthorityModeForServerName(serverName) === 'dmz'
}

export function isAuthorityServerName(serverName: string): boolean {
  return getAuthorityModeForServerName(serverName) === 'authority'
}
