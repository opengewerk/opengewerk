import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { isAllowed, type Permission } from '@opengewerk/domain'

import { IDENTITY_SOURCE, identityProperty, type IdentitySource } from './identity.js'

export const PERMISSION_METADATA = 'opengewerk:permission'

/**
 * The right a handler needs. Sits on the handler, not in its body, so that a
 * test can walk every route and say which one carries none. A check written
 * inside a method is just as effective and cannot be counted from outside,
 * and counting is what keeps the next handler from being forgotten.
 */
export const RequiresPermission = (permission: Permission) =>
  SetMetadata(PERMISSION_METADATA, permission)

/**
 * Resolves who is asking and whether they may. Runs on every request, so a
 * route without a declared right is refused rather than let through: a
 * forgotten decorator has to fail closed.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDENTITY_SOURCE) private readonly identities: IdentitySource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>()
    const identity = await this.identities.identify(request)

    if (!identity) {
      throw new UnauthorizedException('Keine gültige Anmeldung.')
    }

    request[identityProperty] = identity

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_METADATA,
      [context.getHandler(), context.getClass()],
    )

    if (!permission) {
      // Not a 403 for the caller's sake but for ours: the route says nothing
      // about what it needs, and guessing would be worse than refusing.
      throw new ForbiddenException('Diese Route deklariert kein Recht.')
    }

    if (!isAllowed(identity, permission)) {
      throw new ForbiddenException(`Fehlendes Recht: ${permission}`)
    }

    return true
  }
}
