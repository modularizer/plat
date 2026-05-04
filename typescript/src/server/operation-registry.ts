import type { PLATServerCallEnvelope, PLATServerResolvedOperation } from './transports'
import { matchesWildcardPath } from './routing'

export class PLATOperationRegistry {
  private operationsById = new Map<string, PLATServerResolvedOperation>()
  private operationsByRoute = new Map<string, PLATServerResolvedOperation>()
  private wildcardOperations: PLATServerResolvedOperation[] = []

  register(operation: PLATServerResolvedOperation): void {
    this.operationsById.set(operation.methodName, operation)
    if (operation.isWildcard) {
      this.wildcardOperations.push(operation)
      this.wildcardOperations.sort((a, b) => b.path.length - a.path.length)
      return
    }

    this.operationsByRoute.set(`${operation.method.toUpperCase()} ${operation.path}`, operation)
  }

  resolve(envelope: Pick<PLATServerCallEnvelope, 'operationId' | 'method' | 'path'>): PLATServerResolvedOperation | undefined {
    const byId = envelope.operationId ? this.operationsById.get(envelope.operationId) : undefined
    if (byId) return byId

    const exact = this.operationsByRoute.get(`${envelope.method.toUpperCase()} ${envelope.path}`)
    if (exact) return exact

    const transportMethod = envelope.method.toUpperCase()
    return this.wildcardOperations.find(
      (operation) => (
        (operation.method === '*' || operation.method.toUpperCase() === transportMethod)
        && matchesWildcardPath(operation.path, envelope.path)
      ),
    )
  }

  list(): PLATServerResolvedOperation[] {
    return Array.from(this.operationsById.values())
  }
}
