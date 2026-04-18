import { getMimeType } from './mime-types'

export const FILE_RESPONSE_BRAND = Symbol.for('plat:FileResponse')

export interface FileResponseOpts {
  contentType?: string
  maxAge?: number
  headers?: Record<string, string>
}

function hasNodeBuffer(value: unknown): boolean {
  try {
    return (
      typeof Buffer !== 'undefined' &&
      typeof (globalThis as any).Buffer !== 'undefined' &&
      !!value &&
      typeof (value as any).constructor === 'function' &&
      (value as any).constructor.name === 'Buffer'
    ) === true;
  } catch {
    return false;
  }
}

/**
 * A response that serves a file. Can be returned from any controller method.
 * Methods returning FileResponse should use @GET({ hidden: true }) to exclude from OpenAPI.
 */
export class FileResponse {
  readonly [FILE_RESPONSE_BRAND] = true

  readonly filename: string
  readonly contentType: string
  readonly maxAge?: number
  readonly headers: Record<string, string>

  private constructor(
    readonly kind: 'path' | 'content',
    readonly source: string | Buffer | Uint8Array,
    filename: string,
    opts?: FileResponseOpts,
  ) {
    this.filename = filename
    this.contentType = opts?.contentType ?? getMimeType(filename)
    this.maxAge = opts?.maxAge
    this.headers = opts?.headers ?? {}
  }

  /**
   * Create a FileResponse from a filesystem path.
   * On Express servers, the file will be streamed.
   */
  static from(path: string): FileResponse
  static from(path: string, opts: FileResponseOpts): FileResponse
  /**
   * Create a FileResponse from in-memory content + filename.
   * Content-type is auto-detected from the filename.
   */
  static from(content: string | Buffer | Uint8Array, filename: string): FileResponse
  static from(content: string | Buffer | Uint8Array, filename: string, opts: FileResponseOpts): FileResponse
  static from(
    pathOrContent: string | Buffer | Uint8Array,
    filenameOrOpts?: string | FileResponseOpts,
    opts?: FileResponseOpts,
  ): FileResponse {
    if (typeof pathOrContent === 'string' && (filenameOrOpts === undefined || typeof filenameOrOpts === 'object' && !hasNodeBuffer(filenameOrOpts))) {
      // from(path) or from(path, opts) — filesystem path
      const path = pathOrContent
      const filename = path.split('/').pop() ?? path
      return new FileResponse('path', path, filename, filenameOrOpts as FileResponseOpts | undefined)
    }

    // from(content, filename) or from(content, filename, opts) — in-memory content
    return new FileResponse('content', pathOrContent, filenameOrOpts as string, opts)
  }

  /**
   * Get the file content as bytes. Path-based filesystem reads are not available in plat-client.
   */
  async getContent(): Promise<Uint8Array> {
    if (this.kind === 'path') {
      throw new Error('Path-based FileResponse is not supported in @modularizer/plat-client')
    }
    if (typeof this.source === 'string') {
      return new TextEncoder().encode(this.source)
    }
    if (this.source instanceof Uint8Array) {
      return this.source
    }
    // If it's a Node.js Buffer, convert to Uint8Array (should not happen in browser)
    if (hasNodeBuffer(this.source)) {
      return new Uint8Array(this.source as any)
    }
    // Fallback: try to coerce to Uint8Array
    return new Uint8Array(this.source as ArrayBuffer)
  }
}

/**
 * Check if a value is a FileResponse instance (works across module boundaries).
 */
export function isFileResponse(value: unknown): value is FileResponse {
  return value != null && typeof value === 'object' && FILE_RESPONSE_BRAND in value
}
