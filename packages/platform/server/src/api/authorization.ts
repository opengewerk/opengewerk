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
import { workingInHeader } from '@opengewerk/platform-domain'

import { Database } from '../database/database.js'
import { operatorAccess } from '../instance/access.js'
import {
  IDENTITY_SOURCE,
  identityProperty,
  type IdentitySource,
  type RequestWithIdentity,
  userProperty,
} from './identity.js'

/** One value of a request header, undefined where it is missing or said twice. */
function headerOf(request: unknown, name: string): string | undefined {
  const value = (request as { headers?: Record<string, string | string[] | undefined> }).headers?.[
    name.toLowerCase()
  ]

  return typeof value === 'string' ? value : undefined
}

export const PERMISSION_METADATA = 'opengewerk:permission'
export const PUBLIC_METADATA = 'opengewerk:public'
export const SESSION_METADATA = 'opengewerk:session'
export const OPERATOR_METADATA = 'opengewerk:operator'

/**
 * The right a handler needs. Sits on the handler, not in its body, so that a
 * test can walk every route and say which one carries none. A check written
 * inside a method is just as effective and cannot be counted from outside,
 * and counting is what keeps the next handler from being forgotten.
 *
 * Which rights there are is the application's list, and a string to this
 * package. An application wraps this once with its own type, so that a typo
 * in a right is found by the compiler and not by a refused request.
 */
export const RequiresPermission = (permission: string) =>
  SetMetadata(PERMISSION_METADATA, permission)

/**
 * A route that answers without an identity.
 *
 * There are three reasons to use this and they are the only three. The health
 * check, which whoever runs the instance and the container runtime ask for
 * and which must keep answering when the authentication itself is in trouble.
 * The first run setup, which creates the first account on an empty instance
 * and therefore cannot ask for one. And the redemption of an invitation link,
 * which creates every account after that and cannot either.
 *
 * The two that write are not open in the sense of unguarded: each has
 * something standing in for an identity, the state of the data in one case and
 * a token in the other. Anything that touches the data of a tenant that
 * already exists goes through the guard.
 *
 * It is a decorator rather than a list of paths in the guard so that a test
 * can count them. An application holds the current set in such a test, which
 * means adding one is a red test and therefore a decision somebody made on
 * purpose, not a line that slipped through a review.
 */
export const PublicRoute = () => SetMetadata(PUBLIC_METADATA, true)

/**
 * A route that needs somebody signed in but no tenant, and therefore no right
 * either.
 *
 * There are only a few, and all of them are about the moment between the
 * password and the choice of tenant: listing the tenants somebody may enter,
 * picking one, seeing and revoking one's own devices, signing out. A right
 * cannot be asked for there, because rights come from a membership and a
 * membership is per tenant.
 *
 * It is a third kind and not a variety of `PublicRoute`, because the
 * difference matters: a public route answers anybody, one of these answers
 * only somebody who has proved who they are. Counted by the same test that
 * counts the public ones, for the same reason.
 */
export const RequiresSession = () => SetMetadata(SESSION_METADATA, true)

/**
 * A route of the area of the instance: somebody signed in who runs the
 * instance and has a second factor set up. No tenant and no right of a tenant
 * come into it; whatever somebody is in one opens nothing here. Counted by
 * the same test as the other kinds.
 */
export const RequiresOperator = () => SetMetadata(OPERATOR_METADATA, true)

/**
 * What the guard has to be told by the application it guards (ADR 0010).
 *
 * The guard knows the mechanism: who is asking, in which tenant, which rights
 * their identity carries, who runs the instance, and that a route without a
 * declared right is refused. What a refusal says in the words of the
 * application, it is handed.
 *
 * Whether somebody holds a right is not among the things handed in. The
 * identity carries the rights the roles of its membership add up to, and the
 * guard asks those, the same way for every application.
 */
export interface Authorization<Right extends string = string> {
  /**
   * The sentence a refusal over a missing right says. In words and not as the
   * key of the right, since a screen shows it.
   */
  missingPermission(right: Right): string
  /** The refusals that name something the application has its own word for. */
  readonly sentences: {
    /** Somebody signed in asks for the area of the instance and does not run it. */
    readonly operatorsOnly: string
    /** A page still works in another tenant than the session it sends. */
    readonly workingInAnotherTenant: string
  }
}

/** The token the application's answers are handed in under. */
export const AUTHORIZATION = Symbol('Authorization')

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
    @Inject(AUTHORIZATION) private readonly authorization: Authorization,
    private readonly database: Database,
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

    const needsOperator = this.reflector.getAllAndOverride<boolean | undefined>(OPERATOR_METADATA, [
      context.getHandler(),
      context.getClass(),
    ])

    if (needsOperator) {
      // Who, from the session; whether they run the instance, from the area
      // of the instance, read fresh on every request like the roles of a
      // membership, so that taking it away takes effect at once.
      const user = await this.identities.authenticate(request)

      if (!user) {
        throw new UnauthorizedException('Keine gültige Anmeldung.')
      }

      const access = await operatorAccess(this.database, user.userId, user.sessionId)

      if (!access.operator) {
        throw new ForbiddenException(this.authorization.sentences.operatorsOnly)
      }

      if (!access.secondFactor) {
        throw new ForbiddenException(
          'Für den Bereich der Instanz ist ein zweiter Faktor Pflicht. Bitte unter „Konto“ ' +
            'eine Authenticator-App einrichten oder mit einem Passkey anmelden.',
        )
      }

      request[userProperty] = user

      return true
    }

    const needsSessionOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      SESSION_METADATA,
      [context.getHandler(), context.getClass()],
    )

    if (needsSessionOnly) {
      // Signed in is the whole requirement. No tenant has been chosen yet, so
      // there is no membership to read a right from, and asking for one would
      // make choosing a tenant impossible without already being in one.
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

    // A page names the tenant it works in. A switch in another tab moves the
    // session and not this page, which would otherwise send its outbox into a
    // tenant it does not show and take that tenant's records into its own
    // store. Refused as not signed in to this tenant, which is what it is; the
    // page asks again and starts in the other one.
    const workingIn = headerOf(request, workingInHeader)

    if (workingIn !== undefined && workingIn !== identity.tenantId) {
      throw new UnauthorizedException(this.authorization.sentences.workingInAnotherTenant)
    }

    const permission = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_METADATA, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!permission) {
      // Not a 403 for the caller's sake but for ours: the route says nothing
      // about what it needs, and guessing would be worse than refusing.
      throw new ForbiddenException('Diese Route deklariert kein Recht.')
    }

    if (!identity.rights.includes(permission)) {
      throw new ForbiddenException(this.authorization.missingPermission(permission))
    }

    // Only once everything has passed. A handler that runs has an identity
    // and a reason; one that does not never sees either.
    request[identityProperty] = { ...identity, reason: permission }

    return true
  }
}
