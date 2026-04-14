import 'dotenv/config'
import { createStorageAdapter, getStorageConfigFromEnv } from '../storage/adapter.js'
import { StorageAdapterServerOwnershipService } from '../services/server-ownership-service.js'

let storageInstance: Awaited<ReturnType<typeof createStorageAdapter>> | null = null
let ownershipServiceInstance: StorageAdapterServerOwnershipService | null = null

export async function getStorageAdapter() {
  if (!storageInstance) {
    const config = getStorageConfigFromEnv()
    storageInstance = await createStorageAdapter(config)
  }
  return storageInstance
}

export async function getServerOwnershipService() {
  if (!ownershipServiceInstance) {
    const storage = await getStorageAdapter()
    ownershipServiceInstance = new StorageAdapterServerOwnershipService(storage)
  }
  return ownershipServiceInstance
}

export async function closeStorage() {
  if (storageInstance && storageInstance.close) {
    await storageInstance.close()
    storageInstance = null
    ownershipServiceInstance = null
  }
}

