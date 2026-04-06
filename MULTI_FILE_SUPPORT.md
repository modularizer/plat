# Multi-File Support for `runClientSideServer`

## Overview

The `runClientSideServer` function has been improved to support multiple TypeScript files as input, allowing you to organize controller logic across multiple modules instead of bundling everything into a single source string.

### Key Features

- **Backward Compatible**: Existing code using single string sources continues to work without changes
- **Automatic Module Resolution**: Multiple files are bundled together with proper type sharing
- **Entry Point Detection**: Automatically finds `index.ts` or uses the first file as entry point
- **Unified Type Registry**: Type definitions from all files are available across the module
- **Clean API**: Function overloading allows for intuitive usage patterns

## API Changes

### Function Signatures

```typescript
// Single file (existing API - still works)
export function runClientSideServer(
  source: string,
  options?: RunClientSideServerOptions,
): Promise<StartedClientSideServer>

// Multiple files (new overload)
export function runClientSideServer(
  source: Record<string, string>,
  options?: RunClientSideServerOptions & { sourceEntryPoint?: string },
): Promise<StartedClientSideServer>
```

### Updated Options Interface

```typescript
export interface StartClientSideServerFromSourceOptions extends ClientSideServerMQTTWebRTCOptions {
  // ... existing options ...
  
  // New options for multi-file support
  source: string | Record<string, string>
  sourceEntryPoint?: string
  transpile?: (source: string | Record<string, string>, entryPoint?: string) => string | Promise<string>
  analyzeSource?: (source: string | Record<string, string>, entryPoint?: string) => ClientSideServerSourceAnalysis | Promise<ClientSideServerSourceAnalysis>
}
```

## Usage Examples

### Example 1: Single File (Backward Compatible)

```typescript
const server = await runClientSideServer(`
  import { serveClientSideServer } from '@modularizer/plat/client-server'
  
  class MathApi {
    async add({ a, b }: { a: number; b: number }) {
      return a + b
    }
  }
  
  export default serveClientSideServer('math-api', [MathApi])
`)
```

### Example 2: Multiple Files

```typescript
const sourceFiles = {
  'index.ts': `
    import { serveClientSideServer } from '@modularizer/plat/client-server'
    import { MathApi } from './api/math'
    import { StringApi } from './api/string'
    
    export default serveClientSideServer('multi-api', [MathApi, StringApi])
  `,
  
  'api/math.ts': `
    export class MathApi {
      async add({ a, b }: { a: number; b: number }) {
        return a + b
      }
    }
  `,
  
  'api/string.ts': `
    export class StringApi {
      async toUpper({ text }: { text: string }) {
        return text.toUpperCase()
      }
    }
  `,
}

const server = await runClientSideServer(sourceFiles)
```

### Example 3: With Explicit Entry Point

```typescript
const server = await runClientSideServer(sourceFiles, {
  sourceEntryPoint: 'custom-entry.ts', // if not 'index.ts'
})
```

### Example 4: With Shared Types

```typescript
const sourceFiles = {
  'index.ts': `
    import { serveClientSideServer } from '@modularizer/plat/client-server'
    import { UserService } from './services/user'
    
    export default serveClientSideServer('user-api', [UserService])
  `,
  
  'types.ts': `
    export interface User {
      id: number
      name: string
      email: string
    }
  `,
  
  'services/user.ts': `
    import { User } from '../types'
    
    export class UserService {
      async getUser({ id }: { id: number }): Promise<User> {
        return { id, name: 'User', email: 'user@example.com' }
      }
    }
  `,
}

const server = await runClientSideServer(sourceFiles)
```

## Implementation Details

### How Multi-File Bundling Works

1. **Transpilation Phase**
   - Each file is transpiled independently using TypeScript's `transpileModule`
   - Shared compiler options ensure compatibility across files
   - Entry point is identified (defaults to `index.ts` or first file)

2. **Module Wrapping**
   - Each transpiled file is wrapped in an IIFE (Immediately Invoked Function Expression)
   - All wrapped modules are stored in a `__modules` namespace
   - The entry point's exports are re-exported as the default module export

