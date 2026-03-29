
/**
 * Type coercion for incoming data (query strings, form data, etc.)
 *
 * Handles: string→number, string→boolean, string→Date, trim strings.
 * Called before validation so that "42" passes an integer schema.
 */

// ── date helpers (kept from dateCoerce.ts) ──────────────────

const startOfDay = (d: Date) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c }
const isValidDate = (v: unknown): v is Date => v instanceof Date && !Number.isNaN((v as Date).getTime())
const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms)

const addMonths = (d: Date, months: number) => {
    const c = new Date(d); c.setMonth(c.getMonth() + months); return c
}
const addYears = (d: Date, years: number) => {
    const c = new Date(d); c.setFullYear(c.getFullYear() + years); return c
}

const RELATIVE_RE =
    /^(\d+)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|yr|year|years)(?:\s+ago)?$/i

export function parseRelativeDate(input: string, now = new Date()): Date | null {
    const s = input.trim().toLowerCase()

    if (s === 'now' || s === 'today') return new Date(now)
    if (s === 'yesterday') return addMs(now, -86_400_000)
    if (s === 'tomorrow') return addMs(now, 86_400_000)

    const match = s.match(RELATIVE_RE)
    if (!match) return null

    const amount = Number(match[1])
    const unit = match[2]
    const sign = s.includes('ago') ? -1 : 1

    const MS: Record<string, number> = {
        ms: 1, millisecond: 1, milliseconds: 1,
        s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
        m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
        h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
        d: 86_400_000, day: 86_400_000, days: 86_400_000,
        w: 604_800_000, week: 604_800_000, weeks: 604_800_000,
    }

    if (unit in MS) return addMs(now, sign * amount * MS[unit])
    if (/^(mo|month|months)$/.test(unit)) return addMonths(now, sign * amount)
    if (/^(y|yr|year|years)$/.test(unit)) return addYears(now, sign * amount)
    return null
}

export function parseDateish(
    value: unknown,
    now = new Date(),
    dateOnly = false,
): Date | null {
    if (value instanceof Date) {
        return isValidDate(value) ? (dateOnly ? startOfDay(value) : new Date(value)) : null
    }
    if (typeof value === 'number') {
        const d = new Date(value)
        return isValidDate(d) ? (dateOnly ? startOfDay(d) : d) : null
    }
    if (typeof value !== 'string') return null
    const s = value.trim()
    if (!s) return null

    const rel = parseRelativeDate(s, now)
    if (rel) return dateOnly ? startOfDay(rel) : rel

    const abs = new Date(s)
    return isValidDate(abs) ? (dateOnly ? startOfDay(abs) : abs) : null
}

// ── generic coercion ────────────────────────────────────────

export interface JsonSchema {
    type?: string
    format?: string
    coerce?: string
    properties?: Record<string, JsonSchema>
    items?: JsonSchema
    [key: string]: unknown
}

// ── custom coerce registry ───────────────────────────────────

export type CoerceFn = (value: unknown) => unknown

const customCoercers = new Map<string, CoerceFn>()

/** Register a custom coercion function, usable via `// coerce: name` in types. */
export function registerCoerce(name: string, fn: CoerceFn) {
    customCoercers.set(name, fn)
}

/**
 * Decorator that registers a function as a custom coercer.
 * The function name becomes the coerce key.
 *
 *   @Coerce
 *   function slug(v: unknown) {
 *       return String(v).trim().toLowerCase().replace(/\s+/g, '-')
 *   }
 *
 * Then use in types:
 *   type Post = { url: string } // coerce: slug
 */
export function Coerce(target: CoerceFn, context?: { name?: string }): void
export function Coerce(target: any, propertyKey?: string, descriptor?: PropertyDescriptor): void
export function Coerce(target: any, contextOrKey?: any, descriptor?: any): void {
    if (typeof target === 'function' && (contextOrKey === undefined || typeof contextOrKey === 'object')) {
        // TC39 / standalone function decorator: @Coerce function slug() {}
        const name = contextOrKey?.name ?? target.name
        if (name) customCoercers.set(name, target)
    } else if (descriptor && typeof descriptor.value === 'function') {
        // legacy method decorator: class Foo { @Coerce slug(v) {} }
        const name = String(contextOrKey)
        customCoercers.set(name, descriptor.value)
    }
}

