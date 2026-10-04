import {
  addInterval,
  berlinClock,
  type DeadlineKind,
  type DeadlineRegistry,
  type DeadlineSetting,
  intervalOf,
  type IsoDate,
  leadOf,
  morningMinute,
  reminderAction,
  remindOn,
  type TenantId,
} from '@opengewerk/platform-domain'
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm'

import type { Actor, Database, TenantTransaction } from '../database/database.js'
import { everyTenant } from '../database/every-tenant.js'
import type {
  DeadlineRow,
  DeadlinesTable,
  OwnDeadlineColumns,
} from '../database/schema/deadlines.js'
import { type RepeatingJob, startRepeating } from '../start/repeat.js'
import { responsibleFor } from './responsible.js'
import { recordDeadlinePass } from './runs.js'
import { deadlineSettingsOf } from './settings.js'

/**
 * A deadline as its source asks for it right now: what the engine compares
 * with the deadline it keeps, to write it, move it or let it drop.
 */
export interface ExpectedDeadline<Values extends object = Record<never, never>> {
  /** The record the deadline follows, one deadline per kind and source. */
  readonly sourceId: string
  /** What the source is called in the list and in what the deadline makes. */
  readonly sourceLabel: string
  /** The day of the source the due day is counted from. */
  readonly anchorOn: IsoDate
  /** The due day, where the source names it; null where the interval of the kind counts. */
  readonly namedDueOn: IsoDate | null
  /** The person the source names, for a kind whose responsible is `source`. */
  readonly naturalUserId: string | null
  /**
   * What else the deadline hangs on, in the columns of the application's own:
   * written with the deadline and followed like everything else it takes from
   * its source.
   */
  readonly values: Values
}

/** The question one source asks the data of a tenant. */
export type SourceQuery<Values extends object = Record<never, never>> = (
  tx: TenantTransaction,
) => Promise<readonly ExpectedDeadline<Values>[]>

/** A deadline as the engine reads it, with the columns of the application beside its own. */
export type KeptDeadline = DeadlineRow & Readonly<Record<string, unknown>>

/** What an action of the application is given, in the transaction that marks the deadline reminded. */
export interface DeadlineActionContext<Kind extends DeadlineKind, Row = KeptDeadline> {
  readonly tx: TenantTransaction
  readonly tenantId: TenantId
  readonly kind: Kind
  readonly setting: DeadlineSetting | null
  /** The deadline, marked reminded for its due day, with the columns of the application. */
  readonly deadline: Row
  /** Who answers for it now, null only in a tenant where nobody can. */
  readonly responsible: string | null
  readonly now: Date
}

/**
 * What an action of the application does, once per due day. If it fails, the
 * whole of it rolls back, the mark included, and the next run tries again.
 */
export type DeadlineActionHandler<Kind extends DeadlineKind, Row = KeptDeadline> = (
  context: DeadlineActionContext<Kind, Row>,
) => Promise<void>

/** The actions of a kind that the application carries out: every one but the reminder. */
export type ApplicationDeadlineActions<Kind extends DeadlineKind> = Exclude<
  Kind['actions'][number],
  typeof reminderAction
>

/** What the engine is told by an application, and what a test brings of its own. */
export interface DeadlineEngine<
  Kind extends DeadlineKind,
  Own extends OwnDeadlineColumns = Record<never, never>,
  Values extends object = Record<never, never>,
