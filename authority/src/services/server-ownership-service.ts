import type { StorageAdapter } from '../storage/adapter.js'
import { getOwnershipKeyFromServerName, getNamespaceOwnershipKey } from './routing-service.js'

export interface ServerOwnershipService {
  getOwnerGoogleSub(serverName: string): Promise<string | null> | string | null
  getNamespaceOwnerGoogleSub(origin: string, namespace: string): Promise<string | null> | string | null
  setNamespaceOwnerGoogleSub(origin: string, namespace: string, googleSub: string): Promise<void> | void
}

export class StorageAdapterServerOwnershipService implements ServerOwnershipService {
  constructor(private storage: StorageAdapter) {}

  async getOwnerGoogleSub(serverName: string): Promise<string | null> {
    return this.storage.getServerOwner(getOwnershipKeyFromServerName(serverName))
  }

  async getNamespaceOwnerGoogleSub(origin: string, namespace: string): Promise<string | null> {
    return this.storage.getServerOwner(getNamespaceOwnershipKey(origin, namespace))
  }

  async setNamespaceOwnerGoogleSub(origin: string, namespace: string, googleSub: string): Promise<void> {
    await this.storage.setServerOwner(getNamespaceOwnershipKey(origin, namespace), googleSub)
  }
}

export class InMemoryServerOwnershipService implements ServerOwnershipService {
  private readonly ownership = new Map<string, string>()

  constructor(entries: Iterable<readonly [serverName: string, googleSub: string]> = []) {
    for (const [serverName, googleSub] of entries) {
      this.ownership.set(serverName, googleSub)
    }
  }

  getOwnerGoogleSub(serverName: string): string | null {
    return this.ownership.get(serverName) ?? null
  }

  getNamespaceOwnerGoogleSub(origin: string, namespace: string): string | null {
    return this.ownership.get(getNamespaceOwnershipKey(origin, namespace)) ?? null
  }

  setNamespaceOwnerGoogleSub(origin: string, namespace: string, googleSub: string): void {
    this.ownership.set(getNamespaceOwnershipKey(origin, namespace), googleSub)
  }

  setOwner(serverName: string, googleSub: string): void {
    this.ownership.set(serverName, googleSub)
  }

  deleteOwner(serverName: string): void {
    this.ownership.delete(serverName)
  }
}

