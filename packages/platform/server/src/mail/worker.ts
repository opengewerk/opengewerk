import type { TenantId } from '@opengewerk/platform-domain'

import type { Database } from '../database/database.js'
import { everyTenant } from '../database/every-tenant.js'
import type { OutboxMessage } from '../database/schema/mail-outbox.js'
import type { SecretKey } from '../secrets/key.js'
import { type RepeatingJob, startRepeating } from '../start/repeat.js'
import type { MailConfiguration } from './configuration.js'
import { type InvitationLinkSource, invitationLinkPlaceholder } from './invitation-link.js'
import type { MailOutboxStore } from './outbox.js'
import type { MailServers } from './server-settings.js'
import {
  type MailAttachment,
  MailDeliveryError,
  type MailTransport,
  type OutgoingMail,
} from './transport.js'

/** The sentences of the job that name a tenant, in the words of the application. */
export interface MailJobSentences {
  /**
   * The password to the mail server of a tenant no longer opens, because the
   * session secret has changed since it was sealed; with where it is entered
   * again. Said once, not in every pass.
   */
  readonly passwordUnreadable: (tenantId: TenantId) => string
  /** The pass for one tenant failed. The error follows in the log. */
  readonly tenantFailed: (tenantId: TenantId) => string
}

/** What the job needs, handed in so that a test can run it with a clock of its own. */
export interface MailJob<Message extends OutboxMessage = OutboxMessage> {
  readonly database: Database
  /** The mail servers of the tenants, for the connection of each. */
  readonly servers: Pick<MailServers, 'connectionOf'>
  /** The outbox of the application, bound by `mailOutboxStore`. */
  readonly outbox: MailOutboxStore<Message>
  /**
   * Opens the connection to the mail server of one tenant: `smtpTransport` in
   * a running instance, and in a test one that keeps what it is given.
   */
  readonly connect: (configuration: MailConfiguration) => MailTransport
  /** The key the password of each tenant's mail server is sealed with. */
  readonly key: SecretKey
  /**
   * Writes what has become due for one tenant into the outbox, before what is
   * waiting there is sent, and says how many messages it wrote. Which causes
   * there are is the application's. Asked only for a tenant with a mail
   * server, whether its password opens or not: a message waiting for a server
   * nobody set up would go out the day somebody does, about whatever was due
   * back then.
   */
  readonly raise?: (tenantId: TenantId, now: Date) => Promise<number>
  /**
   * The files a message carries, made or read as it goes out, so that the file
   * is the one its record keeps. Left out, no message carries one.
   */
  readonly attachments?: (message: Message) => Promise<readonly MailAttachment[]>
  /**
   * Where the link of an invitation comes from. Left out, a message about an
   * invitation cannot be sent and is given up on.
   */
  readonly invitationLinks?: InvitationLinkSource
  readonly sentences: MailJobSentences
  readonly now?: () => Date
}

/** What one pass did, for the tests and for nothing else. */
export interface CycleReport {
  readonly written: number
  readonly sent: number
  readonly retried: number
  readonly failed: number
}

/**
 * Failures that are about the server and not about one message. After one of
 * them the rest of a pass would only wait for the same timeout again, so they
 * are put back with the same answer instead of being tried.
 */
const serverWide = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'ETLS',
  'EAUTH',
  'ENOAUTH',
])

function outgoing(
  message: OutboxMessage,
  from: string,
  text: string,
  attachments: readonly MailAttachment[],
): OutgoingMail {
  return {
    from: { name: message.senderName, address: from },
    replyTo: message.replyTo,
    to: { name: message.recipientName, address: message.recipientAddress },
    subject: message.subject,
    text,
    attachments,
  }
}

/**
 * The text as it goes out. For a message about an invitation the link is put
 * in now, and made now; every other message goes out as it was written.
 */
async function textOf<Message extends OutboxMessage>(
  job: MailJob<Message>,
  message: Message,
): Promise<string> {
  if (message.invitationId === null) {
    return message.body
  }

  if (!job.invitationLinks) {
    throw new MailDeliveryError(
      'Für Einladungen ist in diesem Lauf nichts eingerichtet.',
      'EINVITATION',
      null,
    )
  }

  return message.body.replace(invitationLinkPlaceholder, await job.invitationLinks(message))
}

