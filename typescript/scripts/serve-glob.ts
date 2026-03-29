import path from 'node:path'
import { pathToFileURL } from 'node:url'
import globPkg from 'glob'
import { Project } from 'ts-morph'
import { generateOpenAPISpecFromGlob } from './gen-openapi.js'

const globSync = globPkg.sync

function getArgValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === flag) return args[i + 1]
    if (arg?.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
  }
  return undefined
}

async function main() {
  const args = process.argv.slice(2)
  const projectRoot = process.cwd()
  const srcGlob = getArgValue(args, '--src') ?? '**/*.api.ts'
  const port = Number(getArgValue(args, '--port') ?? 3000)
  const host = getArgValue(args, '--host')
  const cors = parseBooleanFlag(getArgValue(args, '--cors'), true)
  const openapi = parseBooleanFlag(getArgValue(args, '--openapi'), true)

  const project = new Project({
    tsConfigFilePath: path.join(projectRoot, 'tsconfig.json'),
  })

  const files = globSync(srcGlob, {
    cwd: projectRoot,
    absolute: true,
    ignore: ['**/node_modules/**'],
  })
    .map((filePath) => project.addSourceFileAtPathIfExists(filePath))
    .filter((file): file is NonNullable<typeof file> => Boolean(file))

  if (files.length === 0) {
    throw new Error(`No controller files found for glob: ${srcGlob}`)
  }

  const serverModule = await import(pathToFileURL(path.join(projectRoot, 'src/server/index.ts')).href)
  const { createServer } = serverModule as { createServer: (...args: any[]) => any }

  const controllerClasses: Array<new () => any> = []

  for (const file of files) {
    const controllerNames = file.getClasses()
      .filter((cls) => cls.getDecorators().some((decorator) => decorator.getName() === 'Controller'))
      .map((cls) => cls.getName())
      .filter((name): name is string => Boolean(name))

    if (controllerNames.length === 0) continue

    const module = await import(pathToFileURL(file.getFilePath()).href)
    for (const name of controllerNames) {
      const ControllerClass = module[name]
      if (typeof ControllerClass === 'function') {
        controllerClasses.push(ControllerClass as new () => any)
      }
    }
  }

  if (controllerClasses.length === 0) {
    throw new Error(`No @Controller classes found for glob: ${srcGlob}`)
  }

  const openapiDoc = openapi ? (await generateOpenAPISpecFromGlob(srcGlob, projectRoot)).doc : undefined
  const server = createServer({
    port,
    ...(host ? { host } : {}),
    cors,
    ...(openapiDoc ? { openapi: openapiDoc, swagger: true, redoc: true } : {}),
  }, ...controllerClasses)
  server.listen()
}

function parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue
  if (value === '' || value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return defaultValue
}

main().catch((err) => {
  console.error('❌ Serve failed:', err.message)
  process.exit(1)
})
