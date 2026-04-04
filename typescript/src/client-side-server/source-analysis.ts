export interface TypeScriptLike {
  ScriptTarget: { Latest: number }
  ScriptKind: { TS: number }
  SyntaxKind: Record<string, number>
  createSourceFile(fileName: string, sourceText: string, languageVersion: number, setParentNodes?: boolean, scriptKind?: number): any
  forEachChild(node: any, cbNode: (node: any) => void): void
  canHaveDecorators?: (node: any) => boolean
  getDecorators?: (node: any) => readonly any[] | undefined
}

export interface ClientSideServerSourceAnalysis {
  controllers: Array<{
    name: string
    methods: Array<{
      name: string
      summary?: string
      description?: string
      inputSchema?: Record<string, any>
      outputSchema?: Record<string, any>
    }>
  }>
}

export function analyzeClientSideServerSource(
  ts: TypeScriptLike,
  source: string,
  options: {
    undecoratedMode?: 'GET' | 'POST' | 'private'
  } = {},
): ClientSideServerSourceAnalysis {
  const sourceFile = ts.createSourceFile('client-side-server.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const interfaces = new Map<string, any>()
  const typeAliases = new Map<string, any>()
  const enums = new Map<string, any>()
  const controllers: ClientSideServerSourceAnalysis['controllers'] = []
  const undecoratedMode = options.undecoratedMode ?? 'POST'

  ts.forEachChild(sourceFile, (node) => {
    if (isKind(ts, node, 'InterfaceDeclaration') && node.name?.text) {
      interfaces.set(node.name.text, node)
      return
    }
    if (isKind(ts, node, 'TypeAliasDeclaration') && node.name?.text) {
      typeAliases.set(node.name.text, node.type)
      return
    }
    if (isKind(ts, node, 'EnumDeclaration') && node.name?.text) {
      enums.set(node.name.text, node)
      return
    }
    if (isKind(ts, node, 'ClassDeclaration') && node.name?.text) {
      controllers.push(analyzeController(ts, node, interfaces, typeAliases, enums, undecoratedMode))
    }
  })

  return { controllers }
}

function analyzeController(
  ts: TypeScriptLike,
  classNode: any,
  interfaces: Map<string, any>,
  typeAliases: Map<string, any>,
  enums: Map<string, any>,
  undecoratedMode: 'GET' | 'POST' | 'private',
): ClientSideServerSourceAnalysis['controllers'][number] {
  const methods = (classNode.members ?? [])
    .filter((member: any) => isMethodExposed(ts, member, undecoratedMode))
    .map((method: any) => analyzeMethod(ts, method, interfaces, typeAliases, enums))

  return {
    name: classNode.name.text,
    methods,
  }
}

function analyzeMethod(
  ts: TypeScriptLike,
  methodNode: any,
  interfaces: Map<string, any>,
  typeAliases: Map<string, any>,
  enums: Map<string, any>,
): ClientSideServerSourceAnalysis['controllers'][number]['methods'][number] {
  const docs = getNodeDoc(ts, methodNode)
  const inputParam = (methodNode.parameters ?? [])[0]
  const inputSchema = inputParam?.type
    ? typeNodeToSchema(ts, inputParam.type, interfaces, typeAliases, enums)
    : undefined

  const explicitReturnType = unwrapPromiseType(ts, methodNode.type)
  const outputSchema = explicitReturnType
    ? typeNodeToSchema(ts, explicitReturnType, interfaces, typeAliases, enums)
    : inferMethodReturnSchema(ts, methodNode, interfaces, typeAliases, enums)

  return {
    name: methodNode.name.getText ? methodNode.name.getText() : methodNode.name.text,
    summary: docs.summary,
    description: docs.description,
    inputSchema: normalizeObjectSchema(inputSchema),
    outputSchema,
  }
}

function isMethodExposed(
  ts: TypeScriptLike,
  member: any,
  undecoratedMode: 'GET' | 'POST' | 'private',
): boolean {
  if (!isKind(ts, member, 'MethodDeclaration')) return false
  const name = member.name?.getText?.() ?? member.name?.text
  if (!name || name === 'constructor' || String(name).startsWith('_')) return false
  return Boolean(getHttpDecorator(ts, member)) || undecoratedMode !== 'private'
}

function getNodeDoc(
  _ts: TypeScriptLike,
  node: any,
): { summary?: string; description?: string } {
  const blocks = Array.isArray(node?.jsDoc) ? node.jsDoc : []
  if (blocks.length === 0) return {}

  const raw = blocks
    .map((block: any) => {
      if (typeof block.comment === 'string') return block.comment
      if (Array.isArray(block.comment)) {
        return block.comment.map((part: any) => part?.text ?? '').join('')
      }
      return ''
    })
    .join('\n')
    .trim()

  if (!raw) return {}

  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((part: string) => part.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) return {}
  return {
    summary: paragraphs[0],
    description: paragraphs.join('\n\n'),
  }
}

function inferMethodReturnSchema(
  ts: TypeScriptLike,
  methodNode: any,
  interfaces: Map<string, any>,
  typeAliases: Map<string, any>,
  enums: Map<string, any>,
): Record<string, any> | undefined {
  if (!methodNode.body) return undefined

  const returns: Record<string, any>[] = []
  walk(ts, methodNode.body, (node) => {
    if (isKind(ts, node, 'ReturnStatement') && node.expression) {
      const schema = expressionToSchema(ts, node.expression, interfaces, typeAliases, enums)
      if (schema) returns.push(schema)
    }
  })

  if (returns.length === 0) return undefined
  if (returns.length === 1) return returns[0]
  return mergeSchemas(returns)
}

function expressionToSchema(
  ts: TypeScriptLike,
  expression: any,
  interfaces: Map<string, any>,
  typeAliases: Map<string, any>,
  enums: Map<string, any>,
): Record<string, any> | undefined {
  if (isKind(ts, expression, 'ObjectLiteralExpression')) {
    const properties: Record<string, any> = {}
    const required: string[] = []

    for (const prop of expression.properties ?? []) {
      if (isKind(ts, prop, 'PropertyAssignment')) {
        const name = propertyNameText(prop.name)
        if (!name) continue
        const schema = expressionToSchema(ts, prop.initializer, interfaces, typeAliases, enums) ?? {}
        properties[name] = schema
        required.push(name)
      }
    }

    return {
      type: 'object',
      properties,
      required,
    }
  }

  if (isKind(ts, expression, 'ArrayLiteralExpression')) {
    const items = (expression.elements ?? [])
      .map((element: any) => expressionToSchema(ts, element, interfaces, typeAliases, enums))
      .filter(Boolean) as Record<string, any>[]
    return {
      type: 'array',
      items: items.length <= 1 ? (items[0] ?? {}) : { oneOf: items },
    }
  }

  if (isKind(ts, expression, 'StringLiteral') || isKind(ts, expression, 'NoSubstitutionTemplateLiteral')) {
    return { type: 'string' }
  }
  if (isKind(ts, expression, 'NumericLiteral')) {
    return { type: 'number' }
  }
  if (isKind(ts, expression, 'TrueKeyword') || isKind(ts, expression, 'FalseKeyword')) {
    return { type: 'boolean' }
  }
  if (isKind(ts, expression, 'AsExpression') || isKind(ts, expression, 'ParenthesizedExpression')) {
    return expressionToSchema(ts, expression.expression, interfaces, typeAliases, enums)
  }

  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return { type: 'null' }
  }

  return undefined
}

