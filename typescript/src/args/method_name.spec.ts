import { nameWords, normalizeName, resolveCommand } from './method_name'

const names = ['runCloneFeed', 'runClone', 'listViews', 'getURLInfo', 'run']

describe('nameWords / normalizeName', () => {
    it('splits every spelling the same way', () => {
        for (const spelling of ['runCloneFeed', 'run-clone-feed', 'run_clone_feed', 'run clone feed', 'RunCloneFeed']) {
            expect(nameWords(spelling)).toEqual(['run', 'clone', 'feed'])
            expect(normalizeName(spelling)).toBe('runclonefeed')
        }
    })

    it('keeps acronyms together', () => {
        expect(nameWords('getURLInfo')).toEqual(['get', 'url', 'info'])
    })
})

describe('resolveCommand', () => {
    it('uses the longest run of tokens, so a shorter exact name does not shadow it', () => {
        expect(resolveCommand(names, ['run', 'clone'])).toEqual({ ok: true, name: 'runClone', consumed: 2 })
        expect(resolveCommand(names, ['run'])).toEqual({ ok: true, name: 'run', consumed: 1 })
    })

    it('prefers an exactly spelled single token over look-alikes', () => {
        expect(resolveCommand(['run_it', 'runIt'], ['runIt'])).toEqual({ ok: true, name: 'runIt', consumed: 1 })
    })

    it.each([
        [['run-clone-feed'], 1],
        [['run_clone_feed'], 1],
        [['run', 'clone', 'feed'], 3],
        [['Run', 'Clone', 'Feed'], 3],
    ])('resolves %j', (argv, consumed) => {
        expect(resolveCommand(names, [...argv, '--name=x'])).toEqual({ ok: true, name: 'runCloneFeed', consumed })
    })

    it('prefers the longest match', () => {
        expect(resolveCommand(names, ['run-clone', 'feed'])).toEqual({ ok: true, name: 'runCloneFeed', consumed: 2 })
        expect(resolveCommand(['runClone', 'runCloneFeed'], ['run', 'clone', 'extra'])).toEqual({
            ok: true,
            name: 'runClone',
            consumed: 2,
        })
    })

    it('stops at flags, key=value and JSON', () => {
        expect(resolveCommand(names, ['list', 'views', 'limit=5'])).toEqual({ ok: true, name: 'listViews', consumed: 2 })
        expect(resolveCommand(names, ['list', 'views', '{"a":1}'])).toEqual({ ok: true, name: 'listViews', consumed: 2 })
        expect(resolveCommand(names, ['--name=x', 'list', 'views'])).toMatchObject({ ok: false, reason: 'unknown' })
    })

    it('reports unknown and ambiguous instead of guessing', () => {
        expect(resolveCommand(names, ['nope'])).toEqual({ ok: false, reason: 'unknown', candidates: [] })
        expect(resolveCommand(['run_it', 'runIt'], ['run-it'])).toEqual({
            ok: false,
            reason: 'ambiguous',
            candidates: ['run_it', 'runIt'],
        })
    })

    it('handles an empty argv', () => {
        expect(resolveCommand(names, [])).toMatchObject({ ok: false, reason: 'unknown' })
    })
})