> {
  readonly database: Database
  /** The deadlines of the application, made by `deadlinesSchema` with its columns. */
  readonly table: DeadlinesTable<Own>
  readonly registry: DeadlineRegistry<Kind>
  /** Every source a kind may name, by that name. */
  readonly sources: Readonly<Record<Kind['source'], SourceQuery<Values>>>
  /** What each action does, by its name; the reminder is written by the notifications. */
  readonly actions: Readonly<
    Record<
      ApplicationDeadlineActions<Kind>,
      DeadlineActionHandler<Kind, DeadlinesTable<Own>['$inferSelect']>
    >
  >
  /**
   * What follows from the rest of the application once the sources are in:
   * a deadline whose task somebody did is done, for one. Run at the end of the
   * pass that follows the sources, in its transaction.
   */
  readonly complete?: (tx: TenantTransaction, now: Date) => Promise<void>
  /** The sentence the log says when the deadlines of one tenant could not be gone through. */
  readonly sentences: { readonly tenantFailed: (tenantId: TenantId) => string }
  /**
   * The way into a transaction of one tenant for a pass, `database.forTenant`
   * unless the application gives another. A pass runs for nobody in
   * particular, so an application whose tables keep more apart than the
   * tenant, its areas for one, opens what the pass may see here; the routes
   * of the deadlines stay on the transaction of the person who asked.
   */
  readonly inTenant?: <Result>(
    actor: Actor,
    work: (tx: TenantTransaction) => Promise<Result>,
  ) => Promise<Result>
  readonly now?: () => Date
  /** Where a failure is said; the log, unless a test listens. */
  readonly complain?: (line: string, error: unknown) => void
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
  expected: ExpectedDeadline<object>,
): IsoDate {
  return (
    expected.namedDueOn ?? addInterval(expected.anchorOn, intervalOf(kind, setting) ?? { days: 0 })
  )
}

/** The values a deadline takes over from its source on every pass. */
function fromSource(expected: ExpectedDeadline<object>, dueOn: IsoDate): Record<string, unknown> {
  return {
    ...expected.values,
    sourceLabel: expected.sourceLabel,
    anchorOn: expected.anchorOn,
    dueOn,
    naturalUserId: expected.naturalUserId,
  }
}

function differs(current: KeptDeadline, next: Record<string, unknown>): boolean {
  return Object.entries(next).some(([field, value]) => current[field] !== value)
}

/**
 * Brings the deadlines of one tenant in line with their sources.
 *
 * A source that asks for a deadline nobody keeps gets one. An open deadline
 * follows its source: a new day, a new name, another record it hangs on. One
 * whose source asks no more drops out, and comes back when the source asks
 * again. One a person has marked done stays done, unless its source starts
 * over from a new day; the tenant changing the interval of the kind moves only
 * the open ones, since a done deadline was done for its day.
 */
export async function reconcileDeadlines<
  Kind extends DeadlineKind,
  Own extends OwnDeadlineColumns,
  Values extends object,
>(
  engine: DeadlineEngine<Kind, Own, Values>,
  tx: TenantTransaction,
  tenantId: TenantId,
  now: Date,
): Promise<Omit<DeadlineReport, 'reminded'>> {
  // The columns every table of deadlines has; the application's own come
  // with the values of its sources.
  const table = engine.table as unknown as DeadlinesTable
  const report = { created: 0, moved: 0, dropped: 0, reopened: 0 }
  const settings = await deadlineSettingsOf(tx)
  const kept = (await tx.select().from(table)) as KeptDeadline[]

  for (const kind of engine.registry.kinds) {
    const query = engine.sources[kind.source as Kind['source']] as SourceQuery<Values> | undefined

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
        await tx.insert(table).values({
          ...next,
          tenantId,
          kind: kind.key,
          sourceId: expected.sourceId,
        } as DeadlinesTable['$inferInsert'])
        report.created += 1

        continue
      }

      const reopen =
        current.status === 'dropped' ||
        (current.status === 'done' && current.anchorOn !== next['anchorOn'])

      if (reopen) {
        await tx
          .update(table)
          .set({ ...next, status: 'open', closedAt: null, closedBy: null, updatedAt: now })
          .where(eq(table.id, current.id))
        report.reopened += 1
      } else if (current.status === 'open' && differs(current, next)) {
        await tx
          .update(table)
          .set({ ...next, updatedAt: now })
          .where(eq(table.id, current.id))
        report.moved += 1
      }
    }

    const gone = [...bySource.values()].filter((row) => row.status === 'open')

    if (gone.length > 0) {
      await tx
        .update(table)
        .set({ status: 'dropped', closedAt: now, closedBy: null, updatedAt: now })
        .where(
          inArray(
            table.id,
            gone.map((row) => row.id),
          ),
        )
      report.dropped += gone.length
    }
  }

  await engine.complete?.(tx, now)

  return report
}

