/**
 * What the module hands to the controllers that cannot get it from a
 * constructor type.
 *
 * `Database` is a class, so Nest can inject it by its type. These two are not:
 * `Authentication` is an interface of better-auth's and the trusted origins
 * are an array of strings. Both need a token to be injected by, and a token is
 * a symbol.
 *
 * They sit in a file of their own rather than next to the first controller
 * that needed them. Two controllers use them now, the first run setup and the
 * redemption of an invitation link, and the second importing from the first
 * would say the two belong together when what they share is only this.
 */

/** The authentication handle, handed in only while the instance is open. */
export const AUTHENTICATION = Symbol('Authentication')

/**
 * The addresses a browser may send one of the two public writing routes from.
 * The same list better-auth gets, because the check is the same check.
 */
export const TRUSTED_ORIGINS = Symbol('TrustedOrigins')
