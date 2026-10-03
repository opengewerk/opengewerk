import { deadlineStatuses, longestLeadDays } from '@opengewerk/platform-domain'
import { type BuildColumns, type BuildExtraConfigColumns, sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  type PgColumnBuilderBase,
  type PgEnum,
  pgEnum,
  pgTable,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, timestamps } from './columns.js'
import { memberships } from './memberships.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/** The enum and the columns every table of deadlines has, whatever its application follows. */
function deadlineParts() {
  const deadlineStatus = pgEnum('deadline_status', deadlineStatuses)

  const columns = {
    id: primaryId<'deadline'>(),
    ...tenantColumn,
    kind: text('kind').notNull(),
    sourceId: reference<'source'>('source_id').notNull(),
    // What the source is called in the list and in what the deadline makes.
    // Written with every run, so that it follows a change.
    sourceLabel: text('source_label').notNull(),
    anchorOn: date('anchor_on').notNull(),
    dueOn: date('due_on').notNull(),
    leadDays: integer('lead_days'),
    responsibleUserId: text('responsible_user_id'),
    // Who the source names, a record of who acted, and so without a key that
    // a later change to a membership could break.
    naturalUserId: text('natural_user_id'),
    status: deadlineStatus('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: text('closed_by'),
    remindedFor: date('reminded_for'),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    ...timestamps,
  }

  return { deadlineStatus, columns }
}

/** The columns every table of deadlines has. */
export type DeadlineColumns = ReturnType<typeof deadlineParts>['columns']

/**
 * Columns an application adds to its deadlines, for what a deadline hangs on.
 * None may take the name of one the table has; the schema refuses that when
 * it is made.
 */
export type OwnDeadlineColumns = Record<string, PgColumnBuilderBase>

/**
 * The deadlines of an application with these columns of its own.
 *
 * Written out with the names drizzle gives its types, like the outbox: left
 * to itself, the compiler writes the columns of a table with columns of the
 * application's own into the declaration as a type nobody can use.
 */
export type DeadlinesTable<Own extends OwnDeadlineColumns = Record<never, never>> =
  PgTableWithColumns<{
    name: 'deadlines'
    schema: undefined
    columns: BuildColumns<'deadlines', DeadlineColumns & Own, 'pg'>
    dialect: 'pg'
  }>

/** The deadlines and their enum, as an application exports them from its schema. */
export interface DeadlinesSchema<Own extends OwnDeadlineColumns> {
  readonly deadlineStatus: PgEnum<['open', 'done', 'dropped']>
  readonly deadlines: DeadlinesTable<Own>
}

/** What an application says about its deadlines. */
export interface DeadlinesOptions<Own extends OwnDeadlineColumns> {
  /** Columns of the application, for what a deadline hangs on. */
  readonly columns?: Own
  /** The keys, indexes and policies of those columns. */
  readonly constraints?: (
    table: BuildExtraConfigColumns<'deadlines', DeadlineColumns & Own, 'pg'>,
  ) => PgTableExtraConfigValue[]
}

/**
 * The deadlines of a tenant (opengewerk-haustechnik#24), one per kind and
 * source: the table and its enum, made by an application with the columns it
 * needs for what a deadline hangs on.
 *
 * Written by the engine in `deadlines/`, which follows the sources, and
 * changed by a person only in what a person decides: done or not, a lead or a
 * person of its own. No sync columns: a deadline is worked out on the server
 * from what the devices sent, and a device has nothing to add to it.
 *
 * The source is the record the deadline follows, and `(kind, source_id)` is
 * what makes a second run find the deadline of the first instead of writing
 * another. **What else a deadline hangs on is the application's**: one keeps
 * the document, the customer and the task it made, another the property and
 * the area that decide who may see it. Each such column is the application's,
 * under a key over the tenant, so a deadline cannot point into another tenant.
 * So this is a function and not a table, like the outbox.
 *
 * `reminded_for` is the due day the actions ran for. It is set by an update
 * that only one run can win, in the transaction of the actions, and that is
 * what makes every action happen once per due day.
 */
export function deadlinesSchema<Own extends OwnDeadlineColumns = Record<never, never>>(
  options: DeadlinesOptions<Own> = {},
): DeadlinesSchema<Own> {
  const { deadlineStatus, columns: base } = deadlineParts()
  const own = options.columns ?? ({} as Own)
  const taken = Object.keys(own).filter((name) => name in base)

  if (taken.length > 0) {
    throw new Error(`The deadlines have these columns already: ${taken.join(', ')}.`)
  }

  const deadlines = pgTable('deadlines', { ...base, ...own } as DeadlineColumns & Own, (table) => [
    tenantIsolation(table.tenantId),
    unique('deadlines_tenant_id_key').on(table.tenantId, table.id),
    unique('deadlines_once_per_source').on(table.tenantId, table.kind, table.sourceId),
    foreignKey({
      columns: [table.tenantId, table.responsibleUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'deadlines_responsible_works_here',
    }).onDelete('restrict'),
    check(
      'deadlines_lead_in_bounds',
      sql`${table.leadDays} is null or ${table.leadDays} between 0 and ${sql.raw(String(longestLeadDays))}`,
    ),
    check(
      'deadlines_closed_when_not_open',
      sql`(${table.status} = 'open') = (${table.closedAt} is null)`,
    ),
    index('deadlines_due_idx').on(table.tenantId, table.status, table.dueOn),
    ...(options.constraints?.(table) ?? []),
  ])

  return { deadlineStatus, deadlines }
}

/** A deadline as every table of deadlines has it, whatever else its application keeps beside. */
export type DeadlineRow = DeadlinesTable['$inferSelect']
