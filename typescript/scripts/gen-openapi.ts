/**
 * Generate OpenAPI 3.0 specification from server decorators and Zod schemas
 *
 * Reads @Controller and @GET/@POST/@DELETE decorated methods from server/**\/*.api.ts,
 * extracts the Zod input/output schemas, and generates a complete OpenAPI spec.
 *
 * Usage: npm run gen:openapi (from plat root directory)
 */

import path from 'node:path'
import globPkg from 'glob'
import { Project, Node, type MethodDeclaration, type ClassDeclaration } from 'ts-morph'
import { getArgValue, getFirstPositionalArg, writeOpenAPISpec } from './openapi-common.js'

const globSync = globPkg.sync

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface RouteInfo {
  method: HttpMethod
  path: string
  summary?: string
  description?: string
  tag?: string
  basePath: string
  fullPath: string
  controllerClass: ClassDeclaration
  methodNode: MethodDeclaration
  inputSchemaName: string
  outputSchemaName: string
}

const HTTP_DECORATORS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export async function generateOpenAPISpecFromGlob(
  srcGlob: string,
  projectRoot = process.cwd(),
): Promise<{ doc: Record<string, unknown>; routes: RouteInfo[] }> {
  const project = new Project({
    tsConfigFilePath: path.join(projectRoot, 'tsconfig.json'),
  })

  const matchedPaths = globSync(srcGlob, {
    cwd: projectRoot,
    absolute: true,
    ignore: ['**/node_modules/**'],
  })
  const sourceFiles = matchedPaths
    .map((filePath) => project.addSourceFileAtPathIfExists(filePath))
    .filter((file): file is NonNullable<typeof file> => Boolean(file))

  if (sourceFiles.length === 0) {
    console.error(`❌ No *.api.ts files found for glob: ${srcGlob}`)
    process.exit(1)
  }

  console.log(`🔍 Found ${sourceFiles.length} API file(s)\n`)

  const routes: RouteInfo[] = []

  // First pass: extract route information
  for (const sf of sourceFiles) {
    for (const cls of sf.getClasses()) {
      const controllerDec = cls.getDecorators().find((d) => d.getName() === 'Controller')
      if (!controllerDec) continue

      const basePath = extractControllerBasePath(controllerDec)
      const tagArg = controllerDec.getArguments()[1]
      const tag =
        tagArg && Node.isObjectLiteralExpression(tagArg) ? extractTag(tagArg) : undefined

      console.log(`📝 Processing: ${cls.getName()}`)

      for (const method of cls.getMethods()) {
        const routeDec = method
          .getDecorators()
          .find((d) => HTTP_DECORATORS.has(d.getName() as HttpMethod))

        if (!routeDec) continue

        const httpMethod = routeDec.getName() as HttpMethod
        const routePath = extractRoutePath(routeDec, method)
        const fullPath = joinPaths(basePath, routePath)
        const docs = extractJSDoc(method)

        const inputSchemaName = extractInputSchemaName(method)
        const outputSchemaName = extractOutputSchemaName(method)

        if (!inputSchemaName) {
          console.warn(`  ⚠️  ${method.getName()}: missing input schema`)
          continue
        }
        if (!outputSchemaName) {
          console.warn(`  ⚠️  ${method.getName()}: missing output schema`)
          continue
        }

        routes.push({
          method: httpMethod,
          path: routePath,
          summary: docs.summary,
          description: docs.description,
          tag,
          basePath,
          fullPath,
          controllerClass: cls,
          methodNode: method,
          inputSchemaName,
          outputSchemaName,
        })

        console.log(
          `   ✓ ${httpMethod} ${fullPath}${docs.summary ? ` - ${docs.summary}` : ''}`,
        )
      }
    }
  }

  // Generate OpenAPI spec as JSON manually
  console.log(`\n✨ Generating OpenAPI spec...`)

  const paths: Record<string, any> = {}

  for (const route of routes) {
    const openApiPath = convertToOpenAPIPath(route.fullPath)

    if (!paths[openApiPath]) {
      paths[openApiPath] = {}
    }

    const method = route.method.toLowerCase()
    const pathParams = extractPathParams(openApiPath)

    paths[openApiPath][method] = {
      summary: route.summary,
      description: route.description,
      tags: route.tag ? [route.tag] : undefined,
      operationId: generateOperationId(route),
      ...(pathParams && { parameters: pathParams }),
      ...(route.method !== 'GET' &&
        route.method !== 'DELETE' && {
          requestBody: {
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        }),
      responses: {
        200: {
          description: 'Success',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    }
  }

  const doc = {
    openapi: '3.0.0',
    info: {
      title: 'API',
      version: '1.0.0',
    },
    servers: [{ url: 'http://localhost:3000' }],
    paths,
  }

  return { doc, routes }
}

async function main() {
  const args = process.argv.slice(2)
  const projectRoot = process.cwd()
  const srcGlob = getArgValue(args, '--src') ?? getFirstPositionalArg(args) ?? '**/*.api.ts'
  const dst = getArgValue(args, '--dst') ?? 'openapi.json'

  const { doc, routes } = await generateOpenAPISpecFromGlob(srcGlob, projectRoot)
  const outFile = path.resolve(projectRoot, dst)
  await writeOpenAPISpec(doc, outFile)

  console.log(`✅ Generated ${outFile} with ${routes.length} endpoint(s)`)
}

function extractPathParams(path: string): any {
  const names = [...path.matchAll(/{(\w+)}/g)].map((x) => x[1])
  if (names.length === 0) return undefined

  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))
}

function generateOperationId(route: RouteInfo): string {
  return route.methodNode.getName()
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function convertToOpenAPIPath(path: string): string {
  // Convert :id to {id} format
  return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}')
}

function extractStringArg(decorator: any, index: number): string {
  const arg = decorator.getArguments()[index]
  if (!arg) throw new Error(`Missing argument at index ${index}`)

  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.getLiteralText()
  }

  throw new Error(`Expected string literal, got: ${arg.getText()}`)
}

