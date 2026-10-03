import {
  addDays,
  type DeadlineKind,
  type DeadlineRegistry,
  type DeadlineSetting,
  intervalOf,
  type IsoDate,
  leadOf,
  remindOn,
  taskTitleOf,
  type TenantId,
} from '@opengewerk/domain'
import {
  type Database,
  everyTenant,
  type RepeatingJob,
  startRepeating,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'

import { assignNumber } from '../database/number-ranges.js'
import { deadlines, jobs, tasks } from '../database/schema/index.js'
import { berlinClock, dueTasksFromMinute } from '../notifications/notify.js'
import { deadlineKinds } from './registry.js'
import { responsibleFor } from './responsible.js'
import { settingsOf } from './settings.js'
import { deadlineSourceQueries, type ExpectedDeadline, type SourceQuery } from './sources.js'

export type DeadlineRow = typeof deadlines.$inferSelect

/**
 * What the action `status` does for a kind: a change of state at its source,
 * in the transaction that marks the deadline reminded. A kind that names the
 * action brings its handler; a kind without one stops the run with an error
 * rather than claim it changed something.
 */
export type StatusHandler = (tx: TenantTransaction, deadline: DeadlineRow) => Promise<void>

/**
 * The status handlers of the kinds this instance knows, by kind. None of the
 * kinds shipped so far changes a state at its source; the first ones come
 * with the contracts of phase 2 and the subcontractors of phase 4.
 */
export const statusHandlers: Readonly<Record<string, StatusHandler>> = {}

/** What the engine needs, handed in so that a test can bring kinds, sources and a clock of its own. */
export interface DeadlineJob {
  readonly database: Database
  readonly registry?: DeadlineRegistry
  readonly sources?: Readonly<Record<string, SourceQuery>>
  readonly statusHandlers?: Readonly<Record<string, StatusHandler>>
  readonly now?: () => Date
}

/** What one pass did, for the tests and for nothing else. */
export interface DeadlineReport {
  readonly created: number
  readonly moved: number
  readonly dropped: number
  readonly reopened: number
  readonly reminded: number
}

/** The due day a source asks for: the day it names, or its anchor and the interval of the kind. */
function dueOf(
  kind: DeadlineKind,
  setting: DeadlineSetting | null,
  expected: ExpectedDeadline,
): IsoDate {
  return expected.namedDueOn ?? addDays(expected.anchorOn, intervalOf(kind, setting) ?? 0)
}

/** The values a deadline takes over from its source on every pass. */
function fromSource(expected: ExpectedDeadline, dueOn: IsoDate) {
  return {
    sourceLabel: expected.sourceLabel,
    documentId: expected.documentId,
    installationId: expected.installationId,
    customerId: expected.customerId,
    siteId: expected.siteId,
    jobId: expected.jobId,
    anchorOn: expected.anchorOn,
    dueOn,
    naturalUserId: expected.naturalUserId,
  }
}

function differs(current: DeadlineRow, next: ReturnType<typeof fromSource>): boolean {
  return (
    current.sourceLabel !== next.sourceLabel ||
    current.documentId !== next.documentId ||
    current.installationId !== next.installationId ||
    current.customerId !== next.customerId ||
    current.siteId !== next.siteId ||
    current.jobId !== next.jobId ||
    current.anchorOn !== next.anchorOn ||
    current.dueOn !== next.dueOn ||
    current.naturalUserId !== next.naturalUserId
  )
}

/**
 * Brings the deadlines of one business in line with their sources.
 *
 * A source that asks for a deadline nobody keeps gets one. An open deadline
 * follows its source: a new day, a new number, another customer. One whose
 * source asks no more drops out, and comes back when the source asks again:
 * a follow-up draft thrown away opens the quote once more. One a person has
 * marked done stays done, unless its source starts over from a new day; the
 * business changing the interval of the kind moves only the open ones, since
 * a done deadline was done for its day.
 *
 * And a deadline whose reminder made a task that is done is done as well:
 * whoever did the task has done what the deadline asked, and nobody should
 * have to say so twice.
 */
export async function reconcile(
  tx: TenantTransaction,
  tenantId: TenantId,
  registry: DeadlineRegistry,
  sources: Readonly<Record<string, SourceQuery>>,
  now: Date,
): Promise<Omit<DeadlineReport, 'reminded'>> {
  const report = { created: 0, moved: 0, dropped: 0, reopened: 0 }
  const settings = await settingsOf(tx)
  const kept = await tx.select().from(deadlines)

  for (const kind of registry.kinds) {
    const query = sources[kind.source]

    if (!query) {
      throw new Error(`No source ${kind.source} for the deadline kind ${kind.key}`)
    }

    const setting = settings.get(kind.key) ?? null
    const bySource = new Map(
      kept.filter((row) => row.kind === kind.key).map((row) => [row.sourceId as string, row]),
    )

    for (const expected of await query(tx)) {
      const next = fromSource(expected, dueOf(kind, setting, expected))
      const current = bySource.get(expected.sourceId)
      bySource.delete(expected.sourceId)

      if (!current) {
        await tx.insert(deadlines).values({
          tenantId,
          kind: kind.key,
          sourceId: expected.sourceId as DeadlineRow['sourceId'],
          ...next,
        })
        report.created += 1

        continue
      }

      const reopen =
        current.status === 'dropped' ||
        (current.status === 'done' && current.anchorOn !== next.anchorOn)

      if (reopen) {
        await tx
          .update(deadlines)
          .set({ ...next, status: 'open', closedAt: null, closedBy: null, updatedAt: now })
          .where(eq(deadlines.id, current.id))
        report.reopened += 1
      } else if (current.status === 'open' && differs(current, next)) {
        await tx
          .update(deadlines)
          .set({ ...next, updatedAt: now })
          .where(eq(deadlines.id, current.id))
        report.moved += 1
      }
    }

    const gone = [...bySource.values()].filter((row) => row.status === 'open')

    if (gone.length > 0) {
      await tx
        .update(deadlines)
        .set({ status: 'dropped', closedAt: now, closedBy: null, updatedAt: now })
        .where(
          inArray(
            deadlines.id,
            gone.map((row) => row.id),
          ),
        )
      report.dropped += gone.length
    }
  }

  // The task its reminder made is done: so is the deadline, by whoever did it.
  await tx.execute(sql`
    update ${deadlines}
       set status = 'done', closed_at = ${now}, closed_by = done_task.updated_by, updated_at = ${now}
      from ${tasks} as done_task
     where done_task.id = ${deadlines.taskId}
       and done_task.tenant_id = ${deadlines.tenantId}
       and done_task.status = 'done'
       and ${deadlines.status} = 'open'
       and ${deadlines.remindedFor} = ${deadlines.dueOn}
  `)

  return report
}

/**
 * Carries out the actions of one deadline whose lead has come, once.
 *
 * The update that marks it reminded for its due day is the claim: of two runs
 * at the same moment one gets the row back and the other nothing, and the one
 * that gets it does the rest in the same transaction. If any action fails,
 * the whole of it rolls back, the mark included, and the next run tries again.
 */
async function remindOne(
  tx: TenantTransaction,
  tenantId: TenantId,
  kind: DeadlineKind,
  setting: DeadlineSetting | null,
  deadline: DeadlineRow,
  handlers: Readonly<Record<string, StatusHandler>>,
  now: Date,
): Promise<boolean> {
  const [claimed] = await tx
    .update(deadlines)
    .set({ remindedFor: deadline.dueOn, remindedAt: now, updatedAt: now })
    .where(
      and(
        eq(deadlines.id, deadline.id),
        eq(deadlines.status, 'open'),
        eq(deadlines.dueOn, deadline.dueOn),
        or(isNull(deadlines.remindedFor), ne(deadlines.remindedFor, deadline.dueOn)),
      ),
    )
    .returning()

  if (!claimed) {
    return false
  }

  const responsible = await responsibleFor(tx, tenantId, kind, setting, claimed)

  for (const action of kind.actions) {
    switch (action) {
      case 'task': {
        if (responsible === null) {
          break
        }

        // Written by nobody: the transaction acts for no person, and the
        // trigger of 0019 leaves `created_by` empty (#80).
        const [task] = await tx
          .insert(tasks)
          .values({
            tenantId,
            title: taskTitleOf(kind, claimed.sourceLabel),
            notes: kind.title,
            dueOn: claimed.dueOn,
            assigneeUserId: responsible,
            customerId: claimed.customerId,
            siteId: claimed.siteId,
            jobId: claimed.jobId,
          })
          .returning({ id: tasks.id })

        if (task) {
          await tx.update(deadlines).set({ taskId: task.id }).where(eq(deadlines.id, claimed.id))
        }

        break
      }
      case 'reminder':
        // Written by the jobs that send, the one for mail and the one for
        // push (#284), each of which knows whether it has a way to the
        // person; they find the deadline by its mark (`dueDeadlines`).
        break
      case 'service_job': {
        if (claimed.customerId === null) {
          break
        }

        await tx.insert(jobs).values({
          tenantId,
          customerId: claimed.customerId,
          siteId: claimed.siteId,
          kind: 'service',
          designation: `${kind.title}: ${claimed.sourceLabel}`,
          number: await assignNumber(tx, tenantId, 'job', now),
        })

        break
      }
      case 'status': {
        const handler = handlers[kind.key]

        if (!handler) {
          throw new Error(`The deadline kind ${kind.key} changes a status and has no handler`)
        }

        await handler(tx, claimed)

        break
      }
    }
  }

  return true
}

/**
 * One pass over one business: first the sources, then what has come within
 * its lead. The first transaction writes the deadlines, then each reminder
 * gets a transaction of its own, so that one that fails does not hold up the
 * others.
 *
 * Deadlines follow their sources at any hour, but a reminder waits for the
 * morning of its day, from the same minute as the mail about a task due
 * today: a task or a message from midnight is under everything that came
 * after it when the day starts.
 */
export async function runDeadlinesOf(
  job: DeadlineJob,
  tenantId: TenantId,
  now: Date,
): Promise<DeadlineReport> {
  const registry = job.registry ?? deadlineKinds
  const sources = job.sources ?? deadlineSourceQueries
  const handlers = job.statusHandlers ?? statusHandlers
  const actor = { tenantId, reason: 'deadline' }
  const { day: today, minute } = berlinClock(now)

  const found = await job.database.forTenant(actor, (tx) =>
    reconcile(tx, tenantId, registry, sources, now),
  )

  if (minute < dueTasksFromMinute) {
    return { ...found, reminded: 0 }
  }

  const { due, settings } = await job.database.forTenant(actor, async (tx) => ({
    due: await tx
      .select()
      .from(deadlines)
      .where(
        and(
          eq(deadlines.status, 'open'),
          or(isNull(deadlines.remindedFor), ne(deadlines.remindedFor, deadlines.dueOn)),
        ),
      ),
    settings: await settingsOf(tx),
  }))

  let reminded = 0

  for (const deadline of due) {
    const kind = registry.kind(deadline.kind)

    // A kind the instance no longer knows, because a package was taken out,
    // reminds of nothing; its deadlines stay as they are.
    if (!kind) {
      continue
    }

    const setting = settings.get(kind.key) ?? null

    if (remindOn(deadline.dueOn, leadOf(kind, setting, deadline.leadDays)) > today) {
      continue
    }

    const done = await job.database.forTenant(actor, (tx) =>
      remindOne(tx, tenantId, kind, setting, deadline, handlers, now),
    )

    if (done) {
      reminded += 1
    }
  }

  return { ...found, reminded }
}

/**
 * One pass over every business. A business whose pass fails does not stop
 * the others; what went wrong goes to the log, and the next pass tries again,
 * because nothing was lost: a reminder that did not happen is still due.
 */
export async function runDeadlineCycle(job: DeadlineJob): Promise<DeadlineReport> {
  const clock = job.now ?? (() => new Date())
  const total = { created: 0, moved: 0, dropped: 0, reopened: 0, reminded: 0 }

  for (const tenantId of await everyTenant(job.database)) {
    try {
      const report = await runDeadlinesOf(job, tenantId, clock())

      total.created += report.created
      total.moved += report.moved
      total.dropped += report.dropped
      total.reopened += report.reopened
      total.reminded += report.reminded
    } catch (error) {
      console.error(`Die Fristen des Betriebs ${tenantId} ließen sich nicht abgleichen.`, error)
    }
  }

  return total
}

/**
 * Runs the engine every minute, one pass after the other and never two at
 * once, the way the mail job does. A pass follows the sources and reminds, so
 * a quote issued a moment ago has its deadline within the minute.
 *
 * `stop` waits for a pass that is running, so that shutting down does not cut
 * a reminder off between its mark and its task.
 */
export function startDeadlineWorker(job: DeadlineJob, intervalMs = 60_000): RepeatingJob {
  return startRepeating({
    run: () => runDeadlineCycle(job),
    intervalMs,
    firstAfterMs: 10_000,
    failure: 'Der Abgleich der Fristen ist gescheitert.',
  })
}
