/**
 * Generate JSON Schema from plain TypeScript types + inline comments.
 *
 * Reads type aliases and interface/type object shapes, maps TS primitives
 * to JSON Schema types, and parses inline comments for constraints.
 *
 * Usage: tsx scripts/gen-schema.ts <file.ts> [--out <dir>]
 */

import { Project, Node, SyntaxKind, type TypeAliasDeclaration, type InterfaceDeclaration, type PropertySignature, type Type, type EnumDeclaration } from 'ts-morph'
import fs from 'node:fs/promises'
import path from 'node:path'

// ── comment constraint parser ───────────────────────────────

interface Constraints {
    [key: string]: string | number | boolean
}

function parseConstraints(comment: string): Constraints {
    const out: Constraints = {}
    // strip leading // and trim
    const raw = comment.replace(/^\/\/\s*/, '').trim()
    if (!raw) return out

    // extract examples before splitting — everything after "examples:" to end of comment
    const exMatch = raw.match(/\bexamples?\s*:\s*(.+)$/i)
    if (exMatch) {
        out._examples = exMatch[1].trim()
    }

    // strip the examples portion so it doesn't interfere with normal parsing
    const clean = exMatch ? raw.slice(0, exMatch.index).replace(/,\s*$/, '').trim() : raw

    for (const part of clean.split(',')) {
        const m = part.trim().match(/^(\w+)\s*:\s*(.+)$/)
        if (!m) continue
        const key = m[1]
        const val = m[2].trim()
        if (val === 'true') out[key] = true
        else if (val === 'false') out[key] = false
        else if (/^-?\d+(\.\d+)?$/.test(val)) out[key] = Number(val)
        else out[key] = val
    }
    return out
}

// ── map constraint keys to JSON Schema keys per base type ───

function applyConstraints(schema: Record<string, any>, constraints: Constraints, baseType: string) {
    for (const [key, val] of Object.entries(constraints)) {
        switch (key) {
            case 'min':
                schema[baseType === 'string' ? 'minLength' : 'minimum'] = val
                break
            case 'max':
                schema[baseType === 'string' ? 'maxLength' : 'maximum'] = val
                break
            case 'format':
                schema.format = val
                break
            case 'pattern': {
                // auto-wrap with ^...$ if not already anchored
                let p = String(val)
                if (!p.startsWith('^')) p = '^' + p
                if (!p.endsWith('$')) p = p + '$'
                schema.pattern = p
                break
            }
            case 'grep': {
                // unanchored — matches anywhere in the string
                schema.pattern = String(val)
                break
            }
            case 'like':
            case 'ilike': {
                // convert postgres LIKE syntax to regex
                // % → .*, _ → ., escape everything else
                let p = String(val)
                    .replace(/([.+?^${}()|[\]\\])/g, '\\$1')  // escape regex specials
                    .replace(/%/g, '.*')
                    .replace(/_/g, '.')
                if (!p.startsWith('.*')) p = '^' + p
                if (!p.endsWith('.*')) p = p + '$'
                schema.pattern = p
                if (key === 'ilike') schema.patternFlags = 'i'
                break
            }
            case 'int':
                if (val) schema.type = 'integer'
                break
            case 'multipleOf':
                schema.multipleOf = val
                break
            case 'minItems':
                schema.minItems = val
                break
            case 'maxItems':
                schema.maxItems = val
                break
            case '_examples': {
                // comma-separated examples → JSON Schema examples array
                const items = String(val).split(',').map(s => s.trim()).filter(Boolean)
                schema.examples = items.map(s => {
                    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
                    if (s === 'true') return true
                    if (s === 'false') return false
                    return s
                })
                break
            }
            default:
                schema[key] = val
        }
    }
}

// ── resolve a type alias chain to its base + merged constraints ──

interface Resolved {
    baseType: string
    constraints: Constraints
}