function extractControllerBasePath(decorator: any): string {
  const arg = decorator.getArguments()[0]
  if (!arg) return ''
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.getLiteralText().startsWith('/') ? arg.getLiteralText() : ''
  }
  return ''
}

function extractRoutePath(decorator: any, method: MethodDeclaration): string {
  const arg = decorator.getArguments()[0]
  if (!arg) {
    return `/${method.getName()}`
  }
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.getLiteralText()
  }
  if (Node.isObjectLiteralExpression(arg)) {
    return `/${method.getName()}`
  }
  throw new Error(`Unsupported route decorator argument: ${arg.getText()}`)
}

function extractTag(objLit: any): string | undefined {
  const prop = objLit.getProperty('tag')
  if (!prop || !Node.isPropertyAssignment(prop)) return undefined

  const init = prop.getInitializer()
  if (!init) return undefined

  if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) {
    return init.getLiteralText()
  }

  return undefined
}

function extractJSDoc(method: MethodDeclaration): { summary?: string; description?: string } {
  const docs = method.getJsDocs()
  if (docs.length === 0) return {}

  const raw = docs[0].getDescription().trim()
  if (!raw) return {}

  const lines = raw
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

  if (lines.length === 0) return {}

  return {
    summary: lines[0],
    description: lines.slice(1).join('\n') || undefined,
  }
}

function extractInputSchemaName(method: MethodDeclaration): string | undefined {
  const params = method.getParameters()
  if (params.length < 1) return undefined

  // Get the text of the first parameter which may include type annotation
  const paramText = params[0].getText()

  // Try to match Out<typeof SchemaName> pattern anywhere in the parameter
  const match = paramText.match(/Out<typeof\s+(\w+)>/);
  if (match) {
    return match[1]
  }

  // Fallback: try with getTypeNode
  const typeNode = params[0].getTypeNode()
  if (typeNode) {
    return extractSchemaName(typeNode)
  }

  return undefined
}

function extractOutputSchemaName(method: MethodDeclaration): string | undefined {
  const returnType = method.getReturnTypeNode()
  if (!returnType) return undefined

  // Get text of return type and try to match Out<typeof ...> pattern
  const returnText = returnType.getText()

  // Match Out<typeof SchemaName> pattern
  const match = returnText.match(/Out<typeof\s+(\w+)>/)
  if (match) {
    return match[1]
  }

  // Handle empty object/void returns like Promise<{}> or Promise<void>
  if (returnText.includes('Promise<{}') || returnText.includes('Promise<void>')) {
    return '__empty__' // Dummy return to indicate schema found
  }

  // Fallback to ts-morph parsing
  if (!Node.isTypeReference(returnType)) return undefined
  if (returnType.getTypeName().getText() !== 'Promise') return undefined

  const typeArgs = returnType.getTypeArguments()
  if (typeArgs.length !== 1) return undefined

  return extractSchemaName(typeArgs[0])
}

function extractSchemaName(typeNode: any): string | undefined {
  if (!Node.isTypeReference(typeNode)) return undefined

  const typeName = typeNode.getTypeName().getText()
  if (!['Out', 'In', 'Input', 'Output', 'z.output', 'z.input'].includes(typeName)) {
    return undefined
  }

  const typeArgs = typeNode.getTypeArguments()
  if (typeArgs.length !== 1) return undefined

  const arg = typeArgs[0]
  if (arg.getKind() !== 300) return undefined // 300 = TypeQuery

  const exprName = (arg as any).getExprName?.()
  return exprName?.getText?.()
}

function joinPaths(a: string, b: string): string {
  const left = a.endsWith('/') ? a.slice(0, -1) : a
  const right = b.startsWith('/') ? b : `/${b}`
  return `${left}${right}` || '/'
}

main().catch((err) => {
  console.error('❌ Generation failed:', err.message)
  console.error(err.stack)
  process.exit(1)
})
