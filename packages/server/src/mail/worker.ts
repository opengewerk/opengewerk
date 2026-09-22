import type { TenantId } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { dueTasks, notify, signedReports } from '../notifications/notify.js'
import { invitationLink } from '../notifications/templates.js'
import type { SecretKey } from '../secrets/key.js'
import type { AttachmentSource } from './attachments.js'
import type { MailConfiguration } from './configuration.js'
import type { InvitationLinkSource } from './invitation-link.js'
import { claimDue, markFailed, markSent, type OutboxRow } from './outbox.js'
import { connectionOf } from './server-settings.js'
import {
  type MailAttachment,
  MailDeliveryError,
  type MailTransport,
  type OutgoingMail,
} from './transport.js'

/** What the job needs, handed in so that a test can run it with a clock of its own. */
export interface MailJob {
  readonly database: Database
  /**
   * Opens the connection to the mail server of one business: `smtpTransport`
   * in a running instance, and in a test one that keeps what it is given.
   */
  readonly connect: (configuration: MailConfiguration) => MailTransport
  /** The key the password of each business's mail server is sealed with. */
  readonly key: SecretKey
  /** Where the instance is reached, for the links in a message. */
  readonly origin: string
  /**
   * Where the file a message about a document carries comes from. Left out,
   * such a message cannot be sent and waits, which is what a test that never
   * sends a document wants.
   */
  readonly attachments?: AttachmentSource
  /** Where the link of an invitation comes from, made when its message goes out. */
  readonly invitationLinks?: InvitationLinkSource
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

/**
 * The businesses on this instance.
 *
 * The job works for all of them and acts for no person, so it has no
 * membership to find them through. `every_tenant()` is the one question it
 * may ask outside a business, and it answers with identifiers only; every
 * read after that goes through `forTenant` like any other.
 */
async function everyTenant(database: Database): Promise<readonly TenantId[]> {
  const result = await database.forInstance((tx) => tx.execute(sql`select every_tenant() as id`))

  return result.rows.map((row) => row['id'] as TenantId)
}

function outgoing(
  row: OutboxRow,
  from: string,
  text: string,
  attachments: readonly MailAttachment[],
): OutgoingMail {
  return {
    from: { name: row.senderName, address: from },
    replyTo: row.replyTo,
    to: { name: row.recipientName, address: row.recipientAddress },
    subject: row.subject,
    text,
    attachments,
  }
}

/**
 * The text as it goes out. For an invitation the link is put in now, and
 * made now; every other message goes out as it was written.
 */
async function textOf(job: MailJob, row: OutboxRow): Promise<string> {
  if (row.kind !== 'invitation') {
    return row.body
  }

  if (!job.invitationLinks) {
    throw new MailDeliveryError(
      'Für Einladungen ist in diesem Lauf nichts eingerichtet.',
      'EINVITATION',
      null,
    )
  }

  return row.body.replace(invitationLink, await job.invitationLinks(row))
}

/** The files a message carries, made or read now. */
async function attachmentsOf(job: MailJob, row: OutboxRow): Promise<readonly MailAttachment[]> {
  if (row.kind !== 'document') {
    return []
  }

  if (!job.attachments) {
    throw new MailDeliveryError(
      'Für Anhänge ist in diesem Lauf nichts eingerichtet.',
      'EATTACHMENT',
      null,
    )
  }

  return job.attachments(row)
}

function asFailure(error: unknown): MailDeliveryError {
  return error instanceof MailDeliveryError
    ? error
    : new MailDeliveryError(error instanceof Error ? error.message : String(error), null, null)
}

/**
 * The businesses whose password does not open, already said in the log. So
 * that it is said once and not every minute; a business whose password opens
 * again is taken off, and would be told again the next time.
 */
const unreadableSaid = new Set<TenantId>()

/**
 * One pass over every business: first what has become due, then what is
 * waiting to be sent, each business through its own mail server.
 *
 * The order matters a little. A task that falls due in this minute is written
 * and then sent in the same pass, instead of a minute later.
 *
 * A business without a mail server is passed over whole. Nothing is written
 * for it either: a message waiting for a server nobody set up would go out the
 * day somebody does, about whatever was due back then.
 *
 * A business whose pass fails does not stop the others. What went wrong goes
 * to the log, and the next pass tries again, because nothing was lost: a
 * message that was not sent is still in the outbox.
 */
export async function runMailCycle(job: MailJob): Promise<CycleReport> {
  const clock = job.now ?? (() => new Date())
  const report = { written: 0, sent: 0, retried: 0, failed: 0 }

  for (const tenantId of await everyTenant(job.database)) {
    try {
      const connection = await connectionOf(job.database, tenantId, job.key)

      if (connection === null) {
        continue
      }

      const now = clock()

      const raised = [
        ...(await dueTasks(job.database, tenantId, now)),
        ...(await signedReports(job.database, tenantId, now)),
      ]

      for (const notification of raised) {
        const written = await notify(job.database, tenantId, notification, {
          origin: job.origin,
        })

        report.written += written.length
      }

      // Set up, and the password does not open: SESSION_SECRET has changed
      // since it was sealed. The messages are written and wait, like for a
      // server that does not answer, and nothing is tried, because every try
      // would count against them with an answer that cannot change.
      if (connection.state === 'unreadable') {
        if (!unreadableSaid.has(tenantId)) {
          unreadableSaid.add(tenantId)
          console.warn(
            `Das Passwort zum Mailserver des Betriebs ${tenantId} lässt sich nicht mehr lesen, ` +
              'SESSION_SECRET wurde seit dem Speichern getauscht. Die E-Mails warten, bis es ' +
              'unter "E-Mail-Einstellungen" neu eingegeben ist.',
          )
        }

        continue
      }

      unreadableSaid.delete(tenantId)

      const actor = { tenantId, reason: 'mail' }
      const claimed = await job.database.forTenant(actor, (tx) => claimDue(tx, now))

      if (claimed.length === 0) {
        continue
      }

      const { configuration } = connection
      const transport = job.connect(configuration)
      let serverDown: MailDeliveryError | null = null

      try {
        for (const row of claimed) {
          let failure: MailDeliveryError | null = serverDown

          if (failure === null) {
            try {
              await transport.send(
                outgoing(
                  row,
                  configuration.from,
                  await textOf(job, row),
                  await attachmentsOf(job, row),
                ),
              )
              await job.database.forTenant(actor, (tx) => markSent(tx, row.id, clock()))
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
            markFailed(tx, row, reported, clock()),
          )

          if (outcome === 'failed') {
            report.failed += 1
            console.warn(
              `Eine E-Mail an ${row.recipientAddress} ließ sich nicht zustellen und wird nicht ` +
                `mehr versucht: ${reported.message}`,
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
      console.error(`Der Versand für den Betrieb ${tenantId} ist gescheitert.`, error)
    }
  }

  return report
}

/**
 * Runs the job every minute, one pass after the other and never two at once.
 *
 * A pass that takes longer than the interval, because a mail server takes
 * its time, simply delays the next one. The first pass comes a few seconds
 * after the start, not during it.
 *
 * `stop` waits for a pass that is running, so that shutting down does not cut
 * a message off between sending it and writing down that it was sent.
 */
export function startMailWorker(
  job: MailJob,
  intervalMs = 60_000,
): { readonly stop: () => Promise<void> } {
  let stopped = false
  let running: Promise<void> | null = null
  let timer: NodeJS.Timeout | null = null

  const schedule = (delay: number) => {
    timer = setTimeout(tick, delay)
    timer.unref()
  }

  function tick() {
    running = runMailCycle(job)
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error('Der Versand von E-Mails ist gescheitert.', error)
      })
      .finally(() => {
        running = null

        if (!stopped) {
          schedule(intervalMs)
        }
      })
  }

  schedule(5_000)

  return {
    stop: async () => {
      stopped = true

      if (timer) {
        clearTimeout(timer)
      }

      await running
    },
  }
}
