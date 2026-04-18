/**
 * Abstraction over file storage. StaticFolder resolves files through this interface.
 * Implementations: MemoryFileSystem (in-memory map) or any custom backend.
 */
export interface VirtualFileSystem {
  /**
   * List entries at a path. Return filenames only (not full paths).
   * Directories should be suffixed with '/'.
   * path is '' for root, 'subdir' for a subdirectory.
   */
  list(path: string): string[] | Promise<string[]>

  /**
   * Read a file's content. Return null if not found.
   */
  read(path: string): string | Uint8Array | null | Promise<string | Uint8Array | null>
}

/**
 * Check if a value implements the VirtualFileSystem interface.
 */
export function isVirtualFileSystem(value: unknown): value is VirtualFileSystem {
  return (
    value != null &&
    typeof value === 'object' &&
    'list' in value && typeof (value as any).list === 'function' &&
    'read' in value && typeof (value as any).read === 'function'
  )
}

/**
 * Placeholder for filesystem-backed VFS. Real filesystem access is not available in plat-client.
 */
export class NodeFileSystem implements VirtualFileSystem {
  constructor(_directory: string) {
    throw new Error('NodeFileSystem is not supported in @modularizer/plat-client')
  }

  async list(_subPath: string): Promise<string[]> {
    throw new Error('NodeFileSystem is not supported in @modularizer/plat-client')
  }

  async read(_subPath: string): Promise<Uint8Array | null> {
    throw new Error('NodeFileSystem is not supported in @modularizer/plat-client')
  }
}

export type MemoryFileEntry = string | Uint8Array | { read(): string | Uint8Array | Promise<string | Uint8Array> }

/**
 * VFS backed by an in-memory file map.
 * Keys are paths like 'index.html' or 'css/style.css'.
 * Values can be raw content or objects with a read() method for lazy evaluation.
 */
export class MemoryFileSystem implements VirtualFileSystem {
  constructor(private files: Record<string, MemoryFileEntry>) {}

  list(subPath: string): string[] {
    const prefix = subPath ? (subPath.endsWith('/') ? subPath : subPath + '/') : ''
    const seen = new Set<string>()
    for (const key of Object.keys(this.files)) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const slashIndex = rest.indexOf('/')
      if (slashIndex === -1) {
        // Direct file in this directory
        seen.add(rest)
      } else {
        // Subdirectory
        seen.add(rest.slice(0, slashIndex) + '/')
      }
    }
    return Array.from(seen)
  }

  async read(subPath: string): Promise<string | Uint8Array | null> {
    const entry = this.files[subPath]
    if (entry === undefined) return null
    if (typeof entry === 'string' || entry instanceof Uint8Array) return entry
    // Lazy read() object
    return entry.read()
  }
}
