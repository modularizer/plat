# Static File Server Support

## Goal

Add static file serving to **every** plat server type. Disabled by default.

---

## Design

Two primitives:
- **`FileResponse`** — return type for single files (from methods)
- **`StaticFolder`** — class variable that serves a directory

Methods returning `FileResponse` and class variables typed as `StaticFolder` are **automatically excluded from OpenAPI**.

### Routing exception

plat routes are normally flat (`/methodName`). Static files are the exception — they support multipart paths. A `StaticFolder` named `assets` serves `GET /assets/css/style.css`, `GET /assets/js/app.js`, etc. A `StaticFolder` named `root` (or assigned to a special symbol) serves from `/`.

### Stem matching

If a request path has no extension but exactly one file in the folder matches that stem, serve it. `GET /assets/readme` → serves `assets/readme.md` if that's the only `readme.*` file. If ambiguous (multiple extensions), 404.

---

## Syntax

```typescript
import { Controller, GET } from 'plat'
import { FileResponse, StaticFolder } from '@modularizer/plat/static'

@Controller()
class MyApp {
  // ── Folders as class variables ──────────────────────────────

  // Serves ./public at /assets/*  (e.g. GET /assets/css/style.css)
  assets = new StaticFolder('./public', {
    exclude: ['**/*.map', '.DS_Store', '**/.git/**'],
    index: 'index.html',
    maxAge: 3600,
  })

  // Serves ./docs/build at /docs/*
  docs = new StaticFolder('./docs/build', {
    exclude: ['**/*.draft.*'],
  })

  // Serves at the root URL: GET /index.html, GET /style.css, etc.
  root = new StaticFolder('./public')

  // ── Single files as methods returning FileResponse ─────────

  @GET()
  favicon(): FileResponse {
    return FileResponse.from('./public/favicon.ico')
  }

  @GET()
  exportCsv({ reportId }: { reportId: string }): FileResponse {
    const csv = generateReport(reportId)
    return FileResponse.from(csv, `report-${reportId}.csv`)
  }

  // ── Regular API methods (appear in OpenAPI as usual) ───────

  @GET()
  getStatus() {
    return { ok: true }
  }
}
```

```python
from plat import Controller, GET, FileResponse, StaticFolder

@Controller()
class MyApp:
    assets = StaticFolder('./public', exclude=['**/*.map'], index='index.html')
    docs = StaticFolder('./docs/build', exclude=['**/*.draft.*'])
    root = StaticFolder('./public')

    @GET()
    def favicon(self) -> FileResponse:
        return FileResponse.from_path('./public/favicon.ico')

    @GET()
    def get_status(self):
        return { 'ok': True }
```

### Client-side server (in-memory files)

```typescript
@Controller()
class MyApp {
  // In-memory file map instead of a directory path
  assets = new StaticFolder({
    'index.html': '<html>...</html>',
    'css/style.css': 'body { margin: 0 }',
    'js/app.js': bundledCode,
  }, {
    index: 'index.html',
  })

  // Or serve from root
  root = new StaticFolder({
    'index.html': '<html>...</html>',
    'style.css': 'body { margin: 0 }',
  })

  @GET()
  getStatus() {
    return { ok: true }
  }
}
```

---

## `StaticFolder` API

```typescript
class StaticFolder {
  // From a filesystem directory (Node.js / Python servers)
  constructor(directory: string, opts?: StaticFolderOpts)

  // From an in-memory file map (client-side servers, or anywhere)
  constructor(files: Record<string, string | Uint8Array>, opts?: StaticFolderOpts)

  // From a virtual filesystem (any environment)
  constructor(fs: VirtualFileSystem, opts?: StaticFolderOpts)
}

interface StaticFolderOpts {
  exclude?: string[]     // gitignore-style globs
  maxAge?: number        // cache-control seconds
  headers?: Record<string, string>
  dotfiles?: 'ignore' | 'allow' | 'deny'  // default: 'ignore'

  // What happens when someone hits the folder root (e.g. GET /assets/ or GET /assets)
  // - 'index'     : serve the index file if it exists, 404 otherwise (default if index is set)
  // - 'none'      : 404 (default if no index is set)
  // - 'list'      : return a JSON array of filenames
  // - 'directory'  : return an HTML directory listing page
  // - (files: string[]) => FileResponse : custom — build your own response (gallery, TOC, etc.)
  onDirectory?: 'none' | 'index' | 'list' | 'directory' | ((files: string[]) => FileResponse | Promise<FileResponse>)
  index?: string         // which file to serve for 'index' mode (e.g. 'index.html')
}
```

