/**
 * Parameter Aliasing
 *
 * Maps common parameter name variants to canonical plat parameter names.
 * This ensures consistency while being resilient to common naming mistakes.
 *
 * Examples:
 * - `query` → `q`
 * - `search` → `q`
 * - `format` → `fmt`
 * - `page` + `pageSize` → `limit` + `offset`
 */

export interface ParameterAliases {
  [alias: string]: string | ((value: any, params: Record<string, any>) => void)
}

/**
 * Map of parameter aliases to canonical names
 * Value can be:
 * - string: direct alias (query → q)
 * - function: complex transformation (page/pageSize → limit/offset)
 */
const PARAMETER_ALIASES: ParameterAliases = {
  query: 'q',
  search: 'q',
  format: 'fmt',
  // Complex transformations are handled separately
}

/**
 * Normalize/alias a parameters object
 * Converts common parameter name variants to plat canonical names
 *
 * @param params The input parameters object
 * @param paramCoercions Optional config map of parameter aliases (from PLATServerOptions)
 * @param disAllowedParams Optional list of forbidden parameter names
 * @returns New params object with aliased names resolved
 * @throws Error if a disallowed parameter is found in the input
 */
export function normalizeParameters(
  params: Record<string, any>,
  paramCoercions?: Record<string, string>,
  disAllowedParams?: string[]
): Record<string, any> {
  if (!params || typeof params !== 'object') {
    return params
  }

  // Check for disallowed parameters first
  if (disAllowedParams && disAllowedParams.length > 0) {
    for (const paramName of Object.keys(params)) {
      if (disAllowedParams.includes(paramName)) {
        throw new Error(
          `Parameter '${paramName}' is disallowed in this API. ` +
          `Use '${getCanonicalName(paramName) || 'a different parameter'}' instead.`
        )
      }
    }
  }

  const normalized = { ...params }
  const aliases = paramCoercions || PARAMETER_ALIASES

  // Apply simple aliases
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (typeof canonical === 'string' && alias in normalized && canonical) {
      if (!(canonical in normalized)) {
        normalized[canonical] = normalized[alias]
      }
      delete normalized[alias]
    }
  }

  // Handle page/pageSize → limit/offset conversion
  if ('page' in normalized || 'pageSize' in normalized) {
    const page = normalized.page ?? 1
    const pageSize = normalized.pageSize ?? 10

    // Only apply if limit/offset aren't already set
    if (!('limit' in normalized)) {
      normalized.limit = pageSize
    }
    if (!('offset' in normalized)) {
      normalized.offset = (page - 1) * pageSize
    }

    // Remove the original page/pageSize
    delete normalized.page
    delete normalized.pageSize
  }

  return normalized
}

/**
 * Get all known parameter aliases
 * Useful for documentation and validation
 */
export function getKnownAliases(): Record<string, string> {
  const aliases: Record<string, string> = {}

  for (const [alias, canonical] of Object.entries(PARAMETER_ALIASES)) {
    if (typeof canonical === 'string') {
      aliases[alias] = canonical
    }
  }

  // Add page/pageSize special handling
  aliases['page'] = 'offset (calculated as (page-1)*pageSize)'
  aliases['pageSize'] = 'limit'

  return aliases
}

/**
 * Check if a parameter name would be aliased
 */
export function isAliasedParameter(paramName: string): boolean {
  return paramName in PARAMETER_ALIASES || paramName === 'page' || paramName === 'pageSize'
}

/**
 * Get canonical name for a parameter
 */
export function getCanonicalName(paramName: string): string | null {
  if (paramName === 'page') return 'offset'
  if (paramName === 'pageSize') return 'limit'

  const alias = PARAMETER_ALIASES[paramName]
  if (typeof alias === 'string') {
    return alias
  }

  return null
}
