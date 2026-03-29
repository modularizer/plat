import chokidar from 'chokidar'
import { execSync } from 'child_process'
import path from 'path'

interface WatchState {
  currentProcess: NodeJS.Timeout | null
  lastChangeTime: number
  isRunning: boolean
  pendingRun: boolean
}

const state: WatchState = {
  currentProcess: null,
  lastChangeTime: 0,
  isRunning: false,
  pendingRun: false,
}

const DEBOUNCE_MS = 300

/**
 * Run the gen command
 */
function runGen(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      console.log('🔄 Running npm run gen...')
      const startTime = Date.now()

      execSync('npm run gen', {
        cwd,
        stdio: 'inherit',
      })

      const duration = Date.now() - startTime
      console.log(`✅ Gen completed in ${duration}ms`)
      resolve()
    } catch (error: any) {
      console.error('❌ Gen failed:', error.message)
      reject(error)
    }
  })
}

/**
 * Schedule a gen run with debouncing and restart logic
 */
function scheduleGen(cwd: string): void {
  state.pendingRun = true

  // Clear any existing debounce
  if (state.currentProcess) {
    clearTimeout(state.currentProcess)
  }

  // Set debounce timer
  state.currentProcess = setTimeout(() => {
    state.currentProcess = null

    // If we're already running, just mark pending
    if (state.isRunning) {
      console.log('📝 Change detected (queued for restart)')
      return
    }

    // Run gen
    state.isRunning = true
    state.pendingRun = false

    runGen(cwd)
      .then(() => {
        state.isRunning = false

        // If there were changes while running, restart
        if (state.pendingRun) {
          state.pendingRun = false
          console.log('🔄 Restarting gen due to new changes...')
          scheduleGen(cwd)
        }
      })
      .catch((error) => {
        state.isRunning = false
        console.error('Error during gen:', error)

        // Continue watching even after error
        if (state.pendingRun) {
          state.pendingRun = false
          scheduleGen(cwd)
        }
      })
  }, DEBOUNCE_MS) as unknown as NodeJS.Timeout
}

/**
 * Watch *.api.ts files and regenerate on changes
 */
export function watch(cwd: string): void {
  console.log('👁️  Watching for *.api.ts changes...')
  console.log(`📁 Watching: ${cwd}`)
  console.log('⌛ Press Ctrl+C to stop')
  console.log('')

  // Watch for .api.ts files
  const watcher = chokidar.watch('**/*.api.ts', {
    cwd,
    ignored: /node_modules/,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  })

  watcher.on('change', (filePath: string) => {
    const fullPath = path.join(cwd, filePath)
    console.log(`📝 Changed: ${filePath}`)
    scheduleGen(cwd)
  })

  watcher.on('add', (filePath: string) => {
    console.log(`➕ Added: ${filePath}`)
    scheduleGen(cwd)
  })

  watcher.on('unlink', (filePath: string) => {
    console.log(`🗑️  Deleted: ${filePath}`)
    scheduleGen(cwd)
  })

  watcher.on('error', (error) => {
    console.error('❌ Watcher error:', error)
  })

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n👋 Stopping watcher...')
    watcher.close()

    if (state.currentProcess) {
      clearTimeout(state.currentProcess)
    }

    process.exit(0)
  })
}
