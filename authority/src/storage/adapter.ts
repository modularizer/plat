/**
 * Storage abstraction for PLAT Authority
 * 
 * Allows swappable storage backends: Drizzle (Postgres), In-Memory, JSON, YAML, etc.
 * 
 * Usage:
 * 
 * const storage = getStorageAdapter({
 *   type: 'json',           // or 'drizzle', 'memory', 'yaml'
 *   path: './data.json'     // required for file-based adapters
 * })
 * 
 * const ownerGoogleSub = await storage.getServerOwner('my-server')
 * await storage.setServerOwner('my-server', 'google-sub-123')
 */

import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { getDatabase } from '../db/client.js'
import { servers, users } from '../db/schema.js'
import { eq } from 'drizzle-orm'

export interface StorageAdapter {
  /** Get the Google sub of the server owner, or null if not found */
  getServerOwner(serverName: string): Promise<string | null>

  /** Set the owner of a server */
  setServerOwner(serverName: string, googleSub: string): Promise<void>

  /** Remove a server registration */
  deleteServerOwner(serverName: string): Promise<void>

  /** List all servers owned by a specific user */
  listServersByOwner(googleSub: string): Promise<string[]>

  /** Close/cleanup the adapter (e.g., close DB connections) */
  close?(): Promise<void>
}

// ============================================================================
// In-Memory Adapter (for testing, lightweight deployments)
// ============================================================================

export class InMemoryStorageAdapter implements StorageAdapter {
  private serverToOwner = new Map<string, string>()

  async getServerOwner(serverName: string): Promise<string | null> {
    return this.serverToOwner.get(serverName) ?? null
  }

  async setServerOwner(serverName: string, googleSub: string): Promise<void> {
    this.serverToOwner.set(serverName, googleSub)
  }

  async deleteServerOwner(serverName: string): Promise<void> {
    this.serverToOwner.delete(serverName)
  }

  async listServersByOwner(googleSub: string): Promise<string[]> {
    return Array.from(this.serverToOwner.entries())
      .filter(([_, owner]) => owner === googleSub)
      .map(([serverName]) => serverName)
  }
}

// ============================================================================
// JSON File Adapter (for small-scale deployments, data portability)
// ============================================================================

interface JsonData {
  servers: Record<string, string>
}

export class JsonFileStorageAdapter implements StorageAdapter {
  private data: JsonData = { servers: {} }

  constructor(private filePath: string) {}

  async initialize(): Promise<void> {
    if (existsSync(this.filePath)) {
      try {
        const content = await readFile(this.filePath, 'utf-8')
        this.data = JSON.parse(content)
      } catch (error) {
        console.warn(`[storage] Failed to read ${this.filePath}, starting with empty data`)
        this.data = { servers: {} }
      }
    }
  }

  private async save(): Promise<void> {
    try {
      await writeFile(this.filePath, JSON.stringify(this.data, null, 2))
    } catch (error: any) {
      console.error(`[storage] Failed to save ${this.filePath}:`, error.message)
      throw error
    }
  }

  async getServerOwner(serverName: string): Promise<string | null> {
    return this.data.servers[serverName] ?? null
  }

  async setServerOwner(serverName: string, googleSub: string): Promise<void> {
    this.data.servers[serverName] = googleSub
    await this.save()
  }

  async deleteServerOwner(serverName: string): Promise<void> {
    delete this.data.servers[serverName]
    await this.save()
  }

  async listServersByOwner(googleSub: string): Promise<string[]> {
    return Object.entries(this.data.servers)
      .filter(([_, owner]) => owner === googleSub)
      .map(([serverName]) => serverName)
  }
}

// ============================================================================
// YAML File Adapter (for human-readable deployments)
// ============================================================================

export class YamlFileStorageAdapter implements StorageAdapter {
  private data: Record<string, string> = {}
  private yaml: any

  constructor(private filePath: string) {
    // Lazy-load yaml if needed (optional dependency)
  }

  async initialize(): Promise<void> {
    try {
      this.yaml = await import('js-yaml')
    } catch {
      throw new Error(
        '[storage] YAML adapter requires "js-yaml" package. Install with: npm install js-yaml',
      )
    }

    if (existsSync(this.filePath)) {
      try {
        const content = await readFile(this.filePath, 'utf-8')
        const parsed = this.yaml.load(content)
        this.data = (parsed?.servers as Record<string, string>) || {}
      } catch (error) {
        console.warn(`[storage] Failed to read ${this.filePath}, starting with empty data`)
        this.data = {}
      }
    }
  }

