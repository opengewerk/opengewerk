import type { TenantId } from '@opengewerk/platform-domain'

import type { Database } from '../database/database.js'
import { everyTenant } from '../database/every-tenant.js'
import { type RepeatingJob, startRepeating } from '../start/repeat.js'
import { deliver } from './deliver.js'
import type { PushStore } from './outbox.js'
import type { PushPost } from './post.js'
import type { VapidKeys } from './web-push.js'

/** The sentence of the job that names a tenant, in the words of the application. */
export interface PushJobSentences {
  /** The pass for one tenant failed. The error follows in the log. */
  readonly tenantFailed: (tenantId: TenantId) => string
}

/** What the job needs, handed in so that a test can bring a push service and a clock of its own. */
export interface PushJob<Entry extends string = string, Occasion extends string = string> {
  readonly database: Database
  readonly vapid: VapidKeys
  readonly post: PushPost
  /** The devices and messages of the application, bound by `pushStore`. */
  readonly store: PushStore<Entry, Occasion>
  /**
   * Writes what has become due for one tenant as push messages, before what
   * is waiting is sent, and says how many it wrote. Which occasions there are
   * is the application's. Asked only for a tenant where somebody takes push.
   */
  readonly raise?: (tenantId: TenantId, now: Date) => Promise<number>
  readonly sentences: PushJobSentences
  readonly now?: () => Date
}

/** What a pass did, for the tests and for nothing else. */
export interface PushReport {
  readonly written: number
  readonly sent: number
  readonly retried: number
  readonly failed: number
  /** Devices taken off because their browser or their session is gone. */
  readonly forgotten: number
}

/** What sending needs of a store, the same whatever an application's entries and occasions are. */
export type DeliveringStore = Pick<
  PushStore,
  'claimDue' | 'giveUpLate' | 'markSent' | 'markFailed' | 'forget'
>

/** What sending needs: the database, the key and the way out, and the store. */
export interface PushSending {
  readonly database: Database
  readonly vapid: VapidKeys
  readonly post: PushPost
  readonly store: DeliveringStore
}

function empty(): { -readonly [Key in keyof PushReport]: PushReport[Key] } {
  return { written: 0, sent: 0, retried: 0, failed: 0, forgotten: 0 }
}

/**
 * Sends what is due in one tenant, or only the messages named, and writes
 * down what became of each: sent, tried again later, given up, or the device
 * taken off because its subscription is gone.
 */
export async function sendDuePush(
  job: PushSending,
  tenantId: TenantId,
  now: Date,
  only?: readonly string[],
): Promise<PushReport> {
  const report = empty()
  const actor = { tenantId, reason: 'push' }
  const claimed = await job.database.forTenant(actor, async (tx) => {
    report.failed += await job.store.giveUpLate(tx, now)

    return job.store.claimDue(tx, now, only)
  })

  for (const { message, subscription } of claimed) {
    const outcome = await deliver(
      job.post,
      subscription,
      { title: message.title, body: message.body, url: message.url, tag: message.cause },
      job.vapid,
      now,
      (message.expiresAt.getTime() - now.getTime()) / 1000,
    )

    switch (outcome.kind) {
      case 'sent':
        await job.database.forTenant(actor, (tx) => job.store.markSent(tx, message.id, now))
        report.sent += 1
        break
      case 'gone':
        // The device goes, and its messages with it. It subscribes again the
        // next time the application is opened there with push on.
        await job.database.forTenant(actor, (tx) => job.store.forget(tx, subscription.id))
        report.forgotten += 1
        break
      case 'retry':
      case 'refused': {
        const result = await job.database.forTenant(actor, (tx) =>
          job.store.markFailed(
            tx,
            message,
            {
              reason: outcome.reason,
              permanent: outcome.kind === 'refused',
              afterSeconds: outcome.kind === 'retry' ? outcome.afterSeconds : null,
            },
            now,
          ),
        )

        if (result === 'failed') {
          report.failed += 1
          console.warn(`Eine Push-Nachricht wird nicht mehr versucht: ${outcome.reason}`)
        } else {
          report.retried += 1
        }

        break
      }
    }
  }

  return report
}

/**
 * One pass over every tenant where somebody takes push: take off the devices
 * that were signed out, write what has become due, send what is waiting. A
 * tenant whose pass fails does not stop the others.
 */
export async function runPushCycle<Entry extends string, Occasion extends string>(
  job: PushJob<Entry, Occasion>,
): Promise<PushReport> {
  const clock = job.now ?? (() => new Date())
  const total = empty()

  for (const tenantId of await everyTenant(job.database)) {
    try {
      const anybody = await job.database.forTenant({ tenantId, reason: 'push' }, (tx) =>
        job.store.anyDevice(tx),
      )

      if (!anybody) {
        continue
      }

      const now = clock()

      total.forgotten += await job.store.forgetSignedOut(job.database, tenantId, now)

      if (job.raise) {
        total.written += await job.raise(tenantId, now)
      }

      // The clock asked again: a message raised a moment ago carries the
      // moment the database wrote it, a little after `now`, and would
      // otherwise wait for the next pass.
      const sent = await sendDuePush(job, tenantId, clock())

      total.sent += sent.sent
      total.retried += sent.retried
      total.failed += sent.failed
      total.forgotten += sent.forgotten
    } catch (error) {
      console.error(job.sentences.tenantFailed(tenantId), error)
    }
  }

  return total
}

/** Runs the job every minute, one pass after the other and never two at once, as the mail job does. */
export function startPushWorker<Entry extends string, Occasion extends string>(
  job: PushJob<Entry, Occasion>,
  intervalMs = 60_000,
): RepeatingJob {
  return startRepeating({
    run: () => runPushCycle(job),
    intervalMs,
    firstAfterMs: 15_000,
    failure: 'Der Versand von Push-Nachrichten ist gescheitert.',
  })
}
