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

import {
  IDENTITY_SOURCE,
  identityProperty,
  type IdentitySource,
  type RequestWithIdentity,
  userProperty,
} from './identity.js'

export const PERMISSION_METADATA = 'opengewerk:permission'
export const PUBLIC_METADATA = 'opengewerk:public'
export const SESSION_METADATA = 'opengewerk:session'

/**
 * The right a handler needs. Sits on the handler, not in its body, so that a
 * test can walk every route and say which one carries none. A check written
 * inside a method is just as effective and cannot be counted from outside,
 * and counting is what keeps the next handler from being forgotten.
 */
export const RequiresPermission = (permission: Permission) =>
  SetMetadata(PERMISSION_METADATA, permission)

/**
 * A route that answers without an identity. There is exactly one reason to
 * use this today, the health check an operator and the container runtime ask
 * for, and it has to stay that way: anything that touches tenant data goes
 * through the guard.
 *
 * It is a decorator rather than a list of paths in the guard so that a test
 * can count them. The test holds the current set, which means adding one is a
 * red test and therefore a decision somebody made on purpose, not a line that
 * slipped through a review.
 */
export const PublicRoute = () => SetMetadata(PUBLIC_METADATA, true)

/**
 * A route that needs somebody signed in but no business, and therefore no
 * right either.
 *
 * There are only a few, and all of them are about the moment between the
 * password and the choice of company: listing the businesses somebody may
 * enter, picking one, seeing and revoking one's own devices, signing out. A
 * right cannot be asked for there, because rights come from a membership and a
 * membership is per business.
 *
 * It is a third kind and not a variety of `PublicRoute`, because the
 * difference matters: a public route answers anybody, one of these answers
 * only somebody who has proved who they are. Counted by the same test that
 * counts the public ones, for the same reason.
 */
export const RequiresSession = () => SetMetadata(SESSION_METADATA, true)

/**
 * Resolves who is asking and whether they may. Runs on every request, so a
 * route without a declared right is refused rather than let through: a
 * forgotten decorator has to fail closed.
 *
 * It is also where the audit log gets its reason. The right a route declares
 * is the nearest thing to "what is going on here" that is available on every
 * request, and taking it here means no handler has to remember to pass one.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDENTITY_SOURCE) private readonly identities: IdentitySource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_METADATA, [
      context.getHandler(),
      context.getClass(),
    ])

    if (isPublic) {
      // No identity is resolved for these, on purpose. Asking the identity
      // source would mean the health check stops answering the moment the
      // authentication has a problem, which is the one moment somebody needs
      // an answer from it.
      return true
    }

    const request = context.switchToHttp().getRequest<RequestWithIdentity>()

    const needsSessionOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      SESSION_METADATA,
      [context.getHandler(), context.getClass()],
    )

    if (needsSessionOnly) {
      // Signed in is the whole requirement. No business has been chosen yet,
      // so there is no membership to read a right from, and asking for one
      // would make choosing a business impossible without already being in
      // one.
      const user = await this.identities.authenticate(request)

      if (!user) {
        throw new UnauthorizedException('Keine gültige Anmeldung.')
      }

      request[userProperty] = user

      return true
    }

    const identity = await this.identities.identify(request)

    if (!identity) {
      throw new UnauthorizedException('Keine gültige Anmeldung.')
    }

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

    // Only once everything has passed. A handler that runs has an identity
    // and a reason; one that does not never sees either.
    request[identityProperty] = { ...identity, reason: permission }

    return true
  }
}