function resolveAlias(name: string, aliasMap: Map<string, { base: string; constraints: Constraints }>): Resolved {
    // collect constraints from leaf to root, then merge root-first
    // so child constraints override parent constraints
    const chain: Constraints[] = []
    let current = name

    const seen = new Set<string>()
    while (aliasMap.has(current) && !seen.has(current)) {
        seen.add(current)
        const entry = aliasMap.get(current)!
        chain.push(entry.constraints)
        current = entry.base
    }

    const merged: Constraints = {}
    // apply root-first so leaves win
    for (let i = chain.length - 1; i >= 0; i--) {
        Object.assign(merged, chain[i])
    }

    return { baseType: current, constraints: merged }
}

// ── parse a generic arg literal ──────────────────────────────

function parseLiteralArg(arg: string): string | number | boolean | undefined {
    // numeric: 42, 3.14, -1
    if (/^-?\d+(\.\d+)?$/.test(arg)) return Number(arg)
    // string literal: 'foo' or "foo"
    const strMatch = arg.match(/^['"](.*)['"]$/)
    if (strMatch) return strMatch[1]
    // boolean
    if (arg === 'true') return true
    if (arg === 'false') return false
    // not a literal (forwarded type param like 'max') — skip
    return undefined
}

// ── parse generic type references ────────────────────────────

function parseGenericType(text: string): { baseName: string; args: string[] } {
    const match = text.match(/^([a-zA-Z_]\w*)<(.+)>$/)
    if (!match) return { baseName: text, args: [] }

    const baseName = match[1]
    // split args respecting nested generics
    const args: string[] = []
    let depth = 0
    let current = ''
    for (const ch of match[2]) {
        if (ch === '<') depth++
        else if (ch === '>') depth--
        if (ch === ',' && depth === 0) {
            args.push(current.trim())
            current = ''
        } else {
            current += ch
        }
    }
    if (current.trim()) args.push(current.trim())

    return { baseName, args }
}

// ── map TS primitive names to JSON Schema types ─────────────

function tsToJsonSchemaType(tsType: string): string | undefined {
    switch (tsType) {
        case 'string': return 'string'
        case 'number': return 'number'
        case 'boolean': return 'boolean'
        default: return undefined
    }
}

// ── generic param tracking ───────────────────────────────────

// Maps alias name → ordered param names, e.g. 'int' → ['min', 'max']
const aliasParams = new Map<string, string[]>()

// ── collect a type alias into the alias map ─────────────────

function collectAlias(decl: TypeAliasDeclaration, aliasMap: Map<string, { base: string; constraints: Constraints }>) {
    const name = decl.getName()
    const typeNode = decl.getTypeNode()
    if (!typeNode) return

    // record generic param names: type int<min, max> → ['min', 'max']
    const typeParams = decl.getTypeParameters()
    if (typeParams.length > 0) {
        aliasParams.set(name, typeParams.map(p => p.getName()))
    }

    // get the RHS type text, e.g. for `type pint<max> = int<1, max>` → 'int<1,max>'
    const rawTypeText = typeNode.getText().replace(/\s/g, '')

    // parse generic args on the RHS: int<1, max> → base='int', args=['1', 'max']
    const { baseName: rhsBase, args: rhsArgs } = parseGenericType(rawTypeText)
    const jsonType = tsToJsonSchemaType(rhsBase)

    if (jsonType || aliasMap.has(rhsBase)) {
        const comment = getTypeAliasComment(decl)
        const constraints = comment ? parseConstraints(comment) : {}

        // if RHS has generic args, resolve literals as constraint overrides
        if (rhsArgs.length > 0) {
            const parentParams = aliasParams.get(rhsBase)
            if (parentParams) {
                for (let i = 0; i < rhsArgs.length && i < parentParams.length; i++) {
                    const val = parseLiteralArg(rhsArgs[i])
                    if (val !== undefined) {
                        constraints[parentParams[i]] = val
                    }
                }
            }
        }

        aliasMap.set(name, { base: rhsBase, constraints })
    }
}

// ── get trailing comment on same line as a node ─────────────

function getTrailingComment(node: Node): string {
    const ranges = node.getTrailingCommentRanges()
    if (ranges.length === 0) return ''
    return ranges[0].getText()
}

function getTypeAliasComment(decl: TypeAliasDeclaration): string {
    // check trailing comment on the whole declaration
    const trailing = getTrailingComment(decl)
    if (trailing) return trailing

    // check trailing comment on the type node itself
    const typeNode = decl.getTypeNode()
    if (typeNode) {
        const t = getTrailingComment(typeNode)
        if (t) return t
    }
    return ''
}

// ── build schema for a single property ──────────────────────

function propertySchema(
    prop: PropertySignature,
    aliasMap: Map<string, { base: string; constraints: Constraints }>,
): Record<string, any> | null {
    const typeNode = prop.getTypeNode()
    if (!typeNode) return null

    const typeName = typeNode.getText().replace(/\s/g, '')

    // handle arrays: Type[] or Array<Type>
    const arrayMatch = typeName.match(/^(.+)\[\]$/) || typeName.match(/^Array<(.+)>$/)
    if (arrayMatch) {
        const inner = arrayMatch[1]
        const itemSchema = resolveScalar(inner, aliasMap)
        const schema: Record<string, any> = { type: 'array', items: itemSchema }
        const comment = getTrailingComment(prop)
        if (comment) applyConstraints(schema, parseConstraints(comment), 'array')
        return schema
    }

    // string literal union: 'a' | 'b' | 'c'
    if (Node.isUnionTypeNode(typeNode)) {
        const members = typeNode.getTypeNodes()
        const literals: (string | number | boolean)[] = []
        let allStrings = true
        let allNumbers = true
        for (const m of members) {
            if (Node.isLiteralTypeNode(m)) {
                const lit = m.getLiteral()
                if (Node.isStringLiteral(lit)) {
                    literals.push(lit.getLiteralValue())
                    allNumbers = false
                } else if (Node.isNumericLiteral(lit)) {
                    literals.push(lit.getLiteralValue())
                    allStrings = false
                } else if (Node.isTrueLiteral(lit) || Node.isFalseLiteral(lit)) {
                    literals.push(Node.isTrueLiteral(lit))
                    allStrings = false
                    allNumbers = false
                } else {
                    break
                }
            } else {
                break
            }
        }
        if (literals.length === members.length && literals.length > 0) {
            const schema: Record<string, any> = { enum: literals }
            if (allStrings) schema.type = 'string'
            else if (allNumbers) schema.type = 'number'
            const comment = getTrailingComment(prop)
            if (comment) applyConstraints(schema, parseConstraints(comment), schema.type ?? 'string')
            return schema
        }
    }

    // TS enum reference
    const propType = prop.getType()
    if (propType.isEnum() || propType.isEnumLiteral()) {
        const enumMembers = propType.isEnum()
            ? propType.getUnionTypes()
            : [propType]
        const values = enumMembers.map(t => t.getLiteralValue()).filter(v => v !== undefined)
        if (values.length > 0) {
            const allStr = values.every(v => typeof v === 'string')
            const allNum = values.every(v => typeof v === 'number')
            const schema: Record<string, any> = { enum: values }
            if (allStr) schema.type = 'string'
            else if (allNum) schema.type = 'number'
            const comment = getTrailingComment(prop)
            if (comment) applyConstraints(schema, parseConstraints(comment), schema.type ?? 'string')
            return schema
        }
    }

    // scalar
    const schema = resolveScalar(typeName, aliasMap)
    const comment = getTrailingComment(prop)
    if (comment) {
        applyConstraints(schema, parseConstraints(comment), schema.type)
    }
    return schema
}

function resolveScalar(
    typeName: string,
    aliasMap: Map<string, { base: string; constraints: Constraints }>,
): Record<string, any> {
    const jsonType = tsToJsonSchemaType(typeName)
    if (jsonType) return { type: jsonType }

    // parse generic args: int<0, 100> → baseName='int', args=['0', '100']
    const { baseName, args } = parseGenericType(typeName)

    // resolve alias chain using the base name
    const { baseType, constraints } = resolveAlias(baseName, aliasMap)
    const base = tsToJsonSchemaType(baseType)
    if (!base) return { type: 'object' }

    // apply generic args as constraint overrides
    if (args.length > 0) {
        const params = aliasParams.get(baseName)
        if (params) {
            for (let i = 0; i < args.length && i < params.length; i++) {
                const val = parseLiteralArg(args[i])
                if (val !== undefined) {
                    constraints[params[i]] = val
                }
            }
        }
    }

    const schema: Record<string, any> = { type: base }
    applyConstraints(schema, constraints, base)
    return schema
}

// ── main ────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2)
    if (args.length === 0) {
        console.error('Usage: tsx scripts/gen-schema.ts <file.ts> [--out <dir>]')
        process.exit(1)
    }

    const inputFile = path.resolve(args[0])
    const outIdx = args.indexOf('--out')
    const outDir = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : path.dirname(inputFile)

    const projectRoot = process.cwd()
    const project = new Project({ tsConfigFilePath: path.resolve('tsconfig.json') })
    const sf = project.addSourceFileAtPath(inputFile)

    // ── pass 1: collect all type aliases ────────────────────

    const aliasMap = new Map<string, { base: string; constraints: Constraints }>()

    // collect aliases from scalars.ts (the single source of truth)
    const scalarsPath = path.join(projectRoot, 'src', 'args', 'scalars.ts')
    const scalarsSf = project.addSourceFileAtPath(scalarsPath)
    for (const decl of scalarsSf.getTypeAliases()) {
        collectAlias(decl, aliasMap)
    }

    // collect aliases from the input file (can extend or override)
    for (const decl of sf.getTypeAliases()) {
        collectAlias(decl, aliasMap)
    }

    // ── pass 2: generate JSON Schema for object types ───────

    const objectTypes: Array<{ name: string; decl: TypeAliasDeclaration | InterfaceDeclaration }> = []

    for (const decl of sf.getInterfaces()) {
        objectTypes.push({ name: decl.getName(), decl })
    }

    for (const decl of sf.getTypeAliases()) {
        const typeNode = decl.getTypeNode()
        if (!typeNode) continue
        // only object-shaped type aliases: type Foo = { ... }
        if (Node.isTypeLiteral(typeNode)) {
            objectTypes.push({ name: decl.getName(), decl })
        }
    }

    if (objectTypes.length === 0) {
        console.log('No object types found.')
        return
    }

    await fs.mkdir(outDir, { recursive: true })

    for (const { name, decl } of objectTypes) {
        const props: PropertySignature[] =
            Node.isInterfaceDeclaration(decl)
                ? decl.getProperties()
                : decl.getTypeNode()!.asKindOrThrow(SyntaxKind.TypeLiteral).getProperties()
                    .filter((p): p is PropertySignature => Node.isPropertySignature(p))

        const properties: Record<string, any> = {}
        const required: string[] = []

        for (const prop of props) {
            const propName = prop.getName()
            const schema = propertySchema(prop, aliasMap)
            if (!schema) continue
            properties[propName] = schema
            if (!prop.hasQuestionToken()) {
                required.push(propName)
            }
        }

        const jsonSchema: Record<string, any> = {
            $id: name,
            type: 'object',
            properties,
        }
        if (required.length > 0) jsonSchema.required = required

        const outFile = path.join(outDir, `${name}.schema.json`)
        await fs.writeFile(outFile, JSON.stringify(jsonSchema, null, 2) + '\n')
        console.log(`${name} → ${outFile}`)
    }
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})