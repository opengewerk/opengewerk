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

export interface IdentitySource {
  /** Returns null when the request carries no valid identity. */
  identify(request: unknown): Promise<Identity | null>
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

export interface RequestWithIdentity {
  [identityProperty]?: RequestIdentity
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
