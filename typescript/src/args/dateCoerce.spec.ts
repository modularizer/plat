/**
 * Tests for Date Coercion
 * Validates date parsing and relative date handling
 */

import { parseDateish, parseRelativeDate } from './coerce'

describe('Date Coercion', () => {
    describe('parseDateish (dateOnly)', () => {
        const dateOnly = (v: unknown) => parseDateish(v, new Date(), true)

        it('should parse ISO date strings', () => {
            const date = dateOnly('2024-03-16')!
            expect(date).toBeInstanceOf(Date)
            // dateOnly truncates to start of day in local timezone
            expect(date.getHours()).toBe(0)
            expect(date.getMinutes()).toBe(0)
        })

        it('should parse "now"', () => {
            const now = new Date()
            const date = dateOnly('now')!
            expect(date).toBeInstanceOf(Date)
            expect(date.getHours()).toBe(0) // dateOnly → start of day
        })

        it('should parse "today"', () => {
            const date = dateOnly('today')!
            expect(date).toBeInstanceOf(Date)
            expect(date.getHours()).toBe(0)
            expect(date.getMinutes()).toBe(0)
            expect(date.getSeconds()).toBe(0)
        })

        it('should parse "yesterday"', () => {
            const now = new Date()
            const yesterday = new Date(now.getTime() - 86_400_000)
            const date = dateOnly('yesterday')!
            expect(date).toBeInstanceOf(Date)
            expect(date.getDate()).toBe(yesterday.getDate())
        })

        it('should parse "tomorrow"', () => {
            const now = new Date()
            const tomorrow = new Date(now.getTime() + 86_400_000)
            const date = dateOnly('tomorrow')!
            expect(date).toBeInstanceOf(Date)
            expect(date.getDate()).toBe(tomorrow.getDate())
        })

        it('should parse relative dates with units', () => {
            expect(dateOnly('1 day ago')).toBeInstanceOf(Date)
            expect(dateOnly('2 days')).toBeInstanceOf(Date)
            expect(dateOnly('1 hour')).toBeInstanceOf(Date)
            expect(dateOnly('10 minutes')).toBeInstanceOf(Date)
        })

        it('should handle various time unit abbreviations', () => {
            expect(dateOnly('1 s')).toBeInstanceOf(Date)
            expect(dateOnly('1 sec')).toBeInstanceOf(Date)
            expect(dateOnly('1 second')).toBeInstanceOf(Date)
            expect(dateOnly('5 m')).toBeInstanceOf(Date)
            expect(dateOnly('5 min')).toBeInstanceOf(Date)
            expect(dateOnly('5 minute')).toBeInstanceOf(Date)
            expect(dateOnly('1 h')).toBeInstanceOf(Date)
            expect(dateOnly('1 hr')).toBeInstanceOf(Date)
            expect(dateOnly('1 hour')).toBeInstanceOf(Date)
        })

        it('should handle month and year units', () => {
            expect(dateOnly('1 month')).toBeInstanceOf(Date)
            expect(dateOnly('6 months')).toBeInstanceOf(Date)
            expect(dateOnly('1 year')).toBeInstanceOf(Date)
        })

        it('should handle "ago" suffix', () => {
            const now = new Date()
            const oneHourAgo = dateOnly('1 hour ago')!
            expect(oneHourAgo.getTime()).toBeLessThan(now.getTime())

            const twoDaysAgo = dateOnly('2 days ago')!
            expect(twoDaysAgo.getTime()).toBeLessThan(now.getTime())
        })

        it('should handle whitespace variations', () => {
            expect(dateOnly('  1 day  ')).toBeInstanceOf(Date)
        })

        it('should be case-insensitive', () => {
            expect(dateOnly('NOW')).toBeInstanceOf(Date)
            expect(dateOnly('TODAY')).toBeInstanceOf(Date)
            expect(dateOnly('1 HOUR')).toBeInstanceOf(Date)
            expect(dateOnly('2 DAYS AGO')).toBeInstanceOf(Date)
        })

        it('should handle milliseconds', () => {
            expect(dateOnly('1000 ms')).toBeInstanceOf(Date)
            expect(dateOnly('1000 milliseconds')).toBeInstanceOf(Date)
        })

        it('should handle leap year dates', () => {
            const date = dateOnly('2024-02-29')
            expect(date).toBeInstanceOf(Date)
        })

        it('should handle year boundaries', () => {
            expect(dateOnly('2024-12-31')).toBeInstanceOf(Date)
            expect(dateOnly('2024-01-01')).toBeInstanceOf(Date)
        })

        it('should handle very large time offsets', () => {
            expect(dateOnly('365 days')).toBeInstanceOf(Date)
            expect(dateOnly('1000 days ago')).toBeInstanceOf(Date)
        })

        it('should return null for invalid input', () => {
            expect(dateOnly('not a date')).toBeNull()
            expect(dateOnly(null)).toBeNull()
            expect(dateOnly(undefined)).toBeNull()
        })
    })

    describe('parseDateish (datetime)', () => {
        const dt = (v: unknown) => parseDateish(v, new Date(), false)

        it('should parse ISO datetime strings', () => {
            const date = dt('2024-03-16T14:30:00Z')!
            expect(date).toBeInstanceOf(Date)
            expect(date.getFullYear()).toBe(2024)
            expect(date.getMonth()).toBe(2)
            expect(date.getDate()).toBe(16)
        })

        it('should parse datetime with timezone offset', () => {
            expect(dt('2024-03-16T14:30:00+05:00')).toBeInstanceOf(Date)
        })

        it('should support relative datetime parsing', () => {
            expect(dt('30 minutes ago')).toBeInstanceOf(Date)
            expect(dt('1 hour')).toBeInstanceOf(Date)
        })

        it('should preserve time (not truncate to start of day)', () => {
            const date = dt('2024-03-16T14:30:00Z')!
            expect(date.getUTCHours()).toBe(14)
            expect(date.getUTCMinutes()).toBe(30)
        })
    })

    describe('parseDateish with Date and number inputs', () => {
        it('should accept Date objects', () => {
            const d = new Date('2024-06-15')
            expect(parseDateish(d)).toBeInstanceOf(Date)
        })

        it('should accept unix timestamps', () => {
            const ts = Date.now()
            expect(parseDateish(ts)).toBeInstanceOf(Date)
        })
    })
})