  private async save(): Promise<void> {
    try {
      const content = this.yaml.dump({ servers: this.data })
      await writeFile(this.filePath, content)
    } catch (error: any) {
      console.error(`[storage] Failed to save ${this.filePath}:`, error.message)
      throw error
    }
  }

  async getServerOwner(serverName: string): Promise<string | null> {
    return this.data[serverName] ?? null
  }

  async setServerOwner(serverName: string, googleSub: string): Promise<void> {
    this.data[serverName] = googleSub
    await this.save()
  }

  async deleteServerOwner(serverName: string): Promise<void> {
    delete this.data[serverName]
    await this.save()
  }

  async listServersByOwner(googleSub: string): Promise<string[]> {
    return Object.entries(this.data)
      .filter(([_, owner]) => owner === googleSub)
      .map(([serverName]) => serverName)
  }
}

// ============================================================================
// Drizzle Adapter (for Postgres production deployments)
// ============================================================================

export class DrizzleStorageAdapter implements StorageAdapter {
  async getServerOwner(serverName: string): Promise<string | null> {
    const db = await getDatabase()

    const server = await db.query.servers.findFirst({
      where: eq(servers.serverName, serverName),
      with: {
        owner: true,
      },
    })

    return server?.owner.googleSub ?? null
  }

  async setServerOwner(serverName: string, googleSub: string): Promise<void> {
    const db = await getDatabase()

    const [owner] = await db
      .insert(users)
      .values({ googleSub })
      .onConflictDoUpdate({
        target: users.googleSub,
        set: { updatedAt: new Date() },
      })
      .returning({ id: users.id })

    if (!owner) {
      throw new Error(`[storage] Failed to resolve owner for ${serverName}`)
    }

    await db
      .insert(servers)
      .values({
        serverName,
        ownerId: owner.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: servers.serverName,
        set: {
          ownerId: owner.id,
          updatedAt: new Date(),
        },
      })
  }

  async deleteServerOwner(serverName: string): Promise<void> {
    const db = await getDatabase()
    await db.delete(servers).where(eq(servers.serverName, serverName))
  }

  async listServersByOwner(googleSub: string): Promise<string[]> {
    const db = await getDatabase()
    const owner = await db.query.users.findFirst({
      where: eq(users.googleSub, googleSub),
      columns: { id: true },
    })

    if (!owner) {
      return []
    }

    const ownedServers = await db.query.servers.findMany({
      where: eq(servers.ownerId, owner.id),
      columns: { serverName: true },
    })

    return ownedServers.map((row) => row.serverName)
  }
}

// ============================================================================
// Factory
// ============================================================================

export interface StorageConfig {
  type: 'memory' | 'json' | 'yaml' | 'drizzle'
  path?: string
}

export async function createStorageAdapter(config: StorageConfig): Promise<StorageAdapter> {
  switch (config.type) {
    case 'memory':
      console.log('[storage] Using in-memory adapter (data will be lost on restart)')
      return new InMemoryStorageAdapter()

    case 'json':
      if (!config.path) {
        throw new Error('[storage] JSON adapter requires "path" config')
      }
      console.log(`[storage] Using JSON file adapter: ${config.path}`)
      const jsonAdapter = new JsonFileStorageAdapter(config.path)
      await jsonAdapter.initialize()
      return jsonAdapter

    case 'yaml':
      if (!config.path) {
        throw new Error('[storage] YAML adapter requires "path" config')
      }
      console.log(`[storage] Using YAML file adapter: ${config.path}`)
      const yamlAdapter = new YamlFileStorageAdapter(config.path)
      await yamlAdapter.initialize()
      return yamlAdapter

    case 'drizzle':
      console.log('[storage] Using Drizzle/Postgres adapter')
      return new DrizzleStorageAdapter()

    default:
      throw new Error(`[storage] Unknown adapter type: ${config.type}`)
  }
}

export function getStorageConfigFromEnv(): StorageConfig {
  const type = (process.env.STORAGE_TYPE || 'drizzle') as StorageConfig['type']
  const path = process.env.STORAGE_PATH

  if ((type === 'json' || type === 'yaml') && !path) {
    throw new Error(`[storage] ${type.toUpperCase()}_PATH environment variable required for ${type} adapter`)
  }

  return { type, path }
}
