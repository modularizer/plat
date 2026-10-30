/**
 * Forgiving method names for CLIs: `runCloneFeed`, `run-clone-feed`, `run_clone_feed` and
 * `run clone feed` all name the same operation.
 *
 * Pure (no node/DOM imports) so the lightweight client package can ship it.
 */

/** Split a name into lowercase words on camelCase, acronym, `-`, `_`, `.` and whitespace boundaries. */
export function nameWords(name: string): string[] {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/[\s_\-.]+/)
        .filter(Boolean)
        .map((word) => word.toLowerCase())
}

/** The canonical comparison key: all words, lowercased, joined with no separator. */
export function normalizeName(name: string): string {
    return nameWords(name).join('')
}

export type ResolvedCommand =
    | { ok: true; name: string; consumed: number }
    | { ok: false; reason: 'unknown' | 'ambiguous'; candidates: string[] }

/** True for tokens that can be part of a command name (not flags, `key=value` or JSON). */
function isNameToken(token: string): boolean {
    return !token.startsWith('-') && !token.startsWith('{') && !token.startsWith('[') && !token.includes('=')
}

/**
 * Resolve the leading bare tokens of `argv` to one of `names`. The longest run of leading tokens
 * whose normalized join matches wins (so `run clone feed` beats a shorter `run`); a lone token spelled
 * exactly like a name wins over look-alikes. `consumed` is how many argv
 * tokens the command used. Two names that normalize identically are `ambiguous`, never guessed.
 */
export function resolveCommand(names: readonly string[], argv: readonly string[]): ResolvedCommand {
    const byKey = new Map<string, string[]>()
    for (const name of names) {
        const key = normalizeName(name)
        byKey.set(key, [...(byKey.get(key) ?? []), name])
    }

    let run = 0
    while (run < argv.length && isNameToken(argv[run]!)) run += 1

    for (let length = run; length >= 1; length -= 1) {
        // A single token spelled exactly like a name is never ambiguous, even if siblings normalize alike.
        if (length === 1 && names.includes(argv[0]!)) return { ok: true, name: argv[0]!, consumed: 1 }
        const matches = byKey.get(normalizeName(argv.slice(0, length).join(' ')))
        if (matches === undefined) continue
        if (matches.length === 1) return { ok: true, name: matches[0]!, consumed: length }
        return { ok: false, reason: 'ambiguous', candidates: matches }
    }
    return { ok: false, reason: 'unknown', candidates: [] }
}