/**
 * Carries out the actions of one deadline whose lead has come, once.
 *
 * The update that marks it reminded for its due day is the claim: of two runs
 * at the same moment one gets the row back and the other nothing, and the one
 * that gets it does the rest in the same transaction. If any action fails,
 * the whole of it rolls back, the mark included, and the next run tries again.
 *
 * The reminder is no action here. The jobs that send, one for mail and one
 * for push, each know whether they have a way to the person; they find the
 * deadline by its mark.
 */
async function remindOne<
  Kind extends DeadlineKind,
  Own extends OwnDeadlineColumns,
  Values extends object,
>(
  engine: DeadlineEngine<Kind, Own, Values>,
  tx: TenantTransaction,
  tenantId: TenantId,
  kind: Kind,
  setting: DeadlineSetting | null,
  deadline: KeptDeadline,
  now: Date,
): Promise<boolean> {
  const table = engine.table as unknown as DeadlinesTable
  const [claimed] = (await tx
    .update(table)
    .set({ remindedFor: deadline.dueOn, remindedAt: now, updatedAt: now })
    .where(
      and(
        eq(table.id, deadline.id),
        eq(table.status, 'open'),
        eq(table.dueOn, deadline.dueOn),
        or(isNull(table.remindedFor), ne(table.remindedFor, deadline.dueOn)),
      ),
    )
    .returning()) as KeptDeadline[]

  if (!claimed) {
    return false
  }

  const responsible = await responsibleFor(tx, tenantId, kind, setting, claimed)

  for (const action of kind.actions) {
    if (action === reminderAction) {
      continue
    }

    // The row is the application's own, with its columns; read back from the
    // table it handed in, so the conversion only says what the row is.
    const handler = engine.actions[action as ApplicationDeadlineActions<Kind>] as unknown as
      DeadlineActionHandler<Kind, KeptDeadline> | undefined

    if (!handler) {
      throw new Error(
        `The deadline kind ${kind.key} names the action ${action}, which has no handler`,
      )
    }

    await handler({ tx, tenantId, kind, setting, deadline: claimed, responsible, now })
  }

  return true
}

/**
 * One pass over one tenant: first the sources, then what has come within its
 * lead. The first transaction writes the deadlines, then each reminder gets a
 * transaction of its own, so that one that fails does not hold up the others;
 * the pass fails all the same, with what went wrong, once the others are made.
 *
 * Deadlines follow their sources at any hour, but a reminder waits for the
 * morning of its day (`morningMinute`): whatever it makes is then under
 * nothing that came after it when the day starts.
 */
export async function runDeadlinesOf<
  Kind extends DeadlineKind,
  Own extends OwnDeadlineColumns,
  Values extends object,
