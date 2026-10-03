import type { DeadlineRegistry, TenantId } from '@opengewerk/domain'
import {
  type CycleReport,
  type Database,
  type InvitationLinkSource,
  type MailAttachment,
  type MailConfiguration,
  MailDeliveryError,
  type MailJob as FoundationMailJob,
  type MailTransport,
  type RepeatingJob,
  runMailCycle as runFoundationCycle,
  type SecretKey,
  startMailWorker as startFoundationWorker,
} from '@opengewerk/platform-server'

import { dueDeadlines, dueTasks, notify, signedReports } from '../notifications/notify.js'
import type { AttachmentSource } from './attachments.js'
import { outbox, type OutboxRow } from './outbox.js'
import { mailServersOfBusinesses } from './server-settings.js'

export type { CycleReport } from '@opengewerk/platform-server'

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
  /** The kinds of deadline, the instance's own unless a test brings others. */
  readonly deadlineKinds?: DeadlineRegistry
  readonly now?: () => Date
}

/** The sentences of the job that name a business. */
const sentences = {
  passwordUnreadable: (tenantId: TenantId) =>
    `Das Passwort zum Mailserver des Betriebs ${tenantId} lässt sich nicht mehr lesen, ` +
    'SESSION_SECRET wurde seit dem Speichern getauscht. Die E-Mails warten, bis es ' +
    'unter "E-Mail-Einstellungen" neu eingegeben ist.',
  tenantFailed: (tenantId: TenantId) => `Der Versand für den Betrieb ${tenantId} ist gescheitert.`,
}

/** The files a message carries, made or read now. Only a message about a document carries one. */
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

/**
 * The job of the foundation (ADR 0010) with the causes of this application:
 * a task due this morning, a report signed on site that is to go out, and a
 * deadline that has come. Written in the order the notifications raise them,
 * before what waits in the outbox is sent, so that something due in this
 * minute goes out in the same pass.
 */
function bound(job: MailJob): FoundationMailJob<OutboxRow> {
  return {
    database: job.database,
    servers: mailServersOfBusinesses,
    outbox,
    connect: job.connect,
    key: job.key,
    raise: async (tenantId, now) => {
      const raised = [
        ...(await dueTasks(job.database, tenantId, now)),
        ...(await signedReports(job.database, tenantId, now)),
        ...(await dueDeadlines(job.database, tenantId, now, job.deadlineKinds)),
      ]
      let written = 0

      for (const notification of raised) {
        const rows = await notify(job.database, tenantId, notification, {
          origin: job.origin,
          ...(job.deadlineKinds ? { deadlineKinds: job.deadlineKinds } : {}),
        })

        written += rows.length
      }

      return written
    },
    attachments: (row) => attachmentsOf(job, row),
    ...(job.invitationLinks ? { invitationLinks: job.invitationLinks } : {}),
    sentences,
    ...(job.now ? { now: job.now } : {}),
  }
}

/**
 * One pass over every business: first what has become due, then what is
 * waiting to be sent, each business through its own mail server. How a pass
 * goes is the foundation's, `runMailCycle` there.
 */
export function runMailCycle(job: MailJob): Promise<CycleReport> {
  return runFoundationCycle(bound(job))
}

/** Runs the job every minute, one pass after the other and never two at once. */
export function startMailWorker(job: MailJob, intervalMs = 60_000): RepeatingJob {
  return startFoundationWorker(bound(job), intervalMs)
}
