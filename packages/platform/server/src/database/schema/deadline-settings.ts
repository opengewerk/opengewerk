import {
  longestIntervalDays,
  longestIntervalMonths,
  longestLeadDays,
} from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { memberships } from './memberships.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

// The two tables of the deadline engine that are the same in every
// application (opengewerk-haustechnik#24). The deadlines themselves carry
// columns of their application and are made by `deadlinesSchema`.

/**
 * What a tenant has set for a kind of deadline: its lead, its interval where
 * the kind has one, in the unit the kind counts in, and who answers for it.
 * One row per kind the tenant has touched; a kind without a row runs on its
 * own values.
 */
export const deadlineSettings = pgTable(
  'deadline_settings',
  {
    id: primaryId<'deadline-setting'>(),
    ...tenantColumn,
    kind: text('kind').notNull(),
    leadDays: integer('lead_days'),
    intervalDays: integer('interval_days'),
    intervalMonths: integer('interval_months'),
    responsibleUserId: text('responsible_user_id'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('deadline_settings_once_per_kind').on(table.tenantId, table.kind),
    foreignKey({
      columns: [table.tenantId, table.responsibleUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'deadline_settings_responsible_works_here',
    }).onDelete('restrict'),
    check(
      'deadline_settings_lead_in_bounds',
      sql`${table.leadDays} is null or ${table.leadDays} between 0 and ${sql.raw(String(longestLeadDays))}`,
    ),
    check(
      'deadline_settings_interval_in_bounds',
      sql`${table.intervalDays} is null or ${table.intervalDays} between 1 and ${sql.raw(String(longestIntervalDays))}`,
    ),
    check(
      'deadline_settings_interval_months_in_bounds',
      sql`${table.intervalMonths} is null or ${table.intervalMonths} between 1 and ${sql.raw(String(longestIntervalMonths))}`,
    ),
    check(
      'deadline_settings_one_unit',
      sql`${table.intervalDays} is null or ${table.intervalMonths} is null`,
    ),
  ],
)

/**
 * When the engine last went through the deadlines of a tenant, and when it
 * last failed to (opengewerk-haustechnik#24). One row per tenant, written
 * after every pass.
 *
 * A pass that did not happen has to be seen where people work and not in a
 * file on the server: a reminder that never came looks exactly like one that
 * was not due. So the office reads this row, and a moment long past says the
 * engine has stopped, for the whole instance or for this tenant alone.
 *
 * The audit log does not watch it. It is a heartbeat, written every minute,
 * and would bury every change a person made under its own.
 */
export const deadlineRuns = pgTable(
  'deadline_runs',
  {
    id: primaryId<'deadline-run'>(),
    ...tenantColumn,
    /** The end of the last pass that went through, null before the first. */
    succeededAt: timestamp('succeeded_at', { withTimezone: true }),
    /** The end of the last pass that failed, null when none has. */
    failedAt: timestamp('failed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    uniqueIndex('deadline_runs_tenant').on(table.tenantId),
  ],
)