>(
  engine: DeadlineEngine<Kind, Own, Values>,
  tenantId: TenantId,
  now: Date,
): Promise<DeadlineReport> {
  const table = engine.table as unknown as DeadlinesTable
  const actor = { tenantId, reason: 'deadline' }
  const inTenant =
    engine.inTenant ??
    (<Result>(who: Actor, work: (tx: TenantTransaction) => Promise<Result>) =>
      engine.database.forTenant(who, work))
  const { day: today, minute } = berlinClock(now)

  const found = await inTenant(actor, (tx) => reconcileDeadlines(engine, tx, tenantId, now))

  if (minute < morningMinute) {
    return { ...found, reminded: 0 }
  }

  const { due, settings } = await inTenant(actor, async (tx) => ({
    due: (await tx
      .select()
      .from(table)
      .where(
        and(
          eq(table.status, 'open'),
          or(isNull(table.remindedFor), ne(table.remindedFor, table.dueOn)),
        ),
      )) as KeptDeadline[],
    settings: await deadlineSettingsOf(tx),
  }))

  let reminded = 0
  const failures: unknown[] = []

  for (const deadline of due) {
    const kind = engine.registry.kind(deadline.kind)

    // A kind the instance no longer knows, because a package was taken out,
    // reminds of nothing; its deadlines stay as they are.
    if (!kind) {
      continue
    }

    const setting = settings.get(kind.key) ?? null

    if (remindOn(deadline.dueOn as IsoDate, leadOf(kind, setting, deadline.leadDays)) > today) {
      continue
    }

    try {
      const done = await inTenant(actor, (tx) =>
        remindOne(engine, tx, tenantId, kind, setting, deadline, now),
      )

      if (done) {
        reminded += 1
      }
    } catch (error) {
      // Until opengewerk-haustechnik#31 the first failure ended the pass, and
      // since a failed reminder stays due, the same one stopped the same
      // others every minute for as long as its cause lasted.
      failures.push(error)
    }
  }

  // The others have been made; the pass still counts as failed, so that it is
  // seen where people work and in the log, and the next one tries again.
  if (failures.length === 1) {
    throw failures[0]
  }

  if (failures.length > 1) {
    throw new AggregateError(failures, `${String(failures.length)} Erinnerungen sind gescheitert.`)
  }

  return { ...found, reminded }
}

/**
 * One pass over every tenant. A tenant whose pass fails does not stop the
 * others; what went wrong goes to the log, and the next pass tries again,
 * because nothing was lost: a reminder that did not happen is still due.
 *
 * How each pass ended is written down for the tenant (`deadline_runs`), so
 * that a pass that failed, or none at all, is seen where people work.
 */
export async function runDeadlineCycle<
  Kind extends DeadlineKind,
  Own extends OwnDeadlineColumns,
  Values extends object,
>(engine: DeadlineEngine<Kind, Own, Values>): Promise<DeadlineReport> {
  const clock = engine.now ?? (() => new Date())
  const complain = engine.complain ?? console.error
  const total = { created: 0, moved: 0, dropped: 0, reopened: 0, reminded: 0 }

  for (const tenantId of await everyTenant(engine.database)) {
    try {
      const report = await runDeadlinesOf(engine, tenantId, clock())

      total.created += report.created
      total.moved += report.moved
      total.dropped += report.dropped
      total.reopened += report.reopened
      total.reminded += report.reminded

      await recordDeadlinePass(engine.database, tenantId, 'succeeded', clock())
    } catch (error) {
      complain(engine.sentences.tenantFailed(tenantId), error)

      try {
        await recordDeadlinePass(engine.database, tenantId, 'failed', clock())
      } catch (recordError) {
        complain(engine.sentences.tenantFailed(tenantId), recordError)
      }
    }
  }

  return total
}

/**
 * Runs the engine every minute, one pass after the other and never two at
 * once. A pass follows the sources and reminds, so a source that asked a
 * moment ago has its deadline within the minute.
 *
 * `stop` waits for a pass that is running, so that shutting down does not cut
 * a reminder off between its mark and what it makes.
 */
export function startDeadlineWorker<
  Kind extends DeadlineKind,
  Own extends OwnDeadlineColumns,
  Values extends object,
>(engine: DeadlineEngine<Kind, Own, Values>, intervalMs = 60_000): RepeatingJob {
  return startRepeating({
    run: () => runDeadlineCycle(engine),
    intervalMs,
    firstAfterMs: 10_000,
    failure: 'Der Abgleich der Fristen ist gescheitert.',
    ...(engine.complain ? { complain: engine.complain } : {}),
  })
}
