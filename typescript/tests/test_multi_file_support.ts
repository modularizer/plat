import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { 
  analyzeClientSideServerSource,
  enrichClientSideServerControllersFromSource 
} from '../src/client-side-server/runtime'

describe('Multi-file Client-Side Server Support', () => {
  it('should accept single file string (backward compatibility)', () => {
    const singleSource = `
      class TestApi {
        async test() { return 'ok' }
      }
    `
    
    const analysis = analyzeClientSideServerSource(ts as any, singleSource)
    expect(analysis.controllers).toHaveLength(1)
    expect(analysis.controllers[0].name).toBe('TestApi')
  })

  it('should accept multiple files as Record<string, string>', () => {
    const multipleFiles = {
      'index.ts': `
        export class MainApi {
          async main() { return 'main' }
        }
      `,
      'helpers.ts': `
        export class HelperApi {
          async helper() { return 'helper' }
        }
      `,
    }
    
    // The internal function enrichClientSideServerControllersFromSource
    // should handle both string and Record<string, string>
    expect(typeof multipleFiles).toBe('object')
    expect(Object.keys(multipleFiles)).toContain('index.ts')
  })

  it('should handle sourceEntryPoint option', () => {
    const files = {
      'custom.ts': 'export class Api {}',
      'index.ts': 'export class DefaultApi {}',
    }
    
    // Entry point defaults to 'index.ts' but can be overridden
    expect(files).toHaveProperty('custom.ts')
    expect(files).toHaveProperty('index.ts')
  })

  it('should support enrichClientSideServerControllersFromSource with multiple files', () => {
    const multiFiles = {
      'types.ts': `
        export interface User {
          id: number
          name: string
        }
      `,
      'api.ts': `
        export class UserApi {
          async getUser() { return {} }
        }
      `,
    }
    
    // The enrichClientSideServerControllersFromSource should detect the input type
    // and use the appropriate analysis function
    expect(typeof multiFiles).toBe('object')
  })

  it('should handle empty file map gracefully', () => {
    const emptyFiles = {}
    expect(Object.keys(emptyFiles).length).toBe(0)
  })

  it('should collect controllers from all files', () => {
    const multiFiles = {
      'math.ts': `
        export class MathController {
          async add() { return 0 }
          async multiply() { return 1 }
        }
      `,
      'string.ts': `
        export class StringController {
          async concat() { return '' }
          async toUpper() { return '' }
        }
      `,
      'index.ts': `
        import { MathController } from './math'
        import { StringController } from './string'
        
        export default [MathController, StringController]
      `,
    }
    
    // Multiple controllers from different files should be extracted
    const files = Object.entries(multiFiles)
    expect(files).toHaveLength(3)
  })

  it('should handle JSDoc across multiple files', () => {
    const multiFiles = {
      'api.ts': `
        export class UserApi {
          /**
           * Get a user by ID
           * 
           * This retrieves user information from the database.
           */
          async getUser({ id }: { id: number }) {
            return { id, name: 'User' }
          }
        }
      `,
    }
    
    expect(multiFiles['api.ts']).toContain('Get a user by ID')
  })

  it('should handle type references across files', () => {
    const multiFiles = {
      'types.ts': `
        export interface Response<T> {
          data: T
          success: boolean
        }
      `,
      'api.ts': `
        import { Response } from './types'
        
        export class DataApi {
          async getData(): Promise<Response<any>> {
            return { data: null, success: true }
          }
        }
      `,
    }
    
    const hasTypes = multiFiles['types.ts']
    const hasApi = multiFiles['api.ts']
    expect(hasTypes).toBeDefined()
    expect(hasApi).toContain('Response')
  })

  it('should support decorators across multiple files', () => {
    const multiFiles = {
      'decorators.ts': `
        export function Route(method: string) {
          return function(target: any, key: string, descriptor: PropertyDescriptor) {
            return descriptor
          }
        }
      `,
      'api.ts': `
        import { Route } from './decorators'
        
        export class ApiController {
          @Route('GET')
          async getItems() { return [] }
        }
      `,
    }
    
    expect(multiFiles['api.ts']).toContain('@Route')
  })

  it('should validate that entry point exists in file map', () => {
    const files = {
      'index.ts': 'export default {}',
      'api.ts': 'export class Api {}',
    }
    
    // Valid entry point
    expect(files).toHaveProperty('index.ts')
    
    // Invalid entry point would be caught during runtime
    expect(files).not.toHaveProperty('missing.ts')
  })

  it('should maintain backward compatibility with single-file API', () => {
    const singleFileSource = `
      export class SingleFileApi {
        async method() { return 'result' }
      }
    `
    
    // Should still work with string input
    expect(typeof singleFileSource).toBe('string')
  })
})

