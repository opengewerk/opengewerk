import type { SmtpSecurity } from '@opengewerk/domain'

/**
 * How one business reaches its mail server, as the job and the check need it:
 * the settings from `mail_settings` with the password opened.
 *
 * `from` is an address and nothing more. The name in front of it is the
 * business a message is sent for, from its letterhead.
 */
export interface MailConfiguration {
  readonly host: string
  readonly port: number
  readonly security: SmtpSecurity
  readonly user: string | null
  readonly password: string | null
  readonly from: string
  /**
   * The name to verify the certificate against, when `host` is the address a
   * name was resolved to (`reachableOnly`). Left out, it is `host` itself.
   */
  readonly servername?: string | undefined
}

/**
 * An address as a mail server takes it in a header: something, an at sign,
 * and a domain of labels joined by dots. Deliberately loose; the server is the
 * judge of the rest, and a check that is stricter than the servers refuses
 * real addresses.
 *
 * The labels of the domain carry no dot themselves, and that is what keeps the
 * check linear. With a dot allowed inside them, as before, every dot of a text
 * like "a@b.c.c.c.c..." was a place to split at, and a long enough text of that
 * kind held the process for seconds. Every address reaches here from a form.
 */
const address = /^[^\s@<>"',;]+@[^\s@<>"',;.]+(?:\.[^\s@<>"',;.]+)+$/

/** The longest address a mail server takes, RFC 5321 section 4.5.3.1.3. */
const longestAddress = 254

/** Whether a text is an address a message can be sent to. */
export function isMailAddress(text: string): boolean {
  return text.length <= longestAddress && address.test(text)
}

/**
 * A host name or an address a connection can be opened to, and nothing that
 * would turn into something else on the way: no scheme, no path, no port, no
 * space. The port has a field of its own, and `smtp://` in this field is the
 * one mistake worth catching before a server is asked.
 */
export function isHostName(text: string): boolean {
  return /^[A-Za-z0-9.-]+$|^\[?[0-9A-Fa-f:.]+\]?$/.test(text) && !text.startsWith('-')
}
