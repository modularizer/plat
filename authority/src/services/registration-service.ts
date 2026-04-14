import type {
  AuthorityAcceptedServerRegistration,
  AuthorityRegistrationResult,
  AuthorityRejectedServerRegistration,
  AuthorityServerRegistration,
} from '../models/authority-types.js'
import { parseServerNameScope, isNamespaceReserved } from './routing-service.js'
import type { ServerOwnershipService } from './server-ownership-service.js'
import { AuthorityHostSession } from '../ws/host-session.js'

export interface RegistrationServiceOptions {
  ownershipService: ServerOwnershipService
}

export class RegistrationService {
  private readonly ownershipService: ServerOwnershipService

  constructor(options: RegistrationServiceOptions) {
    this.ownershipService = options.ownershipService
  }

  async registerOnline(
    session: AuthorityHostSession,
    servers: readonly AuthorityServerRegistration[],
  ): Promise<AuthorityRegistrationResult> {
    const accepted: AuthorityAcceptedServerRegistration[] = []
    const rejected: AuthorityRejectedServerRegistration[] = []
    const seenServerNames = new Set<string>()

    for (const server of servers) {
      if (seenServerNames.has(server.server_name)) {
        rejected.push({
          ...server,
          code: 'duplicate_server_name',
          message: `Server ${server.server_name} was submitted more than once in the same registration batch.`,
        })
        continue
      }
      seenServerNames.add(server.server_name)

      let parsed
      try {
        parsed = parseServerNameScope(server.server_name)
      } catch (error: any) {
        rejected.push({
          ...server,
          code: 'server_not_owned',
          message: error?.message || 'Invalid server name for configured authority origins.',
        })
        continue
      }

      const namespace = parsed.namespace
      if (isNamespaceReserved(namespace)) {
        rejected.push({
          ...server,
          code: 'namespace_reserved',
          message: `Namespace "${namespace}" is reserved and cannot be registered through authority mode.`,
        })
        continue
      }

      const ownerGoogleSub = await this.ownershipService.getNamespaceOwnerGoogleSub(parsed.origin, namespace)
      if (ownerGoogleSub !== session.googleSub) {
        rejected.push({
          ...server,
          code: 'server_not_owned',
          message: ownerGoogleSub
            ? `Server ${server.server_name} is owned by a different Google account.`
            : `Server ${server.server_name} is not registered to any owner.`,
        })
        continue
      }

      accepted.push({
        ...server,
        owner_google_sub: ownerGoogleSub,
      })
    }

    session.registerServers(accepted)

    return {
      accepted,
      rejected,
      snapshot: session.snapshot(),
    }
  }

  registerOffline(session: AuthorityHostSession, serverNames: readonly string[]) {
    session.unregisterServers(serverNames)
    return session.snapshot()
  }
}

