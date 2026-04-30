/**
 * The single source of truth for the default authority origin used when
 * authority-mode code paths are invoked without an explicit URL.
 *
 * Sourced exclusively from the `AUTHORITY_URL` environment variable.
 * There is no built-in fallback. If the env var is unset, this is `undefined`
 * and consumers MUST throw at the use site rather than substitute a default.
 *
 * THIS IS THE ONLY FILE in the codebase allowed to read an authority URL.
 * Anywhere else, import this constant — never inline a URL string.
 */
export const PLAT_AUTHORITY_URL: string = process?.env?.PLAT_AUTHORITY_URL || process?.env?.API_BASE_URL || 'http://localhost:3000'