function typeNodeToSchema(
  ts: TypeScriptLike,
  typeNode: any,
  interfaces: Map<string, any>,
  typeAliases: Map<string, any>,
  enums: Map<string, any>,
  seen = new Set<string>(),
): Record<string, any> | undefined {
  if (!typeNode) return undefined

  if (isKind(ts, typeNode, 'ParenthesizedType')) {
    return typeNodeToSchema(ts, typeNode.type, interfaces, typeAliases, enums, seen)
  }

  if (isKind(ts, typeNode, 'TypeLiteral')) {
    return membersToObjectSchema(ts, typeNode.members ?? [], interfaces, typeAliases, enums, seen)
  }

  if (isKind(ts, typeNode, 'ArrayType')) {
    return {
      type: 'array',
      items: typeNodeToSchema(ts, typeNode.elementType, interfaces, typeAliases, enums, seen) ?? {},
    }
  }

  if (isKind(ts, typeNode, 'TupleType')) {
    return {
      type: 'array',
      prefixItems: (typeNode.elements ?? []).map((element: any) => typeNodeToSchema(ts, element, interfaces, typeAliases, enums, seen) ?? {}),
    }
  }

  if (isKind(ts, typeNode, 'UnionType')) {
    const memberSchemas = (typeNode.types ?? [])
      .map((member: any) => typeNodeToSchema(ts, member, interfaces, typeAliases, enums, new Set(seen)))
      .filter(Boolean) as Record<string, any>[]

    const literalValues = memberSchemas
      .map((schema) => Object.prototype.hasOwnProperty.call(schema, 'const') ? schema.const : undefined)
      .filter((value) => value !== undefined)

    if (literalValues.length === memberSchemas.length && literalValues.length > 0) {
      return {
        type: typeof literalValues[0] === 'number' ? 'number' : typeof literalValues[0] === 'boolean' ? 'boolean' : 'string',
        enum: literalValues,
      }
    }

    return { oneOf: memberSchemas }
  }

  if (isKind(ts, typeNode, 'LiteralType')) {
    const literal = literalNodeToValue(ts, typeNode.literal)
    if (literal === undefined) return undefined
    return {
      type: typeof literal === 'number' ? 'number' : typeof literal === 'boolean' ? 'boolean' : 'string',
      const: literal,
    }
  }

  if (isKind(ts, typeNode, 'TypeReference')) {
    const typeName = typeNode.typeName?.getText?.() ?? typeNode.typeName?.text
    if (!typeName) return undefined

    if (typeName === 'Promise') {
      return typeNodeToSchema(ts, typeNode.typeArguments?.[0], interfaces, typeAliases, enums, seen)
    }
    if (typeName === 'Array') {
      return {
        type: 'array',
        items: typeNodeToSchema(ts, typeNode.typeArguments?.[0], interfaces, typeAliases, enums, seen) ?? {},
      }
    }
    if (typeName === 'Record') {
      return {
        type: 'object',
        additionalProperties: typeNodeToSchema(ts, typeNode.typeArguments?.[1], interfaces, typeAliases, enums, seen) ?? {},
      }
    }
    if (typeName === 'Date') {
      return { type: 'string', format: 'date-time' }
    }

    if (seen.has(typeName)) {
      return { type: 'object' }
    }
    seen.add(typeName)

    if (interfaces.has(typeName)) {
      const schema = membersToObjectSchema(ts, interfaces.get(typeName).members ?? [], interfaces, typeAliases, enums, seen)
      seen.delete(typeName)
      return schema
    }

    if (typeAliases.has(typeName)) {
      const schema = typeNodeToSchema(ts, typeAliases.get(typeName), interfaces, typeAliases, enums, seen)
      seen.delete(typeName)
      return schema
    }

    if (enums.has(typeName)) {
      const schema = enumToSchema(ts, enums.get(typeName))
      seen.delete(typeName)
      return schema
    }

    seen.delete(typeName)
    return { type: 'object' }
  }

  switch (typeNode.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { type: 'string' }
    case ts.SyntaxKind.NumberKeyword:
      return { type: 'number' }
    case ts.SyntaxKind.BooleanKeyword:
      return { type: 'boolean' }
    case ts.SyntaxKind.NullKeyword:
      return { type: 'null' }
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return {}
    case ts.SyntaxKind.VoidKeyword:
      return undefined
    default:
      return { type: 'object' }
  }
}

