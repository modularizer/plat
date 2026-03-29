/**
m * Tests for plat parse / safeParse / coerce
 * Validates JSON Schema validation with type coercion
 */

import { parse, safeParse, ValidationError } from './validate'
import type { JsonSchema } from './coerce'

// ── helper schemas ──────────────────────────────────────────

const strSchema = (opts: Partial<JsonSchema> = {}): JsonSchema => ({
    type: 'string', minLength: 1, maxLength: 100, ...opts,
})

const numSchema = (opts: Partial<JsonSchema> = {}): JsonSchema => ({
    type: 'number', ...opts,
})

const intSchema = (opts: Partial<JsonSchema> = {}): JsonSchema => ({
    type: 'integer', ...opts,
})

const boolSchema = (opts: Partial<JsonSchema> = {}): JsonSchema => ({
    type: 'boolean', ...opts,
})

const objSchema = (
    properties: Record<string, JsonSchema>,
    required?: string[],
): JsonSchema => ({
    type: 'object', properties, ...(required ? { required } : {}),
})

describe('parse / safeParse', () => {
    describe('strings', () => {
        it('should validate strings', () => {
            expect(parse(strSchema(), 'hello')).toBe('hello')
            // 123 is coerced to '123' — this is expected behavior
            expect(parse(strSchema(), 123)).toBe('123')
        })

        it('should enforce minLength', () => {
            expect(() => parse(strSchema({ minLength: 5 }), 'abc')).toThrow()
            expect(parse(strSchema({ minLength: 5 }), 'hello')).toBe('hello')
        })

        it('should enforce maxLength', () => {
            expect(() => parse(strSchema({ maxLength: 5 }), 'hello world')).toThrow()
            expect(parse(strSchema({ maxLength: 5 }), 'hello')).toBe('hello')
        })

        it('should trim whitespace via coercion', () => {
            expect(parse(strSchema(), '  hello  ')).toBe('hello')
        })

        it('should validate email format', () => {
            const s = strSchema({ format: 'email' })
            expect(parse(s, 'test@example.com')).toBe('test@example.com')
            expect(() => parse(s, 'not-an-email')).toThrow()
        })

        it('should validate URL format', () => {
            const s = strSchema({ format: 'uri' })
            expect(parse(s, 'http://example.com')).toBe('http://example.com')
            expect(() => parse(s, 'not a url')).toThrow()
        })

        it('should validate UUID format', () => {
            const s = strSchema({ format: 'uuid' })
            const uuid = '550e8400-e29b-41d4-a716-446655440000'
            expect(parse(s, uuid)).toBe(uuid)
            expect(() => parse(s, 'not-a-uuid')).toThrow()
        })

        it('should validate pattern', () => {
            const s = strSchema({ pattern: '^[A-Z]+$' })
            expect(parse(s, 'HELLO')).toBe('HELLO')
            expect(() => parse(s, 'Hello')).toThrow()
        })

        it('should validate enum', () => {
            const s = strSchema({ enum: ['a', 'b', 'c'] })
            expect(parse(s, 'a')).toBe('a')
            expect(() => parse(s, 'd')).toThrow()
        })
    })

    describe('numbers', () => {
        it('should validate numbers', () => {
            expect(parse(numSchema(), 42)).toBe(42)
            expect(parse(numSchema(), 3.14)).toBe(3.14)
            expect(() => parse(numSchema(), 'not a number')).toThrow()
        })

        it('should coerce strings to numbers', () => {
            expect(parse(numSchema(), '42')).toBe(42)
            expect(parse(numSchema(), '3.14')).toBe(3.14)
        })

        it('should enforce integer type', () => {
            expect(parse(intSchema(), 42)).toBe(42)
            expect(() => parse(intSchema(), 3.14)).toThrow()
        })

        it('should enforce minimum', () => {
            const s = numSchema({ minimum: 0 })
            expect(parse(s, 0)).toBe(0)
            expect(parse(s, 100)).toBe(100)
            expect(() => parse(s, -1)).toThrow()
        })

        it('should enforce maximum', () => {
            const s = numSchema({ maximum: 100 })
            expect(parse(s, 100)).toBe(100)
            expect(parse(s, 50)).toBe(50)
            expect(() => parse(s, 101)).toThrow()
        })

        it('should enforce exclusiveMinimum', () => {
            const s = numSchema({ exclusiveMinimum: 0 })
            expect(parse(s, 1)).toBe(1)
            expect(parse(s, 0.001)).toBe(0.001)
            expect(() => parse(s, 0)).toThrow()
            expect(() => parse(s, -1)).toThrow()
        })

        it('should enforce multipleOf', () => {
            const s = numSchema({ multipleOf: 5 })
            expect(parse(s, 0)).toBe(0)
            expect(parse(s, 5)).toBe(5)
            expect(parse(s, 10)).toBe(10)
            expect(() => parse(s, 7)).toThrow()
        })

        it('should combine coercion + integer + range', () => {
            const s = intSchema({ minimum: 0, maximum: 100 })
            expect(parse(s, '50')).toBe(50)
            expect(() => parse(s, '150')).toThrow()
            expect(() => parse(s, '50.5')).toThrow()
        })
    })

    describe('booleans', () => {
        it('should validate booleans', () => {
            expect(parse(boolSchema(), true)).toBe(true)
            expect(parse(boolSchema(), false)).toBe(false)
            expect(() => parse(boolSchema(), 'hello')).toThrow()
        })

        it('should coerce string values to boolean', () => {
            expect(parse(boolSchema(), 'true')).toBe(true)
            expect(parse(boolSchema(), 'false')).toBe(false)
        })
    })

    describe('objects', () => {
        it('should validate required fields', () => {
            const s = objSchema(
                { name: strSchema(), age: numSchema() },
                ['name', 'age'],
            )
            expect(parse(s, { name: 'John', age: 30 })).toEqual({ name: 'John', age: 30 })
            expect(() => parse(s, { name: 'John' })).toThrow()
        })

        it('should allow optional fields', () => {
            const s = objSchema(
                { name: strSchema(), nickname: strSchema() },
                ['name'],
            )
            expect(parse(s, { name: 'John' })).toEqual({ name: 'John' })
        })

        it('should coerce nested fields', () => {
            const s = objSchema(
                { name: strSchema(), age: intSchema({ minimum: 18 }) },
                ['name', 'age'],
            )
            expect(parse(s, { name: '  John  ', age: '25' })).toEqual({ name: 'John', age: 25 })
        })

        it('should validate complex object', () => {
            const s = objSchema({
                name: strSchema({ minLength: 1, maxLength: 100 }),
                age: intSchema({ minimum: 0, maximum: 150 }),
                email: strSchema({ format: 'email' }),
                active: boolSchema(),
            }, ['name', 'age', 'email', 'active'])

            expect(parse(s, {
                name: 'John Doe',
                age: 30,
                email: 'john@example.com',
                active: true,
            })).toEqual({
                name: 'John Doe',
                age: 30,
                email: 'john@example.com',
                active: true,
            })
        })

        it('should validate form-like input with coercion', () => {
            const s = objSchema({
                username: strSchema({ minLength: 3, maxLength: 20 }),
                password: strSchema({ minLength: 8 }),
                age: intSchema({ minimum: 18 }),
                subscribe: boolSchema(),
            }, ['username', 'password', 'age'])

            const result = parse(s, {
                username: 'johndoe',
                password: 'securepassword123',
                age: '25',
                subscribe: 'true',
            })
            expect(result).toBeDefined()
            expect((result as any).age).toBe(25)
            expect((result as any).subscribe).toBe(true)
        })
    })

    describe('arrays', () => {
        it('should validate arrays', () => {
            const s: JsonSchema = { type: 'array', items: strSchema() }
            expect(parse(s, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
            expect(() => parse(s, 'not an array')).toThrow()
        })

        it('should enforce minItems / maxItems', () => {
            const s: JsonSchema = { type: 'array', items: numSchema(), minItems: 1, maxItems: 3 }
            expect(() => parse(s, [])).toThrow()
            expect(parse(s, [1, 2])).toEqual([1, 2])
            expect(() => parse(s, [1, 2, 3, 4])).toThrow()
        })

        it('should coerce array items', () => {
            const s: JsonSchema = { type: 'array', items: intSchema() }
            expect(parse(s, ['1', '2', '3'])).toEqual([1, 2, 3])
        })
    })

    describe('nullable', () => {
        it('should accept null for nullable schemas', () => {
            const s: JsonSchema = { nullable: true, type: 'string' }
            expect(parse(s, null)).toBeNull()
            expect(parse(s, 'hello')).toBe('hello')
        })
    })

    describe('safeParse', () => {
        it('should return ok: true on success', () => {
            const result = safeParse(strSchema(), 'hello')
            expect(result.ok).toBe(true)
            if (result.ok) expect(result.data).toBe('hello')
        })

        it('should return ok: false on failure', () => {
            const result = safeParse(strSchema({ minLength: 10 }), 'short')
            expect(result.ok).toBe(false)
            if (!result.ok) expect(result.error).toBeInstanceOf(ValidationError)
        })
    })

    describe('ValidationError', () => {
        it('should contain issue messages', () => {
            try {
                parse(objSchema({ a: strSchema() }, ['a']), {})
                fail('should have thrown')
            } catch (e) {
                expect(e).toBeInstanceOf(ValidationError)
                expect((e as ValidationError).issues.length).toBeGreaterThan(0)
            }
        })
    })
})