/**
 * plat — type-driven schemas.
 *
 * Define types with plain TypeScript + inline comments for constraints.
 * Run gen-schema.ts to produce JSON Schema. Import the schema and use
 * parse() / safeParse() for runtime validation with coercion.
 *
 * Example:
 *
 *   type CreatePost = {
 *     title: string   // min: 1, max: 200
 *     author: email
 *     priority: posint
 *     age: int<0, 150>
 *   }
 *
 * Scalars (type aliases with built-in constraints):
 *   str, email, url, uuid, datestr, datetime,
 *   hex, digits, numeric, upper, lower, title, slug,
 *   num, int, posint, pos, percent, limit, offset
 */

export { parse, safeParse, ValidationError } from './validate'
export type { ParseResult } from './validate'
export { coerce, parseDateish, parseRelativeDate, registerCoerce, Coerce } from './coerce'
export type { JsonSchema } from './coerce'
export type {
    // strings
    str, char, text, word, token, line,
    // formats
    email, url, uuid, ip, ipv6, hostname,
    datestr, datetime, time, json,
    // patterns
    pattern, grep, like, ilike,
    hex, digits, numeric, upper, lower, alpha, alphanum,
    title, slug, semver, base64, base58, phone, color, locale, mimetype, filepath,
    cuid, ulid, nanoid, jwt, countrycode, currency, lang, cron,
    // numbers
    num, float, double, int, pos, neg, notneg, posint,
    percent, limit, offset, port, byte, timestamp,
    age, cents, lat, lng,
    // bool
    flag,
} from './scalars'