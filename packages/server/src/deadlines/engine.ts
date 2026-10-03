import {
  type CustomerId,
  type DeadlineKind,
  type DeadlineRegistry,
  type JobId,
  type SiteId,
  taskTitleOf,
  type TenantId,
} from '@opengewerk/domain'
import {
  type Database,
  type DeadlineEngine,
  type DeadlineReport,
  type RepeatingJob,
  runDeadlineCycle as runFoundationCycle,
  runDeadlinesOf as runFoundationDeadlinesOf,
  type SourceQuery,
  startDeadlineWorker as startFoundationWorker,
  type TenantTransaction,
} from '@opengewerk/platform-server'
import { eq, sql } from 'drizzle-orm'

import { assignNumber } from '../database/number-ranges.js'
import type { ApplicationDeadlineColumns } from '../database/schema/deadlines.js'
import { deadlines, jobs, tasks } from '../database/schema/index.js'
import { deadlineKinds } from './registry.js'
import { deadlineSourceQueries, type DeadlineValues } from './sources.js'

export type { DeadlineReport } from '@opengewerk/platform-server'

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
  readonly sources?: Readonly<Record<string, SourceQuery<DeadlineValues>>>
  readonly statusHandlers?: Readonly<Record<string, StatusHandler>>
  readonly now?: () => Date
}

/** The sentence of the engine that names a business. */
const sentences = {
  tenantFailed: (tenantId: TenantId) =>
    `Die Fristen des Betriebs ${tenantId} ließen sich nicht abgleichen.`,
}

/**
 * The engine of the foundation (ADR 0010, opengewerk-haustechnik#24) over the
 * kinds, sources and actions of this application.
 *
 * - `task`: a task for the responsible person, due on the day the deadline
 *   is, written by nobody: the transaction acts for no person, and the
 *   trigger of 0019 leaves `created_by` empty (#80).
 * - `service_job`: a service job in draft at the customer and site of the
 *   source, for the office to plan.
 * - `status`: the handler the kind names.
 *
 * And a deadline whose reminder made a task that is done is done as well:
 * whoever did the task has done what the deadline asked, and nobody should
 * have to say so twice.
 */
function bound(
  job: DeadlineJob,
): DeadlineEngine<DeadlineKind, ApplicationDeadlineColumns, DeadlineValues> {
  const handlers = job.statusHandlers ?? statusHandlers

  return {
    database: job.database,
    table: deadlines,
    registry: job.registry ?? deadlineKinds,
    sources: (job.sources ?? deadlineSourceQueries) as Readonly<
      Record<DeadlineKind['source'], SourceQuery<DeadlineValues>>
    >,
    actions: {
      task: async ({ tx, tenantId, kind, deadline, responsible }) => {
        if (responsible === null) {
          return
        }

        const [task] = await tx
          .insert(tasks)
          .values({
            tenantId,
            title: taskTitleOf(kind, deadline.sourceLabel),
            notes: kind.title,
            dueOn: deadline.dueOn,
            assigneeUserId: responsible,
            customerId: deadline.customerId as CustomerId | null,
            siteId: deadline.siteId as SiteId | null,
            jobId: deadline.jobId as JobId | null,
          })
          .returning({ id: tasks.id })

        if (task) {
          await tx.update(deadlines).set({ taskId: task.id }).where(eq(deadlines.id, deadline.id))
        }
      },
      service_job: async ({ tx, tenantId, kind, deadline, now }) => {
        if (deadline.customerId === null) {
          return
        }

        await tx.insert(jobs).values({
          tenantId,
          customerId: deadline.customerId as CustomerId,
          siteId: deadline.siteId as SiteId | null,
          kind: 'service',
          designation: `${kind.title}: ${deadline.sourceLabel}`,
          number: await assignNumber(tx, tenantId, 'job', now),
        })
      },
      status: async ({ tx, kind, deadline }) => {
        const handler = handlers[kind.key]

        if (!handler) {
          throw new Error(`The deadline kind ${kind.key} changes a status and has no handler`)
        }

        await handler(tx, deadline)
      },
    },
    complete: async (tx, now) => {
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
    },
    sentences,
    ...(job.now ? { now: job.now } : {}),
  }
}

/**
 * One pass over one business: first the sources, then what has come within
 * its lead. How a pass goes is the foundation's, `runDeadlinesOf` there.
 */
export function runDeadlinesOf(
  job: DeadlineJob,
  tenantId: TenantId,
  now: Date,
): Promise<DeadlineReport> {
  return runFoundationDeadlinesOf(bound(job), tenantId, now)
}

/**
 * One pass over every business. A business whose pass fails does not stop
 * the others, and how each pass ended is written down for the office.
 */
export function runDeadlineCycle(job: DeadlineJob): Promise<DeadlineReport> {
  return runFoundationCycle(bound(job))
}

/** Runs the engine every minute, one pass after the other and never two at once. */
export function startDeadlineWorker(job: DeadlineJob, intervalMs = 60_000): RepeatingJob {
  return startFoundationWorker(bound(job), intervalMs)
}
