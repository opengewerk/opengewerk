import { createTransport } from 'nodemailer'

import type { MailConfiguration } from './configuration.js'

/** A file that goes along with a message. */
export interface MailAttachment {
  readonly filename: string
  readonly content: Uint8Array
  readonly contentType: string
}

/** One message as it leaves, fully put together. */
export interface OutgoingMail {
  readonly from: { readonly name: string; readonly address: string }
  readonly replyTo: string | null
  readonly to: { readonly name: string | null; readonly address: string }
  readonly subject: string
  readonly text: string
  readonly attachments: readonly MailAttachment[]
}

/**
 * Why a message did not go out, with what the mail server or the connection
 * said. `code` is nodemailer's (`EAUTH`, `ETIMEDOUT`, `EDNS` and so on), and
 * `responseCode` the three digits of the server's answer when there was one.
 */
export class MailDeliveryError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly responseCode: number | null,
  ) {
    super(message)
  }

  /**
   * Whether trying again cannot help. A server that says no with a five
   * hundred to a recipient, or an address nobody can deliver to, will say the
   * same an hour later. Everything else, a timeout, a refused connection, a
   * login that failed because somebody is changing the password, may be gone
   * by then, and giving up on it would lose a message over a passing fault.
   */
  get permanent(): boolean {
    // `EDOCUMENT` is ours: the document a message is about has no file to
    // give, a draft or one that lacks what its e-invoice needs. Trying again
    // an hour later makes the same file out of the same frozen content.
    // `EINVITATION` too: an invitation that was called back, used or has run
    // out gives no link, and it does not become open again.
    if (this.code === 'EENVELOPE' || this.code === 'EDOCUMENT' || this.code === 'EINVITATION') {
      return true
    }

    return (
      this.code !== 'EAUTH' &&
      this.responseCode !== null &&
      this.responseCode >= 500 &&
      this.responseCode < 600
    )
  }
}

/**
 * The one thing in this code base that talks to a mail server.
 *
 * Everything else writes a row into the outbox, and a test holds that nothing
 * outside `mail/` imports nodemailer. So there is one sender, one set of
 * timeouts and one place to look when a message did not arrive.
 */
export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>
  /** Connects, greets and signs in, and sends nothing. For the check at startup. */
  verify(): Promise<void>
  close(): void
}

function asDeliveryError(error: unknown): MailDeliveryError {
  if (error instanceof MailDeliveryError) {
    return error
  }

  const detail = (error ?? {}) as { message?: unknown; code?: unknown; responseCode?: unknown }

  return new MailDeliveryError(
    typeof detail.message === 'string' ? detail.message : String(error),
    typeof detail.code === 'string' ? detail.code : null,
    typeof detail.responseCode === 'number' ? detail.responseCode : null,
  )
}

/** How long the transport waits, in milliseconds. A test shortens them. */
export interface MailTimeouts {
  readonly connection: number
  readonly greeting: number
  readonly socket: number
}

const defaultTimeouts: MailTimeouts = { connection: 15_000, greeting: 15_000, socket: 60_000 }

/**
 * The transport for a configured instance.
 *
 * Timeouts are short on purpose. nodemailer waits two minutes for a greeting
 * by default, and a job that sends one message after the other would sit for
 * that long on every message while the server is gone; the outbox is what
 * waits, not the connection.
 *
 * File and URL access are switched off. Attachments are handed over as bytes,
 * and a message is never meant to make this process read a path or fetch an
 * address named somewhere in its content.
 */
export function smtpTransport(
  configuration: MailConfiguration,
  timeouts: MailTimeouts = defaultTimeouts,
): MailTransport {
  const transport = createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.security === 'tls',
    requireTLS: configuration.security === 'starttls',
    ignoreTLS: configuration.security === 'none',
    auth:
      configuration.user !== null && configuration.password !== null
        ? { user: configuration.user, pass: configuration.password }
        : undefined,
    connectionTimeout: timeouts.connection,
    greetingTimeout: timeouts.greeting,
    socketTimeout: timeouts.socket,
    disableFileAccess: true,
    disableUrlAccess: true,
  })

  return {
    async send(mail) {
      try {
        await transport.sendMail({
          from: { name: mail.from.name, address: mail.from.address },
          replyTo: mail.replyTo ?? undefined,
          to: mail.to.name ? { name: mail.to.name, address: mail.to.address } : mail.to.address,
          subject: mail.subject,
          text: mail.text,
          attachments: mail.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: Buffer.from(attachment.content),
            contentType: attachment.contentType,
          })),
        })
      } catch (error) {
        throw asDeliveryError(error)
      }
    },
    async verify() {
      try {
        await transport.verify()
      } catch (error) {
        throw asDeliveryError(error)
      }
    },
    close() {
      transport.close()
    },
  }
}
