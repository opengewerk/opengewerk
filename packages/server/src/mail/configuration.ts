import { ConfigurationError, type Environment } from '../configuration.js'

/**
 * How the connection to the mail server is protected.
 *
 * `starttls` is the default and the common case, submission on port 587 with
 * the upgrade to TLS required, not merely offered: a server that answers
 * without it is refused rather than sent a password in the clear. `tls` is
 * the older port 465 that speaks TLS from the first byte. `none` is for a
 * relay on the same machine or network, and for the tests.
 */
export const smtpSecurities = ['starttls', 'tls', 'none'] as const

export type SmtpSecurity = (typeof smtpSecurities)[number]

/** The port each kind of connection uses unless another one is given. */
const defaultPorts: Readonly<Record<SmtpSecurity, number>> = {
  starttls: 587,
  tls: 465,
  none: 25,
}

/**
 * The one way this instance sends mail, set per instance and not per module.
 *
 * `from` is an address and nothing more. The name in front of it is the
 * business a message is sent for, from its letterhead, so that on a shared
 * instance each company's customers see that company's name.
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

/**
 * Reads the mail settings, or nothing when this instance sends no mail.
 *
 * Without `SMTP_HOST` the instance runs as it did before: nothing is sent and
 * nothing waits to be sent. That is a real configuration, not a broken one,
 * so it is not an error. What is an error is half a configuration, a sender
 * without a server or a user without a password: it means somebody meant to
 * set this up and got it wrong, and that is found at startup rather than at
 * the first invoice that never arrives.
 */
export function readMailConfiguration(
  environment: Environment = process.env,
): MailConfiguration | null {
  const value = (name: string): string | null => environment[name]?.trim() || null

  const host = value('SMTP_HOST')
  const from = value('MAIL_FROM')
  const user = value('SMTP_USER')
  const password = value('SMTP_PASSWORD')

  if (host === null) {
    const stray = ['MAIL_FROM', 'SMTP_PORT', 'SMTP_SECURITY', 'SMTP_USER', 'SMTP_PASSWORD'].filter(
      (name) => value(name) !== null,
    )

    if (stray.length > 0) {
      throw new ConfigurationError(
        `${stray.join(', ')} ist gesetzt, SMTP_HOST aber nicht. Ohne SMTP_HOST verschickt ` +
          'OpenGewerk keine E-Mails; soll es das, fehlt der Mailserver.',
      )
    }

    return null
  }

  const rawSecurity = value('SMTP_SECURITY') ?? 'starttls'

  if (!(smtpSecurities as readonly string[]).includes(rawSecurity)) {
    throw new ConfigurationError(
      `SMTP_SECURITY muss "starttls", "tls" oder "none" sein, gelesen wurde: ${rawSecurity}`,
    )
  }

  const security = rawSecurity as SmtpSecurity
  const rawPort = value('SMTP_PORT')
  const port = rawPort === null ? defaultPorts[security] : Number(rawPort)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError(
      `SMTP_PORT muss eine Portnummer zwischen 1 und 65535 sein, gelesen wurde: ${rawPort ?? ''}`,
    )
  }

  if ((user === null) !== (password === null)) {
    throw new ConfigurationError(
      'SMTP_USER und SMTP_PASSWORD gehören zusammen: entweder beide setzen, oder keines von ' +
        'beiden für einen Mailserver, der ohne Anmeldung annimmt.',
    )
  }

  if (from === null) {
    throw new ConfigurationError(
      'MAIL_FROM fehlt. Das ist die Adresse, von der OpenGewerk verschickt, etwa ' +
        'rechnung@betrieb.example.de; der Name davor kommt aus dem Briefkopf des Betriebs.',
    )
  }

  if (!address.test(from)) {
    throw new ConfigurationError(
      `MAIL_FROM ist keine E-Mail-Adresse: "${from}". Erwartet wird nur die Adresse, ohne ` +
        'Namen davor, etwa rechnung@betrieb.example.de.',
    )
  }

  return { host, port, security, user, password, from }
}

/** Whether a text is an address a message can be sent to. */
export function isMailAddress(text: string): boolean {
  return address.test(text)
}
