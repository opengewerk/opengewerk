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
 * What a refused certificate is about, read off the message Node gives. Named
 * rather than repeated, because the message carries the names in the
 * certificate of whoever answered.
 */
function certificateTrouble(message: string): string | null {
  if (!/certificate|self[- ]signed|CERT_|altnames/i.test(message)) {
    return null
  }

  if (/expired/i.test(message)) {
    return 'ist abgelaufen'
  }

  if (/self[- ]signed/i.test(message)) {
    return 'ist selbst ausgestellt'
  }

  if (/altnames|does not match/i.test(message)) {
    return 'gilt für einen anderen Namen'
  }

  return 'wird nicht anerkannt'
}

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
 *
 * What the other side said is never repeated, only what kind of answer it
 * was and the three digits of an SMTP reply (GHSA-5664-h6fc-v729). A service
 * that is no mail server answers with its own greeting, and a check that
 * printed it would be a way of reading greetings. Where the transport refuses
 * the destination itself, the sentence is ours and is given as it is.
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
    const replied =
      failure.responseCode === null ? '' : ` Er antwortete mit ${String(failure.responseCode)}.`

    switch (failure.code) {
      case 'EDESTINATION':
        return { outcome: 'refused', reason: failure.message }
      case 'EAUTH':
      case 'ENOAUTH':
        return {
          outcome: 'refused',
          reason:
            `Der Mailserver ${server} lehnt die Anmeldung ab. Stimmen Benutzername und ` +
            `Passwort?${replied}`,
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
            `Mit dem Mailserver ${server} kommt keine verschlüsselte Verbindung zustande. ` +
            `Passt die Verschlüsselung zum Port, STARTTLS für 587, TLS für 465?${replied}`,
        }
      case 'ECONFIG':
        // Written by the transport about the settings it was handed, not by
        // the server, so it may be repeated.
        return {
          outcome: 'refused',
          reason: `Die Angaben zum Mailserver passen nicht zusammen: ${failure.message}`,
        }
      default: {
        // A certificate the connection refuses arrives as a plain socket error
        // on port 465, where TLS starts with the first byte. It is a setting
        // all the same, and waiting will not make it right.
        const certificate = certificateTrouble(failure.message)

        if (certificate) {
          return {
            outcome: 'refused',
            reason: `Das Zertifikat des Mailservers ${server} ${certificate}.`,
          }
        }

        if (failure.code === 'EPROTOCOL') {
          return {
            outcome: 'refused',
            reason:
              `Unter ${server} antwortet etwas, aber kein Mailserver. Stimmen Server und Port?` +
              replied,
          }
        }

        return {
          outcome: 'unreachable',
          reason:
            `Der Mailserver ${server} antwortet nicht` +
            (failure.code ? ` (${failure.code})` : '') +
            '. Vielleicht startet er gerade neu, vielleicht stimmen Server oder Port nicht.',
        }
      }
    }
  }
}
