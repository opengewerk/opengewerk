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
}

/**
 * An address as a mail server takes it in a header: something, an at sign,
 * something with a dot. Deliberately loose; the server is the judge of the
 * rest, and a check that is stricter than the servers refuses real addresses.
 */
const address = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

/** Whether a text is an address a message can be sent to. */
export function isMailAddress(text: string): boolean {
  return address.test(text)
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
