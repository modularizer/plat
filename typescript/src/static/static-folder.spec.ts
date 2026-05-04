import { StaticFolder } from './static-folder'

describe('StaticFolder fallback behavior', () => {
  it('serves the index file for extensionless misses only when spa is enabled', async () => {
    const folder = new StaticFolder({
      'index.html': '<html>spa</html>',
      'app.js': 'console.log("ok")',
    }, {
      index: 'index.html',
      onDirectory: 'index',
      spa: true,
    })

    const response = await folder.resolve('dashboard/settings')

    expect(response).not.toBeNull()
    expect(response?.status).toBe(200)
    expect(response?.filename).toBe('index.html')
    expect(await response?.getContent()).toEqual(new TextEncoder().encode('<html>spa</html>'))
  })

  it('serves 404.html for misses when spa is not enabled', async () => {
    const folder = new StaticFolder({
      'index.html': '<html>spa</html>',
      '404.html': '<html>missing</html>',
    }, {
      index: 'index.html',
      onDirectory: 'index',
    })

    const response = await folder.resolve('dashboard/settings')

    expect(response).not.toBeNull()
    expect(response?.status).toBe(404)
    expect(response?.filename).toBe('404.html')
    expect(await response?.getContent()).toEqual(new TextEncoder().encode('<html>missing</html>'))
  })

  it('serves 404.html for extensionful misses too', async () => {
    const folder = new StaticFolder({
      '404.html': '<html>missing</html>',
    })

    const response = await folder.resolve('assets/logo.png')

    expect(response).not.toBeNull()
    expect(response?.status).toBe(404)
    expect(response?.filename).toBe('404.html')
  })

  it('returns null when no fallback file exists', async () => {
    const folder = new StaticFolder({
      'index.html': '<html>spa</html>',
    }, {
      index: 'index.html',
      onDirectory: 'index',
    })

    await expect(folder.resolve('assets/logo.png')).resolves.toBeNull()
  })
})