function membersToObjectSchema(
  ts: TypeScriptLike,
  members: any[],
  interfaces: Map<string, any>,
  typeAliases: Map<string, any>,
  enums: Map<string, any>,
  seen: Set<string>,
): Record<string, any> {
  const properties: Record<string, any> = {}
  const required: string[] = []

  for (const member of members) {
    if (!isKind(ts, member, 'PropertySignature') && !isKind(ts, member, 'PropertyDeclaration')) {
      continue
    }
    const name = propertyNameText(member.name)
    if (!name) continue
    const schema = typeNodeToSchema(ts, member.type, interfaces, typeAliases, enums, new Set(seen)) ?? {}
    properties[name] = schema
    if (!member.questionToken) {
      required.push(name)
    }
  }

  return {
    type: 'object',
    properties,
    required,
  }
}

function enumToSchema(ts: TypeScriptLike, enumNode: any): Record<string, any> {
  const values = (enumNode.members ?? [])
    .map((member: any) => {
      if (member.initializer) {
        return literalNodeToValue(ts, member.initializer)
      }
      return member.name?.text
    })
    .filter((value: unknown) => value !== undefined)

  return {
    type: values.every((value: unknown) => typeof value === 'number') ? 'number' : 'string',
    enum: values,
  }
}

function unwrapPromiseType(ts: TypeScriptLike, typeNode: any): any {
  if (!typeNode || !isKind(ts, typeNode, 'TypeReference')) return typeNode
  const typeName = typeNode.typeName?.getText?.() ?? typeNode.typeName?.text
  if (typeName === 'Promise' && typeNode.typeArguments?.length) {
    return typeNode.typeArguments[0]
  }
  return typeNode
}

