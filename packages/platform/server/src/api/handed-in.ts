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

/**
 * The authentication handle, an interface of better-auth's and therefore not
 * injectable by its type. Handed in only while the instance is open: the
 * controllers that need it are left out of a closed one.
 */
export const AUTHENTICATION = Symbol('Authentication')

/**
 * The code the first run asks for, from `SETUP_CODE`, or null where the
 * instance has none: then the first run is refused with the sentence saying
 * how to get one. Read by the setup controller and by nothing else.
 */
export const SETUP_CODE = Symbol('SetupCode')
