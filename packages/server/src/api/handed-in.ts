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

import type { MailConfiguration } from '../mail/configuration.js'
import type { MailTransport } from '../mail/transport.js'
import type { SecretKey } from '../secrets/key.js'

/** The authentication handle, handed in only while the instance is open. */
export const AUTHENTICATION = Symbol('Authentication')

/**
 * The code the first run asks for (#215), from `SETUP_CODE`, or null where the
 * instance has none: then the first run is refused with the sentence saying
 * how to get one. Read by the setup controller and by nothing else.
 */
export const SETUP_CODE = Symbol('SetupCode')

/**
 * The addresses a browser may send a request that changes something from,
 * read by `SameOriginGuard`. The same list better-auth gets, because the check
 * is the same check.
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
 * The directory the backups record their last run in (#130), or null where
 * the instance does not know one: a development machine, the preview, a test.
 */
export const BACKUP_STATUS = Symbol('BackupStatus')

/**
 * The version this installation runs (#259), or null where there is none to
 * name: a checkout, the preview, a test.
 */
export const VERSION = Symbol('Version')

/**
 * What the routes around mail need: where the instance is reached for the
 * links in a message, the key a mail password is sealed with, and a way to
 * try a connection. Null on a closed instance and in a test that sends
 * nothing: every route that would send then says so. Whether a particular
 * business sends mail is a question for its settings, not for this.
 */
export const MAIL = Symbol('Mail')

export interface MailContext {
  /** The first trusted origin, the address a link in a message points to. */
  readonly origin: string
  /** The key the password of a mail server is sealed with, from `SESSION_SECRET`. */
  readonly key: SecretKey
  /** Opens a connection, for the check. `smtpTransport`, or a stand-in in a test. */
  readonly connect: (configuration: MailConfiguration) => MailTransport
}
