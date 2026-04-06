/**
 * Example: Using runClientSideServer with multiple files
 * 
 * This shows how to use the improved runClientSideServer function
 * to organize controller logic across multiple TypeScript files.
 */

import { runClientSideServer } from '@modularizer/plat/client-server'

// Example 1: Single file (backward compatible)
async function singleFileExample() {
  const source = `
    import { serveClientSideServer } from '@modularizer/plat/client-server'
    
    class MathApi {
      async add({ a, b }: { a: number; b: number }) {
        return a + b
      }
    }
    
    export default serveClientSideServer('math-api', [MathApi])
  `
  
  const server = await runClientSideServer(source)
  return server
}

// Example 2: Multiple files with organized structure
async function multiFileExample() {
  const sourceFiles: Record<string, string> = {
    'index.ts': `
      import { serveClientSideServer } from '@modularizer/plat/client-server'
      import { MathApi } from './api/math'
      import { StringApi } from './api/string'
      
      export default serveClientSideServer('multi-api', [MathApi, StringApi])
    `,
    
    'api/math.ts': `
      /** Math operations */
      export class MathApi {
        /** Add two numbers */
        async add({ a, b }: { a: number; b: number }) {
          console.log('Computing', a, '+', b)
          return a + b
        }
        
        /** Multiply two numbers */
        async multiply({ a, b }: { a: number; b: number }) {
          return a * b
        }
      }
    `,
    
    'api/string.ts': `
      /** String manipulation operations */
      export class StringApi {
        /** Convert string to uppercase */
        async toUpper({ text }: { text: string }) {
          return text.toUpperCase()
        }
        
        /** Concatenate strings */
        async concat({ parts }: { parts: string[] }) {
          return parts.join('')
        }
      }
    `,
    
    'utils/helpers.ts': `
      export function formatOutput(value: any): string {
        return JSON.stringify(value, null, 2)
      }
    `,
  }
  
  // Note: The API automatically detects index.ts as the entry point,
  // but you can also explicitly specify it:
  const server = await runClientSideServer(sourceFiles, {
    sourceEntryPoint: 'index.ts', // optional - auto-detected if not specified
  })
  
  return server
}

// Example 3: Custom transpile function for multi-file
async function customTranspileExample() {
  const sourceFiles: Record<string, string> = {
    'index.ts': `
      import { serveClientSideServer } from '@modularizer/plat/client-server'
      import { ApiControllers } from './controllers'
      
      export default serveClientSideServer('custom-api', ApiControllers)
    `,
    
    'controllers.ts': `
      import { UserController } from './user'
      import { ProductController } from './product'
      
      export const ApiControllers = [UserController, ProductController]
    `,
    
    'user.ts': `
      export class UserController {
        async getUser({ id }: { id: number }) {
          return { id, name: 'User ' + id }
        }
      }
    `,
    
    'product.ts': `
      export class ProductController {
        async getProduct({ id }: { id: number }) {
          return { id, title: 'Product ' + id }
        }
      }
    `,
  }
  
  // Custom transpiler that might add logging or other transformations
  const customTranspile = (source: string | Record<string, string>, entryPoint?: string) => {
    if (typeof source === 'string') {
      return source // Single file - use as-is
    }
    
    // Multi-file - could apply custom bundling logic here
    console.log('Transpiling multiple files:', Object.keys(source))
    console.log('Entry point:', entryPoint)
    
    // Delegate to built-in transpiler (or implement custom bundling)
    throw new Error('Custom transpiler must handle multi-file bundling')
  }
  
  const server = await runClientSideServer(sourceFiles, {
    sourceEntryPoint: 'index.ts',
    // transpile: customTranspile, // uncomment to use custom transpiler
  })
  
  return server
}

// Type definitions for shared data across files
export interface User {
  id: number
  name: string
  email: string
}

export interface Product {
  id: number
  title: string
  price: number
}

// Example 4: With shared types and models
async function typedMultiFileExample() {
  const sourceFiles: Record<string, string> = {
    'index.ts': `
      import { serveClientSideServer } from '@modularizer/plat/client-server'
      import { UserService } from './services/user'
      
      export default serveClientSideServer('typed-api', [UserService])
    `,
    
    'types.ts': `
      export interface User {
        id: number
        name: string
        email: string
      }
      
      export interface CreateUserRequest {
        name: string
        email: string
      }
    `,
    
    'services/user.ts': `
      import { User, CreateUserRequest } from '../types'
      
      export class UserService {
        private users: Map<number, User> = new Map()
        private nextId = 1
        
        async createUser({ name, email }: CreateUserRequest): Promise<User> {
          const user: User = { id: this.nextId++, name, email }
          this.users.set(user.id, user)
          return user
        }
        
        async getUser({ id }: { id: number }): Promise<User | null> {
          return this.users.get(id) ?? null
        }
        
        async listUsers(): Promise<User[]> {
          return Array.from(this.users.values())
        }
      }
    `,
  }
  
  const server = await runClientSideServer(sourceFiles, {
    sourceEntryPoint: 'index.ts',
  })
  
  return server
}

export { singleFileExample, multiFileExample, customTranspileExample, typedMultiFileExample }

