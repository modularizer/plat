/**
 * Routing Utilities for plat
 *
 * Provides functions to generate route variants:
 * - Case variants: camelCase -> snake_case, kebab-case
 * - HTTP method flexibility: GET ↔ POST
 */

/**
 * Convert camelCase to snake_case
 * e.g., getOrder -> get_order
 */
export function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase()
}

/**
 * Convert camelCase to kebab-case
 * e.g., getOrder -> get-order
 */
export function toKebabCase(str: string): string {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase()
}

/**
 * Generate all case variants of a method name
 * e.g., getOrder -> [getOrder, get_order, get-order]
 */
export function getCaseVariants(methodName: string): string[] {
  return [methodName, toSnakeCase(methodName), toKebabCase(methodName)]
}

export function isWildcardMethodName(methodName: string): boolean {
  return methodName === '$' || methodName.endsWith('$')
}

export function getWildcardBasePath(methodName: string): string {
  if (!isWildcardMethodName(methodName)) {
    return '/' + methodName
  }

  const prefix = methodName === '$' ? '' : methodName.slice(0, -1)
  return prefix ? `/${prefix}` : '/'
}

export function getWildcardDisplayPath(methodName: string): string {
  const basePath = getWildcardBasePath(methodName)
  return basePath === '/' ? '/*' : `${basePath}/*`
}

export function matchesWildcardPath(basePath: string, actualPath: string): boolean {
  const normalizedBase = basePath === '/' ? '/' : basePath.replace(/\/+$/g, '')
  const normalizedPath = actualPath === '/' ? '/' : actualPath.replace(/\/+$/g, '') || '/'

  if (normalizedBase === '/') return true
  return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`)
}

export function createWildcardRouteMatcher(basePath: string): RegExp {
  if (basePath === '/') {
    return /^\/.*$/
  }

  const escaped = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}(?:/.*)?$`)
}

/**
 * Get the flexible HTTP methods for a route
 * GET can also accept POST, POST can also accept GET
 * This allows more resilient APIs
 */
export function getFlexibleMethods(httpMethod: string): string[] {
  const method = httpMethod.toUpperCase()
  if (method === 'GET') {
    return ['GET', 'POST']
  }
  if (method === 'POST') {
    return ['POST', 'GET']
  }
  if (method === 'PUT') {
    return ['PUT', 'PATCH', 'POST']
  }
  if (method === 'DELETE') {
    return ['DELETE', 'POST']
  }
  return [method]
}

/**
 * Create route registration entries for all variants
 * Takes a method and generates:
 * - All case variants (camelCase, snake_case, kebab-case)
 * - All flexible HTTP methods
 */
export function generateRouteVariants(
  methodName: string,
  httpMethod: string
): Array<{ path: string; method: string }> {
  const routes: Array<{ path: string; method: string }> = []
  const caseVariants = getCaseVariants(methodName)
  const methodVariants = httpMethod === '*' ? ['*'] : getFlexibleMethods(httpMethod)

  for (const caseVariant of caseVariants) {
    for (const method of methodVariants) {
      routes.push({
        path: isWildcardMethodName(caseVariant)
          ? getWildcardBasePath(caseVariant)
          : '/' + caseVariant,
        method: method,
      })
    }
  }

  return routes
}
