export interface Logger {
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
}

function formatMessage(message: string, args: any[]): string {
  if (args.length === 0) return message
  let i = 0
  return message.replace(/%[sdjoO%]/g, (match) => {
    if (match === '%%') return '%'
    if (i >= args.length) return match
    const arg = args[i++]
    switch (match) {
      case '%s': return String(arg)
      case '%d': return String(Number(arg))
      case '%j': try { return JSON.stringify(arg) } catch { return '[Circular]' }
      case '%o':
      case '%O': try { return JSON.stringify(arg) } catch { return '[Circular]' }
      default: return match
    }
  })
}

class StreamLogger implements Logger {
  constructor(private readonly _name = 'plat') {}

  private write(level: 'debug' | 'info' | 'warn' | 'error', message: string, args: any[]): void {
    const rendered = formatMessage(message, args)
    if (level === 'warn') console.warn(rendered)
    else if (level === 'error') console.error(rendered)
    else if (level === 'debug') console.debug(rendered)
    else console.log(rendered)
  }

  debug(message: string, ...args: any[]): void {
    this.write('debug', message, args)
  }

  info(message: string, ...args: any[]): void {
    this.write('info', message, args)
  }

  warn(message: string, ...args: any[]): void {
    this.write('warn', message, args)
  }

  error(message: string, ...args: any[]): void {
    this.write('error', message, args)
  }
}

export function getLogger(name = 'plat'): Logger {
  return new StreamLogger(name)
}

export const defaultLogger: Logger = getLogger('plat')
