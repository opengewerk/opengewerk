import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { TenantIdentity } from '@opengewerk/platform-domain'

/**
 * Where an identity comes from: the session of the authentication on an
 * instance, a header in the tests, the one fixed person in a preview. This is
 * the seam they plug into.
 *
 * There is deliberately no default implementation. A server without one does
 * not start, because Nest cannot resolve the provider, and that is the right
 * way round: a missing authentication has to stop the server, not quietly let
 * everybody in as nobody.
 */
export const IDENTITY_SOURCE = Symbol('IdentitySource')

/**
 * Somebody who has signed in but has not said which tenant they mean.
 *
 * A real state and not a half finished one: a person can belong to two
 * tenants, so between the password and the choice there is a moment with a
 * user and no tenant. The handful of routes that live in that moment, picking
 * a tenant and looking after one's own devices, need this and nothing more.
 * Everything else needs an identity, which is this plus a tenant.
 */
export interface SignedInUser {
  readonly userId: string
  readonly sessionId: string
}

/**
 * An identity as a source finds it, with the session it came from where there
 * is one. The session is what a device is signed in with, so that something
 * bound to it ends when the device is signed out. A preview and the tests
 * have none.
 *
 * `deviceId` is the device the session was signed in on, as it named itself
 * when it chose the tenant, and not what a request says about itself.
 *
 * `Who` is the identity of the application: the user and the tenant, and
 * whatever it reads a right from.
 */
export type FoundIdentity<Who extends TenantIdentity = TenantIdentity> = Who & {
  readonly sessionId?: string
  readonly deviceId?: string
}

export interface IdentitySource<Who extends TenantIdentity = TenantIdentity> {
  /** Returns null when the request carries no valid identity. */
  identify(request: unknown): Promise<FoundIdentity<Who> | null>
  /**
   * Who is signed in, without asking which tenant they are working in.
   *
   * Separate from `identify` because the answers differ in kind and not in
   * detail: `identify` refuses somebody who has chosen no tenant, and this
   * one is what that person uses to choose one. Collapsing the two would mean
   * a route that only needs a session would also accept one that has a tenant
   * it has no business caring about.
   */
  authenticate(request: unknown): Promise<SignedInUser | null>
}

/**
 * The identity, plus what this request is about to do. The reason travels
 * with it into the database and from there into the audit log, so that a row
 * in the log says not only who changed a field but on account of what.
 *
 * It is the right the route declared, because that is the one thing always at
 * hand and never forgotten: the guard refuses a route without one.
 */
export type RequestIdentity<
  Who extends TenantIdentity = TenantIdentity,
  Right extends string = string,
> = FoundIdentity<Who> & { readonly reason: Right }

/** Where the guard puts the identity it resolved. */
export const identityProperty = 'opengewerkIdentity'
/** Where the guard puts a user it resolved without a tenant. */
export const userProperty = 'opengewerkUser'

export interface RequestWithIdentity {
  [identityProperty]?: RequestIdentity
  [userProperty]?: SignedInUser
}

/**
 * The identity of the current request. Reading it is only safe behind the
 * guard, which is why it throws rather than returning undefined: a handler
 * that ends up without one is a wiring mistake, not a case to handle.
 *
 * What type the parameter has is said where it stands. An application writes
 * its own identity there, the one its source hands out.
 */
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestIdentity => {
    const request = context.switchToHttp().getRequest<RequestWithIdentity>()
    const identity = request[identityProperty]

    if (!identity) {
      throw new Error('No identity on the request. Is the authorisation guard in place?')
    }

    return identity
  },
)

/**
 * The signed in user of the current request, for the routes that run before a
 * tenant is chosen. Throws for the same reason as the one above: a handler
 * that gets here without one is wired wrongly, not facing a case to handle.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SignedInUser => {
    const request = context.switchToHttp().getRequest<RequestWithIdentity>()
    const user = request[userProperty]

    if (!user) {
      throw new Error('No user on the request. Is the route marked with @RequiresSession?')
    }

    return user
  },
)
