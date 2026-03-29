/**
 * Initialize plat guidance in user's project
 * Injects/upserts AGENTS.md and CLAUDE.md
 */

import fs from 'fs'
import path from 'path'

const AGENTS_TEMPLATE = `# AGENTS.md - Guide for AI Developers

**This file is for Claude and other AI agents working on this plat project.**

## Quick Reference

- **Never duplicate types** - Use Zod schemas, reference with \`typeof Schema\`
- **Always use generated client** - Never fetch() directly
- **Always use RouteContext** - Never req.user, use ctx.auth
- **Controllers are abstract** - Implementations extend and implement
- **Run gen after changes** - \`npm run gen\`

## Zero Tolerance Rules

❌ Don't import types between server/client - One schema, two places
❌ Don't make fetch calls - Use generated \`createClientProxy()\`
❌ Don't use req.X - Everything comes from ctx
❌ Don't add validation twice - Zod does it all
❌ Don't define types twice - Define in Zod once

## The Pattern

1. **api.ts**: Define abstract @Controller with Zod schemas
2. **controllers.ts**: Implement handlers, use ctx for everything
3. **npm run gen**: Generate client, OpenAPI, CLI
4. **Use everywhere**: Generated client is your API

## See Full Guide

For comprehensive guidance, read:
- \`node_modules/plat/AGENTS.md\` - Complete AI guide
- \`node_modules/plat/PATTERNS.md\` - Every pattern with examples

## Ask Before Deviating

If you're about to:
- Create a custom HTTP client
- Define types outside Zod
- Use fetch() directly
- Pass data through middleware

**STOP.** These are anti-patterns. Check AGENTS.md.
`

const CLAUDE_TEMPLATE = `# CLAUDE.md - plat Framework Guidance

This project uses plat. When you work on APIs, follow these rules.

## Immediate Rules

1. **Schemas first** - Define in \`api.ts\` with Zod
2. **Abstract controllers** - Methods are contracts
3. **Run code gen** - \`npm run gen\` after API changes
4. **Use generated client** - Not fetch()
5. **Context not req** - \`ctx.auth\`, \`ctx.cache\`, \`ctx.rateLimit\`

## If You're About to Write Code

### Adding an endpoint?
1. Add abstract method to @Controller in api.ts
2. Implement in controller
3. Run \`npm run gen\`
4. Tests use generated client

### Using authentication?
- \`{ auth: 'jwt' }\` in route options
- Access via \`ctx.auth?.user\`
- NOT \`req.user\`

### Using cache?
- Add \`cache: { key: ':route', ttl: 300 }\`
- Check \`ctx.cache?.hit\` in handler
- Response cached automatically

### Making client calls?
- Only use \`createClientProxy(YourApi, { baseUrl, token })\`
- NOT fetch(), axios, or custom clients
- Generated client handles serialization, validation

## See These Files

- \`api.ts\` - All controllers and schemas (source of truth)
- \`controllers.ts\` - Handler implementations
- \`node_modules/plat/AGENTS.md\` - Full AI guide
- \`node_modules/plat/PATTERNS.md\` - Copy-paste patterns

## Emergency Check

Before commit, verify:
- [ ] No \`fetch()\` calls in app code
- [ ] No type definitions outside Zod schemas
- [ ] All data passing through function params or ctx
- [ ] Client uses generated proxy
- [ ] \`npm run gen\` has been run
`

/**
 * Inject or upsert guidance files into user's project
 */
export function initProject(cwd: string): void {
  try {
    const agentsPath = path.join(cwd, 'AGENTS.md')
    const claudePath = path.join(cwd, 'CLAUDE.md')

    // Write AGENTS.md
    if (fs.existsSync(agentsPath)) {
      console.log('📄 AGENTS.md already exists (not overwriting)')
    } else {
      fs.writeFileSync(agentsPath, AGENTS_TEMPLATE)
      console.log('✅ Created AGENTS.md')
    }

    // Write CLAUDE.md
    if (fs.existsSync(claudePath)) {
      console.log('📄 CLAUDE.md already exists (not overwriting)')
    } else {
      fs.writeFileSync(claudePath, CLAUDE_TEMPLATE)
      console.log('✅ Created CLAUDE.md')
    }

    console.log('')
    console.log('🤖 AI Agent Guidance Installed')
    console.log('')
    console.log('These files help Claude and other AI understand plat:')
    console.log('  - AGENTS.md    - Complete AI developer guide')
    console.log('  - CLAUDE.md    - This project\'s plat patterns')
    console.log('')
    console.log('Claude will read these automatically in future sessions.')
    console.log('')

    // Also initialize .env
    console.log('Setting up environment...')
    const { envUpsert } = require('./env')
    envUpsert(cwd)
  } catch (error: any) {
    console.error('❌ Error initializing project:', error.message)
    process.exit(1)
  }
}