### Exclude globs

Gitignore semantics:
- `**/*.map` — all `.map` files in any subdirectory
- `.DS_Store` — exact name anywhere
- `secrets/**` — entire directory
- `**/.*` — all dotfiles

### Virtual file systems

`StaticFolder` accepts three source types. The first two (directory path, in-memory map) are convenience wrappers around the third — everything ultimately goes through a `VirtualFileSystem` interface:

```typescript
interface VirtualFileSystem {
  // List files at a path (like `ls`). Return filenames, not full paths.
  // path is '' for root, 'subdir' for a subdirectory, etc.
  list(path: string): string[] | Promise<string[]>

  // Read a file (like `cat`). Return content or null if not found.
  read(path: string): string | Uint8Array | null | Promise<string | Uint8Array | null>
}
```

```python
class VirtualFileSystem(Protocol):
    def list(self, path: str) -> list[str]: ...
    def read(self, path: str) -> str | bytes | None: ...
```

This is what client-side servers and browser environments use under the hood. It also enables custom backends — serve from S3, a database, a zip file, a git tree, whatever:

```typescript
@Controller()
class MyApp {
  // Filesystem directory — internally wraps as a VirtualFileSystem
  assets = new StaticFolder('./public')

  // In-memory map — also wraps as a VirtualFileSystem
  bundled = new StaticFolder({
    'index.html': '<html>...</html>',
    'style.css': 'body { margin: 0 }',
  })

  // Custom VFS — you implement list() and read()
  uploads = new StaticFolder({
    async list(path: string) {
      const rows = await db.query('SELECT name FROM files WHERE dir = ?', [path])
      return rows.map(r => r.name)
    },
    async read(path: string) {
      const row = await db.query('SELECT content FROM files WHERE path = ?', [path])
      return row?.content ?? null
    },
  }, {
    exclude: ['**/*.tmp'],
    onDirectory: 'list',
  })

  // S3-backed
  s3files = new StaticFolder(new S3FileSystem('my-bucket', 'prefix/'), {
    onDirectory: (files) => FileResponse.from(
      renderGalleryHtml(files.filter(f => f.endsWith('.jpg'))),
      'gallery.html'
    ),
    maxAge: 86400,
  })
}
```

```python
@Controller()
class MyApp:
    # Custom VFS in Python
    uploads = StaticFolder(DatabaseFS(connection), exclude=['**/*.tmp'], on_directory='list')
```

The in-memory `Record<string, string | Uint8Array>` form also supports objects with a `read()` method instead of raw content, enabling lazy/dynamic files:

```typescript
bundled = new StaticFolder({
  'config.json': { read: () => JSON.stringify(getCurrentConfig()) },
  'index.html': '<html>static content</html>',        // plain string = static
  'logo.png': fs.readFileSync('./logo.png'),           // Uint8Array = static
})
```

### `onDirectory` behavior

When someone requests the root of a `StaticFolder` (e.g. `GET /assets/` or `GET /assets`), or any sub-directory within it:

| `onDirectory` value | Behavior |
|---------------------|----------|
| `'none'`            | 404. Directory requests are not served. (Default when no `index` is set) |
| `'index'`           | Serve the `index` file (e.g. `index.html`) if it exists in that directory, 404 otherwise. (Default when `index` is set) |
| `'list'`            | Return a JSON array of filenames in the directory: `["file.txt", "subdir/", "image.png"]` |
| `'directory'`       | Return a styled HTML directory listing page with links |
| `(files) => FileResponse` | Custom handler — receives the file list, returns whatever you want (gallery, table of contents, README rendering, etc.) |

```typescript
// Examples of onDirectory usage

// API-style: just give me the file list as JSON
docs = new StaticFolder('./docs', { onDirectory: 'list' })
// GET /docs/ → ["getting-started.md", "api-reference.md", "images/"]

// Browseable directory
uploads = new StaticFolder('./uploads', { onDirectory: 'directory' })
// GET /uploads/ → <html><ul><li><a href="photo.jpg">photo.jpg</a></li>...</ul></html>

// Custom gallery for image directories
photos = new StaticFolder('./photos', {
  onDirectory: (files) => {
    const images = files.filter(f => /\.(jpg|png|gif|webp)$/i.test(f))
    return FileResponse.from(renderGallery(images), 'gallery.html')
  }
})

// SPA fallback: always serve index.html for any path
spa = new StaticFolder('./dist', {
  index: 'index.html',
  onDirectory: 'index',
})
```

---

## `FileResponse` API

