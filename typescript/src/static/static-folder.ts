import { FileResponse } from './file-response'
import { isExcluded } from './glob-match'
import { getMimeType } from './mime-types'
import {
  isVirtualFileSystem,
  MemoryFileSystem,
  type MemoryFileEntry,
  type VirtualFileSystem,
} from './virtual-file-system'

export const STATIC_FOLDER_BRAND = Symbol.for('plat:StaticFolder')

export interface StaticFolderOpts {
  /** Gitignore-style exclude patterns */
  exclude?: string[]
  /** Cache-Control max-age in seconds */
  maxAge?: number
  /** Extra response headers */
  headers?: Record<string, string>
  /** How to handle dotfiles: 'ignore' (404), 'allow', or 'deny' (403). Default: 'ignore' */
  dotfiles?: 'ignore' | 'allow' | 'deny'
  /**
   * What to return when someone requests a directory.
   * - 'none'      : 404 (default when index is not set)
   * - 'index'     : serve the index file if it exists (default when index is set)
   * - 'list'      : return a JSON array of filenames
   * - 'directory'  : return an HTML directory listing page
   * - function    : custom handler — receives file list, returns a FileResponse
   */
  onDirectory?: 'none' | 'index' | 'list' | 'directory' | ((files: string[]) => FileResponse | Promise<FileResponse>)
  /** Index file to serve for directory requests when onDirectory is 'index' (e.g. 'index.html') */
  index?: string
}

/**
 * A static folder that serves files from a VirtualFileSystem.
 * Used as a class variable on controllers:
 *
 *   @Controller()
 *   class MyApp {
 *     assets = new StaticFolder('./public', { exclude: ['**\/*.map'] })
 *   }
 */
export class StaticFolder {
  readonly [STATIC_FOLDER_BRAND] = true

  readonly vfs: VirtualFileSystem
  readonly opts: StaticFolderOpts

  constructor(directory: string, opts?: StaticFolderOpts)
  constructor(files: Record<string, MemoryFileEntry>, opts?: StaticFolderOpts)
  constructor(vfs: VirtualFileSystem, opts?: StaticFolderOpts)
  constructor(
    source: string | Record<string, MemoryFileEntry> | VirtualFileSystem,
    opts?: StaticFolderOpts,
  ) {
    this.opts = opts ?? {}

    if (typeof source === 'string') {
      throw new Error('String-backed StaticFolder is not supported in @modularizer/plat-client')
    } else if (isVirtualFileSystem(source)) {
      this.vfs = source
    } else {
      this.vfs = new MemoryFileSystem(source)
    }
  }

  /**
   * Recursively enumerate all file paths available in this folder.
   * Returns paths relative to the folder root (no leading slash).
   * Respects exclude patterns and dotfile policy.
   * Useful for building manifests so clients know what paths are serveable.
   */
  async listAllFiles(maxDepth = 20): Promise<string[]> {
    const results: string[] = []
    await this.walkDir('', results, 0, maxDepth)
    return results
  }

  private async walkDir(dirPath: string, results: string[], depth: number, maxDepth: number): Promise<void> {
    if (depth > maxDepth) return
    const entries = await this.vfs.list(dirPath)
    for (const entry of entries) {
      if (entry.endsWith('/')) {
        const dirName = entry.slice(0, -1)
        const fullDirPath = dirPath ? `${dirPath}/${dirName}` : dirName
        if (this.isDotfile(fullDirPath)) {
          const policy = this.opts.dotfiles ?? 'ignore'
          if (policy === 'ignore' || policy === 'deny') continue
        }
        await this.walkDir(fullDirPath, results, depth + 1, maxDepth)
      } else {
        const filePath = dirPath ? `${dirPath}/${entry}` : entry
        if (this.isDotfile(filePath)) {
          const policy = this.opts.dotfiles ?? 'ignore'
          if (policy === 'ignore' || policy === 'deny') continue
        }
        if (this.opts.exclude && isExcluded(filePath, this.opts.exclude)) continue
        results.push(filePath)
      }
    }
  }

