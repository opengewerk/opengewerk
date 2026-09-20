import type { Identity, Permission } from '@opengewerk/domain'
import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

/**
 * Where an identity comes from. Sessions, passkeys and the rest arrive with
 * the authentication work; this is the seam they plug into.
 *
 * There is deliberately no default implementation. A server without one does
 * not start, because Nest cannot resolve the provider, and that is the right
 * way round: a missing authentication has to stop the server, not quietly let
 * everybody in as nobody.
 */
export const IDENTITY_SOURCE = Symbol('IdentitySource')

/**
 * Somebody who has signed in but has not said which business they mean.
 *
 * A real state and not a half finished one: a person can belong to two
 * companies, so between the password and the choice there is a moment with a
 * user and no tenant. The handful of routes that live in that moment, picking
 * a company and looking after one's own devices, need this and nothing more.
 * Everything else needs an `Identity`, which is this plus a business.
 */
export interface SignedInUser {
  readonly userId: string
  readonly sessionId: string
}

export interface IdentitySource {
  /** Returns null when the request carries no valid identity. */
  identify(request: unknown): Promise<Identity | null>
  /**
   * Who is signed in, without asking which business they are working in.
   *
   * Separate from `identify` because the answers differ in kind and not in
   * detail: `identify` refuses somebody who has chosen no company, and this
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
 * hand and never forgotten: the guard refuses a route without one. A reason a
 * person types ("Storno wegen Zahlendreher") is a better answer to the same
 * question and belongs to the screen that asks for it, which does not exist
 * yet.
 */
export interface RequestIdentity extends Identity {
  readonly reason: Permission
}

/** Where the guard puts the identity it resolved. */
export const identityProperty = 'opengewerkIdentity'
/** Where the guard puts a user it resolved without a business. */
export const userProperty = 'opengewerkUser'

export interface RequestWithIdentity {
  [identityProperty]?: RequestIdentity
  [userProperty]?: SignedInUser
}

/**
 * The identity of the current request. Reading it is only safe behind the
 * guard, which is why it throws rather than returning undefined: a handler
 * that ends up without one is a wiring mistake, not a case to handle.
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
 * business is chosen. Throws for the same reason as the one above: a handler
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
