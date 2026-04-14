import 'dotenv/config'
import { getDatabase } from './db/client.js'

export async function initializeDatabase() {
  try {
    const db = await getDatabase()
    console.log('✅ Database connection verified')
    return db
  } catch (error: any) {
    console.error('❌ Database initialization failed:', error.message)
    throw error
  }
}

