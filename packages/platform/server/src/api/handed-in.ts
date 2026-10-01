/**
 * What a module hands to the parts of the foundation that cannot get it from
 * a constructor type. A class can be injected by its type; a list of strings
 * cannot, and needs a token to be injected by.
 *
 * The tokens of what an application hands to its own controllers stay with
 * the application.
 */

/**
 * The addresses a browser may send a request that changes something from,
 * read by `SameOriginGuard`. The same list the authentication gets, because
 * the check is the same check.
 */
export const TRUSTED_ORIGINS = Symbol('TrustedOrigins')