  /**
   * Resolve a sub-path to a FileResponse, or null if not found.
   * Handles: exclude globs, dotfile policy, stem matching, onDirectory behavior.
   */
  async resolve(subPath: string): Promise<FileResponse | null> {
    // Normalize: strip leading/trailing slashes
    const normalized = subPath.replace(/^\/+|\/+$/g, '')

    // Check dotfile policy
    if (this.isDotfile(normalized)) {
      const policy = this.opts.dotfiles ?? 'ignore'
      if (policy === 'ignore' || policy === 'deny') return null
    }

    // Check exclude patterns
    if (this.opts.exclude && normalized && isExcluded(normalized, this.opts.exclude)) {
      return null
    }

    // Empty path = directory root request
    if (!normalized) {
      return this.handleDirectory('')
    }

    // Try exact file match
    const content = await this.vfs.read(normalized)
    if (content !== null) {
      return this.createFileResponse(content, normalized)
    }

    // Check if it's a directory (by listing it)
    const dirEntries = await this.vfs.list(normalized)
    if (dirEntries.length > 0) {
      return this.handleDirectory(normalized)
    }

    // Stem matching: if no extension, look for unique match
    if (!this.hasExtension(normalized)) {
      return this.stemMatch(normalized)
    }

    return null
  }

  private isDotfile(path: string): boolean {
    const parts = path.split('/')
    return parts.some(p => p.startsWith('.') && p.length > 1)
  }

  private hasExtension(path: string): boolean {
    const basename = path.split('/').pop() ?? ''
    return basename.includes('.') && !basename.startsWith('.')
  }

  /**
   * Stem matching: if request path has no extension and exactly one file matches the stem, serve it.
   * e.g. /assets/readme → serves readme.md if it's the only readme.* in that directory
   */
  private async stemMatch(normalizedPath: string): Promise<FileResponse | null> {
    const parts = normalizedPath.split('/')
    const stem = parts.pop()!
    const dir = parts.join('/')

    const entries = await this.vfs.list(dir)
    const matches = entries.filter(entry => {
      if (entry.endsWith('/')) return false
      const dot = entry.lastIndexOf('.')
      const entryStem = dot > 0 ? entry.slice(0, dot) : entry
      return entryStem === stem
    })

    if (matches.length === 1) {
      const matched = matches[0]!
      const fullPath = dir ? `${dir}/${matched}` : matched

      // Check exclude on the resolved path
      if (this.opts.exclude && isExcluded(fullPath, this.opts.exclude)) {
        return null
      }

      const content = await this.vfs.read(fullPath)
      if (content !== null) {
        return this.createFileResponse(content, fullPath)
      }
    }

    return null
  }

  private async handleDirectory(dirPath: string): Promise<FileResponse | null> {
    const onDir = this.opts.onDirectory ?? (this.opts.index ? 'index' : 'none')

    if (onDir === 'none') return null

    if (onDir === 'index') {
      if (!this.opts.index) return null
      const indexPath = dirPath ? `${dirPath}/${this.opts.index}` : this.opts.index
      const content = await this.vfs.read(indexPath)
      if (content === null) return null
      return this.createFileResponse(content, indexPath)
    }

    const entries = await this.vfs.list(dirPath)

    if (onDir === 'list') {
      const json = JSON.stringify(entries)
      return FileResponse.from(json, 'listing.json')
    }

    if (onDir === 'directory') {
      const html = this.renderDirectoryPage(dirPath, entries)
      return FileResponse.from(html, 'index.html')
    }

    if (typeof onDir === 'function') {
      return onDir(entries)
    }

    return null
  }

  private renderDirectoryPage(dirPath: string, entries: string[]): string {
    const title = dirPath || '/'
    const links = entries
      .map(entry => {
        const href = entry
        return `    <li><a href="${href}">${entry}</a></li>`
      })
      .join('\n')
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Index of ${title}</title></head>
<body>
<h1>Index of /${title}</h1>
<ul>
${links}
</ul>
</body>
</html>`
  }

  private createFileResponse(
    content: string | Uint8Array,
    filePath: string,
  ): FileResponse {
    const filename = filePath.split('/').pop() ?? filePath
    return FileResponse.from(content as any, filename, {
      contentType: getMimeType(filename),
      maxAge: this.opts.maxAge,
      headers: this.opts.headers,
    })
  }
}

/**
 * Check if a value is a StaticFolder instance (works across module boundaries).
 */
export function isStaticFolder(value: unknown): value is StaticFolder {
  return value != null && typeof value === 'object' && STATIC_FOLDER_BRAND in value
}
