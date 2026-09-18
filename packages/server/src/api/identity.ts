import type { Identity } from '@opengewerk/domain'
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

/** Where the guard puts the identity it resolved. */
export const identityProperty = 'opengewerkIdentity'

export interface RequestWithIdentity {
  [identityProperty]?: Identity
}

/**
 * The identity of the current request. Reading it is only safe behind the
 * guard, which is why it throws rather than returning undefined: a handler
 * that ends up without one is a wiring mistake, not a case to handle.
 */
export const CurrentIdentity = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<RequestWithIdentity>()
  const identity = request[identityProperty]

  if (!identity) {
    throw new Error('No identity on the request. Is the authorisation guard in place?')
  }

  return identity
})