/**
 * Coerce a value to match the expected schema type.
 * Mutates objects in-place for performance.
 *
 * Coercion modes (set via comment or generic: coerce: <mode>):
 *   false    — no coercion
 *   trim     — trim whitespace (default for strings)
 *   lower    — trim + lowercase
 *   upper    — trim + uppercase
 *   number   — string → number (default for number/integer types)
 *   int      — string → integer (floors)
 *   bool     — string/number → boolean (default for boolean type)
 *   date     — string/number → ISO date string
 *   datetime — string/number → ISO datetime string
 *   json     — JSON.parse string → object/array
 *   split    — comma-separated string → array
 */
export function coerce(value: unknown, schema: JsonSchema): unknown {
    if (value === undefined || value === null) return value

    // explicit coerce mode takes priority
    if (schema.coerce !== undefined) {
        if (schema.coerce === 'false' || schema.coerce === false) return value
        return applyCoerce(value, String(schema.coerce))
    }

    // default coercion by type
    switch (schema.type) {
        case 'string':
            return coerceTrim(value)
        case 'number':
        case 'integer':
            return coerceNumber(value)
        case 'boolean':
            return coerceBoolean(value)
        case 'object':
            return coerceObject(value, schema)
        case 'array':
            return coerceArray(value, schema)
        default:
            return value
    }
}

function applyCoerce(value: unknown, mode: string): unknown {
    switch (mode) {
        case 'trim':    return coerceTrim(value)
        case 'lower':   return coerceLower(value)
        case 'upper':   return coerceUpper(value)
        case 'number':  return coerceNumber(value)
        case 'int':     return coerceInt(value)
        case 'bool':    return coerceBoolean(value)
        case 'date':
        case 'datetime': {
            const d = parseDateish(value, new Date(), mode === 'date')
            return d ? d.toISOString() : value
        }
        case 'json':    return coerceJson(value)
        case 'split':   return coerceSplit(value)
        default: {
            const custom = customCoercers.get(mode)
            return custom ? custom(value) : value
        }
    }
}

function coerceTrim(value: unknown): unknown {
    if (typeof value !== 'string') return String(value)
    return value.trim()
}

function coerceLower(value: unknown): unknown {
    if (typeof value !== 'string') return String(value).toLowerCase()
    return value.trim().toLowerCase()
}

function coerceUpper(value: unknown): unknown {
    if (typeof value !== 'string') return String(value).toUpperCase()
    return value.trim().toUpperCase()
}

function coerceNumber(value: unknown): unknown {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
        const n = Number(value)
        if (!Number.isNaN(n) && value.trim() !== '') return n
    }
    return value
}

function coerceInt(value: unknown): unknown {
    const n = coerceNumber(value)
    return typeof n === 'number' ? Math.floor(n) : n
}

const TRUTHY = new Set(['true', '1', 'yes', 'y', 'on'])
const FALSY  = new Set(['false', '0', 'no', 'n', 'off', ''])

function coerceBoolean(value: unknown): unknown {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') {
        const s = value.trim().toLowerCase()
        if (TRUTHY.has(s)) return true
        if (FALSY.has(s)) return false
    }
    return value
}

function coerceJson(value: unknown): unknown {
    if (typeof value !== 'string') return value
    try { return JSON.parse(value) } catch { return value }
}

function coerceSplit(value: unknown): unknown {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string') return value
    return value.split(',').map(s => s.trim()).filter(Boolean)
}

function coerceObject(value: unknown, schema: JsonSchema): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
    if (!schema.properties) return value

    const obj = value as Record<string, unknown>
    for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
            obj[key] = coerce(obj[key], propSchema)
        }
    }
    return obj
}

function coerceArray(value: unknown, schema: JsonSchema): unknown {
    if (!Array.isArray(value) || !schema.items) return value
    for (let i = 0; i < value.length; i++) {
        value[i] = coerce(value[i], schema.items)
    }
    return value
}