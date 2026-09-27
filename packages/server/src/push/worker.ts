import type { DeadlineRegistry, TenantId } from '@opengewerk/domain'
import { eq, isNotNull } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { everyTenant } from '../database/every-tenant.js'
import { pushSubscriptions } from '../database/schema/index.js'
import { dueDeadlines, dueTasks } from '../notifications/notify.js'
import { notifyPush, signedIn } from '../notifications/push.js'
import { deliver } from './deliver.js'
import { claimDuePush, giveUpLatePush, markPushFailed, markPushSent } from './outbox.js'
import type { PushPost } from './post.js'
import type { VapidKeys } from './web-push.js'

/** What the job needs, handed in so that a test can bring a push service and a clock of its own. */
export interface PushJob {
  readonly database: Database
  readonly vapid: VapidKeys
  readonly post: PushPost
  /** The kinds of deadline, the instance's own unless a test brings others. */
  readonly deadlineKinds?: DeadlineRegistry
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

function empty(): { -readonly [Key in keyof PushReport]: PushReport[Key] } {
  return { written: 0, sent: 0, retried: 0, failed: 0, forgotten: 0 }
}

/**
 * Takes off the devices of this business whose session no longer exists. The
 * browser still holds its subscription, but nobody is signed in there any
 * more, and a message would tell whoever picks the telephone up next what is
 * due in the business.
 */
async function forgetSignedOut(job: PushJob, tenantId: TenantId, now: Date): Promise<number> {
  const actor = { tenantId, reason: 'push' }
  const bound = await job.database.forTenant(actor, (tx) =>
    tx.select().from(pushSubscriptions).where(isNotNull(pushSubscriptions.sessionId)),
  )

  if (bound.length === 0) {
    return 0
  }

  const alive = new Set((await signedIn(job.database, bound, now)).map((device) => device.id))
  const gone = bound.filter((device) => !alive.has(device.id))

  for (const device of gone) {
    await job.database.forTenant(actor, (tx) =>
      tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id)),
    )
  }

  return gone.length
}

/**
 * Sends what is due in one business, or only the messages named, and writes
 * down what became of each: sent, tried again later, given up, or the device
 * taken off because its subscription is gone.
 */
export async function sendDuePush(
  job: PushJob,
  tenantId: TenantId,
  now: Date,
  only?: readonly string[],
): Promise<PushReport> {
  const report = empty()
  const actor = { tenantId, reason: 'push' }
  const claimed = await job.database.forTenant(actor, async (tx) => {
    report.failed += await giveUpLatePush(tx, now)

    return claimDuePush(tx, now, only)
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
        await job.database.forTenant(actor, (tx) => markPushSent(tx, message.id, now))
        report.sent += 1
        break
      case 'gone':
        // The device goes, and its messages with it. It subscribes again the
        // next time OpenGewerk is opened there with push on.
        await job.database.forTenant(actor, (tx) =>
          tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id)),
        )
        report.forgotten += 1
        break
      case 'retry':
      case 'refused': {
        const result = await job.database.forTenant(actor, (tx) =>
          markPushFailed(
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
 * One pass over every business that has a device taking push messages: take
 * off the devices that were signed out, write what has become due, send what
 * is waiting. A business whose pass fails does not stop the others.
 */
export async function runPushCycle(job: PushJob): Promise<PushReport> {
  const clock = job.now ?? (() => new Date())
  const total = empty()

  for (const tenantId of await everyTenant(job.database)) {
    try {
      const [device] = await job.database.forTenant({ tenantId, reason: 'push' }, (tx) =>
        tx.select({ id: pushSubscriptions.id }).from(pushSubscriptions).limit(1),
      )

      if (!device) {
        continue
      }

      const now = clock()

      total.forgotten += await forgetSignedOut(job, tenantId, now)

      const raised = [
        ...(await dueTasks(job.database, tenantId, now, 'push')),
        ...(await dueDeadlines(job.database, tenantId, now, job.deadlineKinds, 'push')),
      ]

      for (const notification of raised) {
        total.written += (
          await notifyPush(job.database, tenantId, notification, {
            now,
            ...(job.deadlineKinds ? { deadlineKinds: job.deadlineKinds } : {}),
          })
        ).length
      }

      const sent = await sendDuePush(job, tenantId, now)

      total.sent += sent.sent
      total.retried += sent.retried
      total.failed += sent.failed
      total.forgotten += sent.forgotten
    } catch (error) {
      console.error(
        `Die Push-Nachrichten des Betriebs ${tenantId} ließen sich nicht senden.`,
        error,
      )
    }
  }

  return total
}

/**
 * Runs the job every minute, one pass after the other and never two at once,
 * as the mail job does. `stop` waits for a pass that is running.
 */
export function startPushWorker(
  job: PushJob,
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
    running = runPushCycle(job)
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error('Der Versand von Push-Nachrichten ist gescheitert.', error)
      })
      .finally(() => {
        running = null

        if (!stopped) {
          schedule(intervalMs)
        }
      })
  }

  schedule(15_000)

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