function asFailure(error: unknown): MailDeliveryError {
  return error instanceof MailDeliveryError
    ? error
    : new MailDeliveryError(error instanceof Error ? error.message : String(error), null, null)
}

/**
 * The tenants whose password does not open, already said in the log. So that
 * it is said once and not every minute; a tenant whose password opens again
 * is taken off, and would be told again the next time.
 */
const unreadableSaid = new Set<TenantId>()

/**
 * One pass over every tenant: first what has become due, then what is
 * waiting to be sent, each tenant through its own mail server.
 *
 * The order matters a little. Something that falls due in this minute is
 * written and then sent in the same pass, instead of a minute later.
 *
 * A tenant without a mail server is passed over whole, and nothing is
 * written for it either.
 *
 * A tenant whose pass fails does not stop the others. What went wrong goes
 * to the log, and the next pass tries again, because nothing was lost: a
 * message that was not sent is still in the outbox.
 */
export async function runMailCycle<Message extends OutboxMessage>(
  job: MailJob<Message>,
): Promise<CycleReport> {
  const clock = job.now ?? (() => new Date())
  const report = { written: 0, sent: 0, retried: 0, failed: 0 }

  for (const tenantId of await everyTenant(job.database)) {
    try {
      const connection = await job.servers.connectionOf(job.database, tenantId, job.key)

      if (connection === null) {
        continue
      }

      const now = clock()

      if (job.raise) {
        report.written += await job.raise(tenantId, now)
      }

      // Set up, and the password does not open: the session secret has
      // changed since it was sealed. The messages are written and wait, like
      // for a server that does not answer, and nothing is tried, because every
      // try would count against them with an answer that cannot change.
      if (connection.state === 'unreadable') {
        if (!unreadableSaid.has(tenantId)) {
          unreadableSaid.add(tenantId)
          console.warn(job.sentences.passwordUnreadable(tenantId))
        }

        continue
      }

      unreadableSaid.delete(tenantId)

      const actor = { tenantId, reason: 'mail' }
      const claimed = await job.database.forTenant(actor, (tx) => job.outbox.claimDue(tx, now))

      if (claimed.length === 0) {
        continue
      }

      const { configuration } = connection
      const transport = job.connect(configuration)
      let serverDown: MailDeliveryError | null = null

      try {
        for (const message of claimed) {
          let failure: MailDeliveryError | null = serverDown

          if (failure === null) {
            try {
              await transport.send(
                outgoing(
                  message,
                  configuration.from,
                  await textOf(job, message),
                  job.attachments ? await job.attachments(message) : [],
                ),
              )
              await job.database.forTenant(actor, (tx) =>
                job.outbox.markSent(tx, message.id, clock()),
              )
              report.sent += 1

              continue
            } catch (error) {
              failure = asFailure(error)

              if (failure.code !== null && serverWide.has(failure.code)) {
                serverDown = failure
              }
            }
          }

          const reported = failure
          const outcome = await job.database.forTenant(actor, (tx) =>
            job.outbox.markFailed(tx, message, reported, clock()),
          )

          if (outcome === 'failed') {
            report.failed += 1
            console.warn(
              `Eine E-Mail an ${message.recipientAddress} ließ sich nicht zustellen und wird ` +
                `nicht mehr versucht: ${reported.message}`,
            )
          } else {
            report.retried += 1
          }
        }
      } finally {
        transport.close()
      }

      if (serverDown) {
        console.warn(
          `Der Mailserver ${configuration.host} antwortet nicht (${serverDown.message}). Die ` +
            'E-Mails warten im Postausgang und werden später noch einmal versucht.',
        )
      }
    } catch (error) {
      console.error(job.sentences.tenantFailed(tenantId), error)
    }
  }

  return report
}

/**
 * Runs the job every minute, one pass after the other and never two at once.
 * The first pass comes a few seconds after the start, not during it, and
 * `stop` waits for a pass that is running, so that shutting down does not cut
 * a message off between sending it and writing down that it was sent.
 */
export function startMailWorker<Message extends OutboxMessage>(
  job: MailJob<Message>,
  intervalMs = 60_000,
): RepeatingJob {
  return startRepeating({
    run: () => runMailCycle(job),
    intervalMs,
    firstAfterMs: 5_000,
    failure: 'Der Versand von E-Mails ist gescheitert.',
  })
}
