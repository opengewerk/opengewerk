import type { MailConfiguration } from './configuration.js'
import { MailDeliveryError, type MailTransport } from './transport.js'

/** What asking a mail server found. */
export type MailServerCheck =
  | { readonly outcome: 'ready' }
  /** A setting that is wrong, and trying again later will not make it right. */
  | { readonly outcome: 'refused'; readonly reason: string }
  /** Nobody answered. Messages wait in the outbox until somebody does. */
  | { readonly outcome: 'unreachable'; readonly reason: string }

/**
 * Asks a mail server whether the settings are right: connects, greets, signs
 * in, and sends nothing. For the button "Verbindung prüfen" in the office, and
 * before every save of the settings there.
 *
 * Two kinds of failure, and they get different sentences. A host name that
 * does not exist, a login the server refuses, a TLS connection that cannot be
 * made, a certificate it does not accept: each of these names the field to
 * look at. A server that simply does not answer right now may be restarting,
 * and saying so is all there is to say; a wrong port looks the same from
 * here, and the sentence names both. What happens to the messages meanwhile
 * is not said here: the check runs before saving as well, when nothing waits
 * yet.
 */
export async function checkMailServer(
  transport: MailTransport,
  configuration: MailConfiguration,
): Promise<MailServerCheck> {
  try {
    await transport.verify()

    return { outcome: 'ready' }
  } catch (error) {
    const failure =
      error instanceof MailDeliveryError ? error : new MailDeliveryError(String(error), null, null)
    const server = `${configuration.host}:${String(configuration.port)}`

    switch (failure.code) {
      case 'EAUTH':
      case 'ENOAUTH':
        return {
          outcome: 'refused',
          reason:
            `Der Mailserver ${server} lehnt die Anmeldung ab. Stimmen Benutzername und ` +
            `Passwort? Er antwortete: ${failure.message}`,
        }
      case 'EDNS':
        return {
          outcome: 'refused',
          reason: `Den Mailserver "${configuration.host}" gibt es nicht, der Name lässt sich nicht auflösen.`,
        }
      case 'ETLS':
      case 'EREQUIRETLS':
        return {
          outcome: 'refused',
          reason:
            `Mit dem Mailserver ${server} kommt keine verschlüsselte Verbindung zustande: ` +
            `${failure.message}. Passt die Verschlüsselung zum Port, STARTTLS für 587, TLS für 465?`,
        }
      case 'ECONFIG':
        return {
          outcome: 'refused',
          reason: `Die Angaben zum Mailserver passen nicht zusammen: ${failure.message}`,
        }
      default:
        // A certificate the connection refuses arrives as a plain socket error
        // on port 465, where TLS starts with the first byte. It is a setting
        // all the same, and waiting will not make it right.
        if (/certificate|self[- ]signed|CERT_/i.test(failure.message)) {
          return {
            outcome: 'refused',
            reason: `Das Zertifikat des Mailservers ${server} wird nicht anerkannt: ${failure.message}`,
          }
        }

        return {
          outcome: 'unreachable',
          reason:
            `Der Mailserver ${server} antwortet nicht (${failure.message}). Vielleicht startet er ` +
            'gerade neu, vielleicht stimmen Server oder Port nicht.',
        }
    }
  }
}
