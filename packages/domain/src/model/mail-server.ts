/**
 * How the connection to a mail server is protected.
 *
 * `starttls` is the default and the common case, submission on port 587 with
 * the upgrade to TLS required, not merely offered: a server that answers
 * without it is refused rather than sent a password in the clear. `tls` is
 * the older port 465 that speaks TLS from the first byte. `none` is for a
 * relay on the same machine or network, and for the tests.
 */
export const smtpSecurities = ['starttls', 'tls', 'none'] as const

export type SmtpSecurity = (typeof smtpSecurities)[number]

/** The port each kind of connection uses unless the business names another. */
export const defaultSmtpPorts: Readonly<Record<SmtpSecurity, number>> = {
  starttls: 587,
  tls: 465,
  none: 25,
}
