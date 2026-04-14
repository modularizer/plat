import type {
  AuthorityAuthMode,
  AuthorityLiveHostSession,
  AuthorityServerRegistration,
} from '../models/authority-types.js'

export interface AuthorityHostSessionOptions {
  hostSessionId: string
  googleSub: string
  connectedAt?: number
  lastPongAt?: number
}

export class AuthorityHostSession {
  private readonly connectedAt: number
  private lastPongAt?: number
  private readonly authModes = new Map<string, AuthorityAuthMode>()

  readonly hostSessionId: string
  readonly googleSub: string

  constructor(options: AuthorityHostSessionOptions) {
    this.hostSessionId = options.hostSessionId
    this.googleSub = options.googleSub
    this.connectedAt = options.connectedAt ?? Date.now()
    this.lastPongAt = options.lastPongAt
  }

  registerServers(servers: Iterable<AuthorityServerRegistration>): void {
    for (const server of servers) {
      this.authModes.set(server.server_name, server.auth_mode)
    }
  }

  unregisterServers(serverNames: Iterable<string>): void {
    for (const serverName of serverNames) {
      this.authModes.delete(serverName)
    }
  }

  isRegistered(serverName: string): boolean {
    return this.authModes.has(serverName)
  }

  getAuthMode(serverName: string): AuthorityAuthMode | undefined {
    return this.authModes.get(serverName)
  }

  markPong(at = Date.now()): void {
    this.lastPongAt = at
  }

  clearRegistrations(): void {
    this.authModes.clear()
  }

  snapshot(): AuthorityLiveHostSession {
    return {
      hostSessionId: this.hostSessionId,
      googleSub: this.googleSub,
      serverNames: Array.from(this.authModes.keys()).sort(),
      authModes: Object.fromEntries(this.authModes.entries()),
      connectedAt: this.connectedAt,
      lastPongAt: this.lastPongAt,
    }
  }
}

