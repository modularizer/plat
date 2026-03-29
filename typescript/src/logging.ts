import { format } from 'node:util'

export interface Logger {
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
}

class StreamLogger implements Logger {
  constructor(private readonly _name = 'plat') {}

  private write(level: 'debug' | 'info' | 'warn' | 'error', message: string, args: any[]): void {
    const rendered = args.length ? format(message, ...args) : message
    const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout
    stream.write(`${rendered}\n`)
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
