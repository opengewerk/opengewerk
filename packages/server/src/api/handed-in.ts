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

/**
 * The content addressed file store. An interface of its own rather than the
 * class, so that a module built without one gets a store that says so the
 * moment it is used, instead of writing into some directory nobody chose.
 */
export const FILE_STORE = Symbol('FileStore')

/** What turns a print job into a PDF: the renderer service, or a stand-in. */
export const RENDERER = Symbol('Renderer')

/**
 * Whether this instance sends mail, and where it is reached for the links in
 * a message. Null when no mail server is set up: the route that sends a
 * document then says so instead of writing a message nobody will send.
 */
export const MAIL = Symbol('Mail')

export interface MailSettings {
  /** The first trusted origin, the address a link in a message points to. */
  readonly origin: string
  /** `MAIL_FROM`, the address every message leaves from. */
  readonly from: string
}
