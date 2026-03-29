/**
 * Runtime validation against JSON Schema objects.
 *
 * Lean validator covering the JSON Schema subset that gen-schema.ts produces.
 * Coerces before validating (string→number, string→date, trim, etc.)
 */

import { coerce, type JsonSchema } from './coerce'

export class ValidationError extends Error {
    constructor(public issues: string[]) {
        super(issues.join('; '))
        this.name = 'ValidationError'
    }
}

export type ParseResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: ValidationError }

/** Coerce + validate. Throws on failure. */
export function parse<T = unknown>(schema: JsonSchema, value: unknown): T {
    const data = coerce(structuredClone(value), schema)
    const issues: string[] = []
    validate(data, schema, '', issues)
    if (issues.length > 0) throw new ValidationError(issues)
    return data as T
}

/** Coerce + validate. Returns result object. */
export function safeParse<T = unknown>(schema: JsonSchema, value: unknown): ParseResult<T> {
    try {
        return { ok: true, data: parse<T>(schema, value) }
    } catch (e) {
        if (e instanceof ValidationError) return { ok: false, error: e }
        throw e
    }
}

// ── validate recursively ────────────────────────────────────

function validate(value: unknown, schema: JsonSchema, path: string, issues: string[]) {
    // nullable
    if (value === null || value === undefined) {
        if (schema.nullable) return
        issues.push(`${path || '.'}: required`)
        return
    }

    // oneOf (used for nullable)
    if (schema.oneOf) {
        const sub = (schema.oneOf as JsonSchema[])
        for (const s of sub) {
            const subIssues: string[] = []
            validate(value, s, path, subIssues)
            if (subIssues.length === 0) return
        }
        issues.push(`${path || '.'}: does not match any variant`)
        return
    }

    switch (schema.type) {
        case 'string': return validateString(value, schema, path, issues)
        case 'number': return validateNumber(value, schema, path, issues)
        case 'integer': return validateInteger(value, schema, path, issues)
        case 'boolean': return validateBoolean(value, path, issues)
        case 'object': return validateObject(value, schema, path, issues)
        case 'array': return validateArray(value, schema, path, issues)
    }
}

function validateString(value: unknown, schema: JsonSchema, path: string, issues: string[]) {
    if (typeof value !== 'string') {
        issues.push(`${path || '.'}: expected string, got ${typeof value}`)
        return
    }

    const len = value.length
    if (schema.minLength !== undefined && len < (schema.minLength as number))
        issues.push(`${path || '.'}: string too short (min ${schema.minLength})`)
    if (schema.maxLength !== undefined && len > (schema.maxLength as number))
        issues.push(`${path || '.'}: string too long (max ${schema.maxLength})`)
    if (schema.pattern) {
        const flags = (schema.patternFlags as string) || ''
        if (!new RegExp(schema.pattern as string, flags).test(value))
            issues.push(`${path || '.'}: does not match pattern ${schema.pattern}`)
    }

    if (schema.format) validateFormat(value, schema.format as string, path, issues)

    if (schema.enum && !(schema.enum as unknown[]).includes(value))
        issues.push(`${path || '.'}: must be one of ${(schema.enum as unknown[]).join(', ')}`)
}

function validateFormat(value: string, format: string, path: string, issues: string[]) {
    switch (format) {
        case 'email':
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
                issues.push(`${path || '.'}: invalid email`)
            break
        case 'uri':
            try { new URL(value) } catch {
                issues.push(`${path || '.'}: invalid URL`)
            }
            break
        case 'uuid':
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
                issues.push(`${path || '.'}: invalid UUID`)
            break
        case 'date':
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))
                issues.push(`${path || '.'}: invalid date`)
            break
        case 'date-time':
            if (Number.isNaN(Date.parse(value)))
                issues.push(`${path || '.'}: invalid datetime`)
            break
    }
}

function validateNumber(value: unknown, schema: JsonSchema, path: string, issues: string[]) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        issues.push(`${path || '.'}: expected number, got ${typeof value}`)
        return
    }
    checkNumericConstraints(value, schema, path, issues)
}

function validateInteger(value: unknown, schema: JsonSchema, path: string, issues: string[]) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        issues.push(`${path || '.'}: expected integer, got ${typeof value}`)
        return
    }
    if (!Number.isInteger(value))
        issues.push(`${path || '.'}: expected integer, got float`)
    checkNumericConstraints(value, schema, path, issues)
}

function checkNumericConstraints(value: number, schema: JsonSchema, path: string, issues: string[]) {
    if (schema.minimum !== undefined && value < (schema.minimum as number))
        issues.push(`${path || '.'}: must be >= ${schema.minimum}`)
    if (schema.maximum !== undefined && value > (schema.maximum as number))
        issues.push(`${path || '.'}: must be <= ${schema.maximum}`)
    if (schema.exclusiveMinimum !== undefined && value <= (schema.exclusiveMinimum as number))
        issues.push(`${path || '.'}: must be > ${schema.exclusiveMinimum}`)
    if (schema.exclusiveMaximum !== undefined && value >= (schema.exclusiveMaximum as number))
        issues.push(`${path || '.'}: must be < ${schema.exclusiveMaximum}`)
    if (schema.multipleOf !== undefined && value % (schema.multipleOf as number) !== 0)
        issues.push(`${path || '.'}: must be multiple of ${schema.multipleOf}`)

    if (schema.enum && !(schema.enum as unknown[]).includes(value))
        issues.push(`${path || '.'}: must be one of ${(schema.enum as unknown[]).join(', ')}`)
}

function validateBoolean(value: unknown, path: string, issues: string[]) {
    if (typeof value !== 'boolean')
        issues.push(`${path || '.'}: expected boolean, got ${typeof value}`)
}

function validateObject(value: unknown, schema: JsonSchema, path: string, issues: string[]) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        issues.push(`${path || '.'}: expected object`)
        return
    }

    const obj = value as Record<string, unknown>
    const required = (schema.required as string[]) ?? []

    // check required fields
    for (const key of required) {
        if (!(key in obj) || obj[key] === undefined) {
            issues.push(`${path ? path + '.' : ''}${key}: required`)
        }
    }

    // validate each property
    if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
            if (key in obj && obj[key] !== undefined) {
                validate(obj[key], propSchema, `${path ? path + '.' : ''}${key}`, issues)
            }
        }
    }
}

function validateArray(value: unknown, schema: JsonSchema, path: string, issues: string[]) {
    if (!Array.isArray(value)) {
        issues.push(`${path || '.'}: expected array`)
        return
    }

    if (schema.minItems !== undefined && value.length < (schema.minItems as number))
        issues.push(`${path || '.'}: too few items (min ${schema.minItems})`)
    if (schema.maxItems !== undefined && value.length > (schema.maxItems as number))
        issues.push(`${path || '.'}: too many items (max ${schema.maxItems})`)

    if (schema.items) {
        for (let i = 0; i < value.length; i++) {
            validate(value[i], schema.items, `${path}[${i}]`, issues)
        }
    }
}