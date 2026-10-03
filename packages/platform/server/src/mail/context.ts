import type { SecretKey } from '../secrets/key.js'
import type { MailConfiguration } from './configuration.js'
import type { MailTransport } from './transport.js'

/**
 * What the routes and jobs around mail need, under the token a module hands
 * it in by: where the instance is reached for the links in a message, the key
 * a mail password is sealed with, and a way to open a connection. Null on a
 * closed instance and in a test that sends nothing: every route that would
 * send then says so. Whether a tenant sends mail is a question for its
 * settings, not for this.
 */
export const MAIL = Symbol('Mail')

export interface MailContext {
  /** The first trusted origin, the address a link in a message points to. */
  readonly origin: string
  /** The key the password of a mail server is sealed with, from `SESSION_SECRET`. */
  readonly key: SecretKey
  /** Opens a connection. `smtpTransport` behind `reachableOnly`, or a stand-in in a test. */
  readonly connect: (configuration: MailConfiguration) => MailTransport
}