3. **Type Analysis Phase**
   - All TypeScript source files are parsed independently
   - Type definitions (interfaces, type aliases, enums) are collected into a unified registry
   - Controllers are extracted from all files using this unified registry
   - Metadata (summaries, descriptions) is applied across all files

### Internal Helper Functions

- `transpileMultipleFiles()`: Orchestrates transpilation of all source files
- `analyzeClientSideServerMultipleFiles()`: Analyzes all files with cross-file type resolution
- `createMultiFileBundle()`: Creates the final bundled JavaScript module
- `analyzeControllerWithContext()`: Analyzes a single controller with access to all types
- `isKind()`: Helper to check TypeScript node kinds
- `getNodeDocHelper()`: Helper to extract JSDoc documentation

## Limitations and Future Enhancements

### Current Limitations

1. **Module Resolution**: Basic file-to-file imports are tracked but not fully resolved at runtime
2. **Circular Dependencies**: Not supported; will cause issues during analysis
3. **Dynamic Imports**: Not supported; all imports must be static
4. **Tree-Shaking**: Unused code is not removed from the bundle
5. **Type-Only Files**: `.d.ts` files are not supported as separate inputs

### Recommended for Future Versions

1. Full ES module loader for runtime imports
2. Circular dependency detection with diagnostics
3. Tree-shaking support to reduce bundle size
4. Support for type-only `.d.ts` files
5. Source map generation for easier debugging

## Migration Guide

### For Existing Code

**No changes required!** The API is fully backward compatible. Existing code using single string sources will continue to work:

```typescript
// This still works exactly as before
const server = await runClientSideServer(sourceCode)
```

### To Adopt Multi-File Organization

1. Prepare your source files as a `Record<string, string>` map
2. Ensure you have an `index.ts` file as the entry point (or specify another)
3. Pass the file map instead of a single string:

```typescript
// Before: Single file
const server = await runClientSideServer(allCodeInOneString)

// After: Multiple files
const server = await runClientSideServer({
  'index.ts': mainCode,
  'controllers/user.ts': userController,
  'types.ts': typeDefinitions,
})
```

## Best Practices

1. **Organize by Feature**: Group related controllers and types together
   ```
   index.ts          // Main entry point
   api/users/
     controller.ts   // UserController
     types.ts        // User-related types
     service.ts      // User business logic
   api/products/
     controller.ts   // ProductController
     types.ts        // Product-related types
   ```

2. **Use Shared Types File**: Create a `types.ts` for interfaces used across modules
   ```typescript
   // types.ts
   export interface ApiResponse<T> {
     data: T
     success: boolean
   }
   ```

3. **Explicit Exports**: Make sure each controller is properly exported from its module
   ```typescript
   // api/users/controller.ts
   export class UserController {
     // ...
   }
   ```

4. **Entry Point Configuration**: Always ensure your entry point exports the `serveClientSideServer` definition
   ```typescript
   // index.ts
   import { serveClientSideServer } from '@modularizer/plat/client-server'
   import { UserController } from './api/users/controller'
   
   export default serveClientSideServer('my-api', [UserController])
   ```

## Troubleshooting

### "Entry point not found" Error

Make sure your entry point file exists in the source map:
```typescript
// ✗ Wrong - 'server.ts' not in the map
await runClientSideServer(files, { sourceEntryPoint: 'server.ts' })

// ✓ Correct - file exists in the map
const files = { 'server.ts': '...', 'controller.ts': '...' }
await runClientSideServer(files, { sourceEntryPoint: 'server.ts' })
```

### Controllers Not Found

1. Verify all controllers are exported from their modules
2. Check that the entry point imports and registers all controllers
3. Ensure controller names don't have typos or conflicts

### Type Definition Issues

1. Ensure type definitions are in the same source files (or a shared file imported by all)
2. Avoid circular type dependencies
3. Use explicit type annotations for all inputs/outputs

## See Also

- [Example Usage](/samples/6-client-side-server/multi-file-example.ts)
- [Runtime API Documentation](/src/client-side-server/runtime.ts)
- [Source Analysis](/src/client-side-server/source-analysis.ts)

