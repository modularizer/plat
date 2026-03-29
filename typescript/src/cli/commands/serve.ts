import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function scriptDir(): string {
  return path.resolve(__dirname, '../../..', 'scripts')
}

export function serveControllers(cwd: string, argv: string[] = []): void {
  const scriptPath = path.join(scriptDir(), 'serve-glob.ts')
  const args: string[] = []
  let sawSrc = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg?.startsWith('--')) continue
    if (['--src', '--port', '--host', '--cors', '--openapi'].includes(arg)) {
      if (arg === '--src') sawSrc = true
      args.push(arg)
      if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) {
        args.push(argv[i + 1]!)
        i += 1
      }
      continue
    }
    if (['--src', '--port', '--host', '--cors', '--openapi'].some((flag) => arg.startsWith(`${flag}=`))) {
      if (arg.startsWith('--src=')) sawSrc = true
      args.push(arg)
    }
  }

  if (!sawSrc) {
    const positional = argv.find((arg) => arg && !arg.startsWith('--'))
    if (positional) args.push('--src', positional)
  }

  execSync(`npx tsx "${scriptPath}" ${args.map((arg) => `"${arg}"`).join(' ')}`.trim(), {
    cwd,
    stdio: 'inherit',
  })
}