function hasDecorator(ts: TypeScriptLike, node: any, name: string): boolean {
  return getDecorators(ts, node).some((decorator) => decoratorName(decorator) === name)
}

function getHttpDecorator(ts: TypeScriptLike, node: any): string | undefined {
  return getDecorators(ts, node)
    .map((decorator) => decoratorName(decorator))
    .find((name) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(name ?? ''))
}

function getDecorators(ts: TypeScriptLike, node: any): any[] {
  if (typeof ts.canHaveDecorators === 'function' && typeof ts.getDecorators === 'function' && ts.canHaveDecorators(node)) {
    return [...(ts.getDecorators(node) ?? [])]
  }
  return [...(node.decorators ?? [])]
}

function decoratorName(decorator: any): string | undefined {
  const expression = decorator.expression ?? decorator
  if (!expression) return undefined
  if (expression.expression?.text) return expression.expression.text
  if (expression.expression?.getText) return expression.expression.getText()
  if (expression.text) return expression.text
  if (expression.getText) return expression.getText()
  return undefined
}

function propertyNameText(nameNode: any): string | undefined {
  if (!nameNode) return undefined
  if (typeof nameNode.text === 'string') return nameNode.text
  if (typeof nameNode.getText === 'function') {
    return nameNode.getText().replace(/^['"]|['"]$/g, '')
  }
  return undefined
}

function literalNodeToValue(ts: TypeScriptLike, node: any): string | number | boolean | undefined {
  if (!node) return undefined
  if (isKind(ts, node, 'StringLiteral') || isKind(ts, node, 'NoSubstitutionTemplateLiteral')) {
    return node.text
  }
  if (isKind(ts, node, 'NumericLiteral')) {
    return Number(node.text)
  }
  if (isKind(ts, node, 'TrueKeyword')) return true
  if (isKind(ts, node, 'FalseKeyword')) return false
  return undefined
}

function mergeSchemas(schemas: Record<string, any>[]): Record<string, any> {
  if (schemas.every((schema) => schema.type === 'object' && schema.properties)) {
    const properties: Record<string, any> = {}
    const presence = new Map<string, number>()

    for (const schema of schemas) {
      for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {
        properties[name] = propertySchema
        presence.set(name, (presence.get(name) ?? 0) + 1)
      }
    }

    const required = Array.from(presence.entries())
      .filter(([, count]) => count === schemas.length)
      .map(([name]) => name)

    return { type: 'object', properties, required }
  }

  return { oneOf: schemas }
}

function normalizeObjectSchema(schema?: Record<string, any>): Record<string, any> | undefined {
  if (!schema) return undefined
  if (schema.type === 'object') {
    return {
      type: 'object',
      properties: schema.properties ?? {},
      required: schema.required ?? [],
      ...(schema.additionalProperties !== undefined ? { additionalProperties: schema.additionalProperties } : {}),
    }
  }
  return schema
}

function isKind(ts: TypeScriptLike, node: any, kindName: string): boolean {
  return Boolean(node && node.kind === ts.SyntaxKind[kindName])
}

function walk(ts: TypeScriptLike, node: any, visitor: (node: any) => void): void {
  visitor(node)
  ts.forEachChild(node, (child) => walk(ts, child, visitor))
}
