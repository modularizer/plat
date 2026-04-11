/**
 * Gitignore-style glob matching for exclude patterns.
 *
 * Supported patterns:
 *   **\/*.map     — match extension in any subdirectory
 *   .DS_Store     — exact filename anywhere
 *   secrets/**    — entire directory tree
 *   **\/.*        — all dotfiles in any subdirectory
 *   *.txt         — match extension in current directory only
 */

/**
 * Convert a gitignore-style glob pattern to a RegExp.
 */
function globToRegExp(pattern: string): RegExp {
  // Normalize: strip leading/trailing slashes
  let p = pattern.replace(/^\/+|\/+$/g, '')

  // Escape regex special chars except * and ?
  p = p.replace(/[.+^${}()|[\]\\]/g, '\\$&')

  // Handle ** patterns
  // /**/  → match any number of path segments (including zero)
  p = p.replace(/\\\*\\\*\//g, '(?:.+/)?')
  // ** at end → match everything
  p = p.replace(/\\\*\\\*/g, '.*')
  // Single * → match anything except /
  p = p.replace(/\\\*/g, '[^/]*')
  // ? → match single char except /
  p = p.replace(/\\\?/g, '[^/]')

  // If pattern has no slash, match against basename anywhere in path
  if (!pattern.includes('/')) {
    return new RegExp(`(?:^|/)${p}$`)
  }

  return new RegExp(`^${p}$`)
}

/**
 * Check if a file path matches any of the exclude patterns.
 * Paths should be relative (no leading slash), using forward slashes.
 */
export function isExcluded(filePath: string, patterns: string[]): boolean {
  // Normalize the path
  const normalized = filePath.replace(/^\/+/, '')
  for (const pattern of patterns) {
    if (globToRegExp(pattern).test(normalized)) {
      return true
    }
  }
  return false
}
