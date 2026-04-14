import {
  getClientSideServerMode,
  isAuthorityClientSideServerAddress,
  isDmzClientSideServerAddress,
  parseClientSideServerAddress,
} from './signaling'

describe('client-side-server signaling', () => {
  describe('parseClientSideServerAddress', () => {
    it('parses host-based css URLs', () => {
      const address = parseClientSideServerAddress('css://photoshare?region=us')

      expect(address.serverName).toBe('photoshare')
      expect(address.authority).toBe('photoshare')
      expect(address.topic).toBeUndefined()
      expect(address.params).toEqual({ region: 'us' })
    })

    it('parses dmz names from the pathname when present', () => {
      const address = parseClientSideServerAddress('css://dmz/my-server')

      expect(address.authority).toBe('dmz')
      expect(address.serverName).toBe('dmz')
      expect(address.topic).toBe('my-server')
    })
  })

  describe('getClientSideServerMode', () => {
    it('routes dmz names to dmz mode', () => {
      expect(getClientSideServerMode({ serverName: 'dmz/my-server' })).toBe('dmz')
      expect(isDmzClientSideServerAddress({ serverName: 'dmz/my-server' })).toBe(true)
      expect(isAuthorityClientSideServerAddress({ serverName: 'dmz/my-server' })).toBe(false)
    })

    it('routes non-dmz names to authority mode', () => {
      expect(getClientSideServerMode('css://photoshare')).toBe('authority')
      expect(isAuthorityClientSideServerAddress('css://team/alice/notebook')).toBe(true)
      expect(isDmzClientSideServerAddress('css://team/alice/notebook')).toBe(false)
    })

    it('only treats the dmz/ namespace prefix as dmz mode', () => {
      expect(getClientSideServerMode({ serverName: 'dmz' })).toBe('authority')
      expect(getClientSideServerMode({ serverName: 'dmz-server' })).toBe('authority')
    })
  })
})

