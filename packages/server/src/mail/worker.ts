import type { TenantId } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { dueTasks, notify, signedReports } from '../notifications/notify.js'
import { invitationLink } from '../notifications/templates.js'
import type { AttachmentSource } from './attachments.js'
import type { InvitationLinkSource } from './invitation-link.js'
import { claimDue, markFailed, markSent, type OutboxRow } from './outbox.js'
import {
  type MailAttachment,
  MailDeliveryError,
  type MailTransport,
  type OutgoingMail,
} from './transport.js'

/** What the job needs, handed in so that a test can run it with a clock of its own. */
export interface MailJob {
  readonly database: Database
  readonly transport: MailTransport
  /** `MAIL_FROM`, the address every message leaves from. */
  readonly from: string
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
 * One pass over every business: first what has become due, then what is
 * waiting to be sent.
 *
 * The order matters a little. A task that falls due in this minute is written
 * and then sent in the same pass, instead of a minute later.
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

      const actor = { tenantId, reason: 'mail' }
      const claimed = await job.database.forTenant(actor, (tx) => claimDue(tx, now))
      let serverDown: MailDeliveryError | null = null

      for (const row of claimed) {
        let failure: MailDeliveryError | null = serverDown

        if (failure === null) {
          try {
            await job.transport.send(
              outgoing(row, job.from, await textOf(job, row), await attachmentsOf(job, row)),
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

      if (serverDown) {
        console.warn(
          `Der Mailserver antwortet nicht (${serverDown.message}). Die E-Mails warten im ` +
            'Postausgang und werden später noch einmal versucht.',
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
