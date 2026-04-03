#!/usr/bin/env node
import('../dist/cli/plat.js').catch(err => {
  console.error('Failed to load plat CLI:', err.message)
  process.exit(1)
})
