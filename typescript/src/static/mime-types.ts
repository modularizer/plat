const MIME_TYPES: Record<string, string> = {
  // Text
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.xml': 'text/xml',
  '.md': 'text/markdown',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',

  // JavaScript / JSON
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.cjs': 'application/javascript',
  '.json': 'application/json',
  '.jsonld': 'application/ld+json',
  '.map': 'application/json',
  '.ts': 'text/typescript',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',

  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',

  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',

  // Documents
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',

  // Web
  '.wasm': 'application/wasm',
  '.manifest': 'text/cache-manifest',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Get MIME content-type from a filename or extension.
 * Returns 'application/octet-stream' for unrecognized extensions.
 */
export function getMimeType(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot === -1) return 'application/octet-stream'
  const ext = filename.slice(dot).toLowerCase()
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}
