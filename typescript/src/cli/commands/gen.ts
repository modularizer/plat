import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function scriptDir(): string {
  return path.resolve(__dirname, '../../..', 'scripts')
}

function run(script: string, cwd: string, args: string[] = []) {
  const scriptPath = path.join(scriptDir(), script)
  const cmd = `npx tsx "${scriptPath}" ${args.map(a => `"${a}"`).join(' ')}`.trim()
  execSync(cmd, { stdio: 'inherit', cwd })
}

function getOption(argv: string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === flag) return argv[i + 1]
    if (arg?.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
  }
  return undefined
}

function forwardOption(argv: string[], flag: string, out: string[]) {
  const value = getOption(argv, flag)
  if (value) out.push(flag, value)
}

function getFirstPositionalArg(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue
    if (arg.startsWith('--')) {
      if (arg === '--src' || arg === '--dst') i += 1
      continue
    }
    return arg
  }
  return undefined
}

export function runGen(cwd: string, subcommand?: string, argv: string[] = []): void {
  switch (subcommand) {
    case undefined:
    case 'openapi': {
      const args: string[] = []
      forwardOption(argv, '--src', args)
      forwardOption(argv, '--dst', args)
      if (!getOption(argv, '--src')) {
        const positional = getFirstPositionalArg(argv)
        if (positional) args.push(positional)
      }
      run('gen-openapi.ts', cwd, args)
      return
    }
    case 'client': {
      const args: string[] = []
      forwardOption(argv, '--src', args)
      forwardOption(argv, '--dst', args)
      if (!getOption(argv, '--src')) {
        const positional = getFirstPositionalArg(argv)
        if (positional) args.push(positional)
      }
      run('gen-client-openapi.ts', cwd, args)
      return
    }
    case 'cli': {
      const args: string[] = []
      forwardOption(argv, '--src', args)
      forwardOption(argv, '--dst', args)
      if (!getOption(argv, '--src')) {
        const positional = getFirstPositionalArg(argv)
        if (positional) args.push(positional)
      }
      run('gen-cli-openapi.ts', cwd, args)
      return
    }
    default:
      console.error(`Unknown target: ${subcommand}`)
      console.error('Available: openapi, client, cli')
      process.exit(1)
  }
}
