/**
 * Scalar type aliases.
 *
 * These are plain TypeScript types. The codegen reads the alias name
 * and maps it to a richer JSON Schema. At runtime they're just
 * string / number / boolean.
 *
 * Generic params override min/max from the comment constraints.
 *   int         → { type: integer, minimum: 0 }
 *   int<5>      → { type: integer, minimum: 5 }
 *   int<0, 100> → { type: integer, minimum: 0, maximum: 100 }
 *
 * Usage:
 *   type CreatePost = {
 *     author: email
 *     priority: pint
 *     title: str<1, 200>
 *     age: int<0, 150>
 *   }
 */

// ── strings ─────────────────────────────────────────────────

export type str<min = never, max = never> = string
export type varchar<max = never> = string
export type vc = varchar
export type char     = str<1, 1>
export type text     = str<0, 65535>
export type word     = pattern<'[a-zA-Z]+'>
export type token    = pattern<'[a-zA-Z0-9_]+'>
export type line     = pattern<'[^\\n]+'>

// formats
export type email    = string // format: email, min: 3, max: 320
export type url      = string // format: uri, min: 1, max: 2048
export type uuid     = string // format: uuid
export type ip       = string // format: ipv4
export type ipv6     = string // format: ipv6
export type hostname = string // format: hostname
export type datestr  = string // format: date, coerce: date
export type datetime = string // format: date-time, coerce: datetime
export type time     = string // format: time
export type json     = string // format: json

// patterns (regex)
export type pattern<pattern = never> = string //

// grep (unanchored — matches anywhere in the string, unlike pattern which anchors ^...$)
export type grep<grep = never>  = string //

// like / ilike (postgres LIKE syntax: % = any chars, _ = single char)
export type like<like = never>   = string //
export type ilike<ilike = never> = string //
export type hex      = pattern<'[0-9a-fA-F]+'>
export type digits   = pattern<'[0-9]+'>
export type numeric  = pattern<'-?[0-9]+(\\.[0-9]+)?'>
export type upper    = pattern<'[A-Z ]+'>
export type lower    = pattern<'[a-z ]+'>
export type alpha    = pattern<'[a-zA-Z]+'>
export type alphanum = pattern<'[a-zA-Z0-9]+'>
export type title    = pattern<'[A-Z][a-zA-Z ]*'>
export type slug     = pattern<'[a-z0-9]+(-[a-z0-9]+)*'>
export type semver   = pattern<'[0-9]+\\.[0-9]+\\.[0-9]+'>
export type base64   = pattern<'[A-Za-z0-9+/]+=*'>
export type base58   = pattern<'[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+'>
export type phone    = pattern<'\\+?[0-9\\- ()]+'>
export type color    = pattern<'#[0-9a-fA-F]{3,8}'>
export type locale   = pattern<'[a-z]{2}(-[A-Z]{2})?'>
export type mimetype = pattern<'[a-z]+/[a-z0-9.+-]+'>
export type filepath = pattern<'[^\\0]+'>

// ids
export type cuid     = pattern<'c[a-z0-9]{24}'>
export type ulid     = pattern<'[0-9A-HJKMNP-TV-Z]{26}'>
export type nanoid   = pattern<'[A-Za-z0-9_-]{21}'>
export type jwt      = pattern<'[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+'>

// iso codes
export type countrycode = pattern<'[A-Z]{2}'>
export type currency    = pattern<'[A-Z]{3}'>
export type lang        = pattern<'[a-z]{2}'>

// scheduling
export type cron     = pattern<'[0-9*,/-]+ [0-9*,/-]+ [0-9*,/-]+ [0-9*,/-]+ [0-9*,/-]+'>

// ── numbers ─────────────────────────────────────────────────

export type num<min = never, max = never> = number //
export type float<min = never, max = never> = number //
export type double<min = never, max = never> = number //
export type int<min = never, max = never> = number // int: true
export type pos      = num<0> // exclusiveMinimum: 0
export type neg      = number // exclusiveMaximum: 0
export type notneg   = num<0>
export type posint<max = never>    = int<1, max>
export type percent  = num<0, 100>
export type limit    = int<1>
export type offset   = int<0>
export type port     = int<0, 65535>
export type byte     = int<0, 255>
export type timestamp = int<0>
export type age      = int<0, 130>
export type cents    = int<0>
export type lat      = float<-90, 90>
export type lng      = float<-180, 180>

// ── bool ────────────────────────────────────────────────────

export type flag     = boolean //