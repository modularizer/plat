# Quick Reference: Multi-File `runClientSideServer`

## 30-Second Overview

The `runClientSideServer` function now accepts multiple TypeScript files as input:

```typescript
// ✅ Single file (still works)
await runClientSideServer(sourceCode)

// ✅ Multiple files (NEW!)
await runClientSideServer({
  'index.ts': `...`,
  'api/user.ts': `...`,
  'types.ts': `...`,
})
```

## Basic Usage

### Single File (Backward Compatible)
```typescript
const source = `
  class MyApi {
    async greet() { return 'Hello!' }
  }
  export default serveClientSideServer('my-api', [MyApi])
`
const server = await runClientSideServer(source)
```

### Multiple Files
```typescript
const files = {
  'index.ts': `
    import { serveClientSideServer } from '@modularizer/plat/client-server'
    import { UserApi } from './controllers/user'
    export default serveClientSideServer('api', [UserApi])
  `,
  
  'controllers/user.ts': `
    export class UserApi {
      async getUser({ id }: { id: number }) {
        return { id, name: 'User' }
      }
    }
  `,
  
  'types.ts': `
    export interface User {
      id: number
      name: string
    }
  `,
}

const server = await runClientSideServer(files)
```

### With Custom Entry Point
```typescript
const files = { 'main.ts': `...`, 'helpers.ts': `...` }
const server = await runClientSideServer(files, {
  sourceEntryPoint: 'main.ts',
})
```

## Key Features

| Feature | Details |
|---------|---------|
| **Backward Compatible** | Existing code works unchanged |
| **Auto Entry Point** | Defaults to `index.ts` or first file |
| **Type Sharing** | Types available across all files |
| **Easy Migration** | Pass `Record<string, string>` instead of single string |
| **Full Support** | Works with decorators, JSDoc, async/await, etc. |

## File Structure Example

```
'index.ts'           → Entry point, exports serveClientSideServer
'controllers/math.ts' → MathController class
'controllers/user.ts' → UserController class
'types.ts'           → Shared type definitions
'utils/helpers.ts'   → Helper functions
```

## Common Patterns

### Pattern 1: Controllers + Shared Types
```typescript
{
  'index.ts': `import { MathController } from './math'; export default serveClientSideServer('math', [MathController])`,
  'math.ts': `import { Dto } from './types'; export class MathController { async add(dto: Dto) {} }`,
  'types.ts': `export interface Dto { a: number; b: number }`,
}
```

### Pattern 2: Multiple Controllers
```typescript
{
  'index.ts': `import { UserController } from './users'; import { ProductController } from './products'; export default serveClientSideServer('api', [UserController, ProductController])`,
  'users.ts': `export class UserController { ... }`,
  'products.ts': `export class ProductController { ... }`,
}
```

### Pattern 3: With Business Logic
```typescript
{
  'index.ts': `import { UserService } from './services/user'; export default serveClientSideServer('api', [UserService])`,
  'services/user.ts': `import { UserRepository } from '../repositories/user'; export class UserService { constructor(private repo = new UserRepository()) {} }`,
  'repositories/user.ts': `export class UserRepository { ... }`,
}
```

## API Reference

### Function Signature
```typescript
export function runClientSideServer(
  source: string,
  options?: RunClientSideServerOptions,
): Promise<StartedClientSideServer>

export function runClientSideServer(
  source: Record<string, string>,
  options?: RunClientSideServerOptions & { sourceEntryPoint?: string },
): Promise<StartedClientSideServer>
```

### Options
```typescript
interface RunClientSideServerOptions {
  serverName?: string
  undecoratedMode?: 'GET' | 'POST' | 'private'
  sourceEntryPoint?: string  // 'index.ts' or your entry file
  mqttBroker?: string
  mqttTopic?: string
  mqttOptions?: any
  iceServers?: any[]
  connectionTimeoutMs?: number
  announceIntervalMs?: number
  clientIdPrefix?: string
  onRequest?: (direction: 'request' | 'response', payload: unknown) => void
  transpile?: (source: string | Record<string, string>, entryPoint?: string) => string | Promise<string>
  analyzeSource?: (source: string | Record<string, string>, entryPoint?: string) => ClientSideServerSourceAnalysis | Promise<ClientSideServerSourceAnalysis>
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Entry point not found" | Verify `sourceEntryPoint` exists in your file map |
| Controllers not loading | Check entry point exports `serveClientSideServer(...)` |
| Type errors in cross-file refs | Ensure types are defined/imported in using files |
| Missing exports | Use `export` keyword for classes and interfaces |

## Common Errors & Fixes

### ❌ Error: "Entry point ... not found"
```typescript
// ✗ Wrong - 'server.ts' not in map
const files = { 'index.ts': '...' }
await runClientSideServer(files, { sourceEntryPoint: 'server.ts' })

// ✓ Correct - use existing file
await runClientSideServer(files, { sourceEntryPoint: 'index.ts' })
```

### ❌ Error: "No controllers found"
```typescript
// ✗ Wrong - entry point doesn't export definition
'index.ts': `class Api {}`

// ✓ Correct - export serveClientSideServer result
'index.ts': `export default serveClientSideServer('api', [Api])`
```

### ❌ Error: "Cannot find type X"
```typescript
// ✗ Wrong - type not accessible
'api.ts': `export class Api { async method(x: UnknownType) {} }`

// ✓ Correct - import or define type
'api.ts': `import { MyType } from './types'; export class Api { async method(x: MyType) {} }`
```

## Tips & Best Practices

1. **Always have an entry point**: Make sure `index.ts` exists or specify `sourceEntryPoint`

2. **Export your classes**: Use `export` keyword for all controllers
   ```typescript
   export class UserController { ... }  // ✓
   class UserController { ... }         // ✗
   ```

3. **Use shared types file**: Create `types.ts` for interfaces used across multiple files

4. **Keep file structure clean**: Use descriptive names and logical organization

5. **Document with JSDoc**: Comments on methods will appear in the OpenAPI spec
   ```typescript
   export class UserApi {
     /** Get user by ID */
     async getUser({ id }: { id: number }) { ... }
   }
   ```

## Resources

- **Full Documentation**: See `MULTI_FILE_SUPPORT.md` for comprehensive guide
- **Examples**: Check `samples/6-client-side-server/multi-file-example.ts`
- **Tests**: See `tests/test_multi_file_support.ts` for test cases
- **Source**: Review `src/client-side-server/runtime.ts` for implementation

---

**Version**: 0.5.0+ | **Status**: ✅ Production Ready

