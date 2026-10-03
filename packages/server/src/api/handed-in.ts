/**
 * What the module hands to the controllers that cannot get it from a
 * constructor type.
 *
 * `Database` is a class, so Nest can inject it by its type. These are not:
 * they are values, each needs a token to be injected by, and a token is a
 * symbol. The tokens of what the foundation's own parts read, the trusted
 * origins, the authentication, the setup code, the file store, the record of
 * the last backup and the renderer, are the foundation's.
 *
 * They sit in a file of their own rather than next to the first controller
 * that needed them: a controller importing from another would say the two
 * belong together when what they share is only this.
 */

import type { MailConfiguration, SecretKey } from '@opengewerk/platform-server'

import type { MailTransport } from '../mail/transport.js'

/**
 * What the routes around mail need: where the instance is reached for the
 * links in a message, the key a mail password is sealed with, and a way to
 * try a connection. Null on a closed instance and in a test that sends
 * nothing: every route that would send then says so. Whether a particular
 * business sends mail is a question for its settings, not for this.
 */
export const MAIL = Symbol('Mail')

/**
 * The key values are sealed with that are not a login to something outside:
 * the ways into a site (#286). The same key as the mail password's, from
 * `SESSION_SECRET`; null in a test that seals nothing, and every route that
 * would seal then says so.
 */
export const SECRETS = Symbol('Secrets')

export interface MailContext {
  /** The first trusted origin, the address a link in a message points to. */
  readonly origin: string
  /** The key the password of a mail server is sealed with, from `SESSION_SECRET`. */
  readonly key: SecretKey
  /** Opens a connection, for the check. `smtpTransport`, or a stand-in in a test. */
  readonly connect: (configuration: MailConfiguration) => MailTransport
}
