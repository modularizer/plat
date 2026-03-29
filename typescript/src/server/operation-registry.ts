import type { PLATServerCallEnvelope, PLATServerResolvedOperation } from './transports'

export class PLATOperationRegistry {
  private operationsById = new Map<string, PLATServerResolvedOperation>()
  private operationsByRoute = new Map<string, PLATServerResolvedOperation>()

  register(operation: PLATServerResolvedOperation): void {
    this.operationsById.set(operation.methodName, operation)
    this.operationsByRoute.set(`${operation.method.toUpperCase()} ${operation.path}`, operation)
  }

  resolve(envelope: Pick<PLATServerCallEnvelope, 'operationId' | 'method' | 'path'>): PLATServerResolvedOperation | undefined {
    return (envelope.operationId ? this.operationsById.get(envelope.operationId) : undefined)
      ?? this.operationsByRoute.get(`${envelope.method.toUpperCase()} ${envelope.path}`)
  }

  list(): PLATServerResolvedOperation[] {
    return Array.from(this.operationsById.values())
  }
}