```typescript
class FileResponse {
  readonly filename: string
  readonly contentType: string
  readonly headers: Record<string, string>

  // From a file path (Node.js / Python — streams on HTTP, buffers on CSS)
  static from(path: string): FileResponse
  static from(path: string, opts: FileResponseOpts): FileResponse

  // From raw content + filename
  static from(content: string | Buffer | Uint8Array, filename: string): FileResponse
  static from(content: string | Buffer | Uint8Array, filename: string, opts: FileResponseOpts): FileResponse
}

interface FileResponseOpts {
  contentType?: string   // override auto-detection
  maxAge?: number        // cache-control seconds
  headers?: Record<string, string>
}
```

Content-type auto-detected from filename extension (`.html` → `text/html`, `.png` → `image/png`, etc). Unknown extensions → `application/octet-stream`.

`FileResponse` is usable from any controller method — API endpoints that generate PDFs, CSVs, etc. Methods with return type `FileResponse` are excluded from OpenAPI.

---

## How routing works

### Variable name → URL prefix

The class variable name determines the URL prefix, just like method names determine route paths in normal plat controllers.

| Variable name | Serves at |
|---------------|-----------|
| `assets`      | `/assets/*`, `/assets/sub/dir/file.css` |
| `docs`        | `/docs/*`, `/docs/getting-started.html` |
| `root`        | `/*` (root — lowest priority, after all API routes) |

`root` is a reserved name. A `StaticFolder` assigned to `root` serves from `/` and acts as a fallback after all other routes. This is how you serve an SPA or static site from the base URL.

### Multipart path resolution

When a request comes in for `/assets/css/style.css`:
1. Match the first segment (`assets`) to a `StaticFolder` class variable
2. Resolve the remaining path (`css/style.css`) against the folder contents
3. Check exclude globs — if excluded, 404
4. Serve with auto-detected content-type

### Stem matching

When a request has no file extension:
1. Look for an exact match first (`/assets/readme` → file named `readme`)
2. If no exact match, glob for `readme.*` in that directory
3. If exactly one match → serve it
4. If zero or multiple matches → 404

### OpenAPI exclusion

During OpenAPI generation, the framework skips:
- Class variables typed as `StaticFolder`
- Methods with return type annotation `FileResponse`

These never appear in the generated spec, tools list, or documentation endpoints.

---

## Implementation plan

### Phase 1: `VirtualFileSystem` interface + built-in implementations (TypeScript)
1. Define `VirtualFileSystem` interface (`list`, `read`)
2. `NodeFileSystem` — wraps a directory path, uses `fs` for list/read
3. `MemoryFileSystem` — wraps a `Record<string, string | Uint8Array | { read() }>`, supports lazy `read()` objects
4. Detection logic: `StaticFolder` constructor inspects the first argument — string → `NodeFileSystem`, plain object with string/buffer values → `MemoryFileSystem`, object with `list`+`read` → use directly as VFS

### Phase 2: `FileResponse` + `StaticFolder` (TypeScript)
1. `FileResponse` class — content-type detection from filename, streaming support, header management
2. `StaticFolder` class — wraps a VFS + opts, handles exclude globs, stem matching, `onDirectory` behavior
3. MIME type map — shared utility
4. Glob matching for excludes — minimatch or similar

### Phase 3: Server integration (TypeScript PLATServer)
1. Controller registration — detect `StaticFolder` instances on class properties, register wildcard Express routes (`/varName/*`)
2. Response pipeline — detect `FileResponse` return type, set content-type/headers, stream body
3. `root` handling — register as lowest-priority fallback after all API routes
4. OpenAPI exclusion — skip `StaticFolder` variables and `FileResponse`-typed methods during spec generation
5. `onDirectory` — wire up directory request handling per the configured mode

### Phase 4: Python PLATServer (FastAPI)
1. `FileResponse` / `StaticFolder` / `VirtualFileSystem` Python equivalents
2. Wire into FastAPI — catch-all routes with appropriate priority
3. Feature parity with TypeScript

### Phase 5: Client-side servers
1. Client-side servers use `MemoryFileSystem` or custom VFS (no real filesystem available)
2. Serve over WebRTC data channel / message transport
3. Build helper: `bundleDir('./public', opts)` → `Record<string, Uint8Array>` for compile-time bundling of directories into in-memory maps
4. Stem matching and `onDirectory` work identically against the VFS

### Phase 6: Cross-cutting
- Tests: multipart paths, stem matching, exclude globs, root serving, `onDirectory` modes, OpenAPI exclusion, content-type detection, lazy `read()` objects, custom VFS implementations
- Documentation and examples