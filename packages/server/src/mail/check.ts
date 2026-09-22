import { ConfigurationError } from '../configuration.js'
import type { MailConfiguration } from './configuration.js'
import { MailDeliveryError, type MailTransport } from './transport.js'

/** What the check at startup found, when it found no wrong setting. */
export type MailServerCheck =
  | { readonly outcome: 'ready' }
  /** Nobody answered. The instance starts anyway; messages wait in the outbox. */
  | { readonly outcome: 'unreachable'; readonly reason: string }

/**
 * Asks the mail server once at startup whether the settings are right.
 *
 * Two kinds of failure, and they get different answers. A wrong setting, a
 * host name that does not exist, a login the server refuses, a TLS connection
 * that cannot be made, stops the start: it will not fix itself, and found
 * here it costs a restart instead of the first invoice that never arrives. A
 * server that simply does not answer right now is the case the outbox is
 * for. The instance starts, says so in the log, and sends once the server is
 * back.
 *
 * A refused connection counts as not answering, although a wrong port looks
 * the same from here. The sentence in the log names both; stopping the start
 * over a mail server being restarted would be the worse mistake.
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
        throw new ConfigurationError(
          `Der Mailserver ${server} lehnt die Anmeldung ab. Stimmen SMTP_USER und ` +
            `SMTP_PASSWORD? Er antwortete: ${failure.message}`,
        )
      case 'EDNS':
        throw new ConfigurationError(
          `Den Mailserver "${configuration.host}" gibt es nicht, der Name lässt sich nicht ` +
            'auflösen. Stimmt SMTP_HOST?',
        )
      case 'ETLS':
      case 'EREQUIRETLS':
        throw new ConfigurationError(
          `Mit dem Mailserver ${server} kommt keine verschlüsselte Verbindung zustande: ` +
            `${failure.message}. Passt SMTP_SECURITY zum Port, "starttls" für 587, "tls" für 465?`,
        )
      case 'ECONFIG':
        throw new ConfigurationError(
          `Die Angaben zum Mailserver passen nicht zusammen: ${failure.message}`,
        )
      default:
        // A certificate the connection refuses arrives as a plain socket error
        // on port 465, where TLS starts with the first byte. It is a setting
        // all the same, and waiting will not make it right.
        if (/certificate|self[- ]signed|CERT_/i.test(failure.message)) {
          throw new ConfigurationError(
            `Das Zertifikat des Mailservers ${server} wird nicht anerkannt: ${failure.message}`,
          )
        }

        return {
          outcome: 'unreachable',
          reason:
            `Der Mailserver ${server} antwortet gerade nicht (${failure.message}). OpenGewerk ` +
            'startet trotzdem, und E-Mails warten im Postausgang, bis er wieder antwortet. ' +
            'Bleibt es dabei, stimmen vielleicht SMTP_HOST oder SMTP_PORT nicht.',
        }
    }
  }
}
