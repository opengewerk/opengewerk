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
 *
 * Whoever raises one while putting a message together knows sometimes that
 * trying again cannot help, and says so with `permanent`: a file the message
 * is about that cannot be made out of content that will not change.
 */
export class MailDeliveryError extends Error {
  private readonly declaredPermanent: boolean

  constructor(
    message: string,
    readonly code: string | null,
    readonly responseCode: number | null,
    options: { readonly permanent?: boolean } = {},
  ) {
    super(message)
    this.declaredPermanent = options.permanent ?? false
  }

  /**
   * Whether trying again cannot help. A server that says no with a five
   * hundred to a recipient, or an address nobody can deliver to, will say the
   * same an hour later. Everything else, a timeout, a refused connection, a
   * login that failed because somebody is changing the password, may be gone
   * by then, and giving up on it would lose a message over a passing fault.
   */
  get permanent(): boolean {
    // `EINVITATION`: an invitation that was called back, used or has run out
    // gives no link, and it does not become open again. `EDESTINATION`: a
    // mail server in an internal network or on a port that is not for mail
    // stays where it is until somebody changes the settings.
    if (
      this.declaredPermanent ||
      this.code === 'EENVELOPE' ||
      this.code === 'EINVITATION' ||
      this.code === 'EDESTINATION'
    ) {
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
 * The one thing that talks to a mail server.
 *
 * Everything else writes a row into an outbox, and a test holds that nothing
 * but this file imports nodemailer. So there is one sender, one set of
 * timeouts and one place to look when a message did not arrive.
 */
export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>
  /** Connects, greets and signs in, and sends nothing. For the check of a connection. */
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
  /**
   * How long one message has, from the connection to the server's answer
   * that it took it. The other three wait for a step and for silence; a
   * server that answers a little at a time never runs into them, and the job
   * that sends the messages of every business one after the other waited for
   * it without end.
   */
  readonly whole?: number
}

const defaultTimeouts: Required<MailTimeouts> = {
  connection: 15_000,
  greeting: 15_000,
  socket: 60_000,
  whole: 120_000,
}

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
    // The name behind an address, for TLS. The connection goes to the address
    // that was checked and the certificate is still held against the name.
    servername: configuration.servername,
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
      const sending = transport.sendMail({
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
      // Settled later or never once the deadline has answered; nobody waits
      // for it then, and its end is no failure of the process.
      sending.catch(() => undefined)

      let deadline: NodeJS.Timeout | undefined

      try {
        await Promise.race([
          sending,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => {
              reject(
                new MailDeliveryError(
                  'Der Mailserver hat die Nachricht nicht in der Zeit angenommen, die eine Nachricht hat.',
                  'ETIMEDOUT',
                  null,
                ),
              )
            }, timeouts.whole ?? defaultTimeouts.whole)
          }),
        ])
      } catch (error) {
        throw asDeliveryError(error)
      } finally {
        clearTimeout(deadline)
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
