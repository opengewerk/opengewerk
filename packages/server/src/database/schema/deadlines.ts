import { deadlineStatuses, longestIntervalDays, longestLeadDays } from '@opengewerk/domain'
import { primaryId, reference, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import { customers } from './customers.js'
import { documents } from './documents.js'
import { installations } from './installations.js'
import { jobs } from './jobs.js'
import { memberships } from './memberships.js'
import { sites } from './sites.js'
import { tasks } from './tasks.js'
import { tenantColumn } from './tenants.js'

export const deadlineStatus = pgEnum('deadline_status', deadlineStatuses)

/**
 * The deadlines of a business (#283), one per kind and source.
 *
 * Written by the engine in `deadlines/`, which follows the sources, and
 * changed by the office only in what the office decides: done or not, a lead
 * or a person of its own. No sync columns: a deadline is worked out on the
 * server from what the devices sent, and a device has nothing to add to it.
 *
 * The source is the record the deadline follows, and `(kind, source_id)` is
 * what makes a second run find the deadline of the first instead of writing
 * another. The typed columns beside it hold the same record and what it hangs
 * on, each under a key over the tenant (#113), so that a deadline cannot
 * point into another business and the list can ask for a customer.
 *
 * `reminded_for` is the due day the actions ran for. It is set in the same
 * transaction as the task the reminder makes, by an update that only one run
 * can win, and that is what makes every action happen once per due day.
 */
export const deadlines = pgTable(
  'deadlines',
  {
    id: primaryId<'deadline'>(),
    ...tenantColumn,
    kind: text('kind').notNull(),
    sourceId: reference<'source'>('source_id').notNull(),
    // What the source is called in the list and in the task it makes, the
    // number of the quote. Written with every run, so that it follows a change.
    sourceLabel: text('source_label').notNull(),
    documentId: reference<'document'>('document_id'),
    installationId: reference<'installation'>('installation_id'),
    customerId: reference<'customer'>('customer_id'),
    siteId: reference<'site'>('site_id'),
    jobId: reference<'job'>('job_id'),
    anchorOn: date('anchor_on').notNull(),
    dueOn: date('due_on').notNull(),
    leadDays: integer('lead_days'),
    responsibleUserId: text('responsible_user_id'),
    // Who the source names, a record of who acted like `created_by` on a task,
    // and so without a key that a later change to a membership could break.
    naturalUserId: text('natural_user_id'),
    status: deadlineStatus('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: text('closed_by'),
    remindedFor: date('reminded_for'),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    taskId: reference<'task'>('task_id'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('deadlines_tenant_id_key').on(table.tenantId, table.id),
    unique('deadlines_once_per_source').on(table.tenantId, table.kind, table.sourceId),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'deadlines_document_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.installationId],
      foreignColumns: [installations.tenantId, installations.id],
      name: 'deadlines_installation_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'deadlines_customer_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'deadlines_site_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'deadlines_job_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
      name: 'deadlines_task_in_tenant',
    }).onDelete('restrict'),
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
    index('deadlines_customer_idx').on(table.tenantId, table.customerId),
    index('deadlines_document_idx').on(table.tenantId, table.documentId),
    index('deadlines_task_idx').on(table.tenantId, table.taskId),
  ],
)

/**
 * What a business has set for a kind of deadline: its lead, its interval
 * where the kind has one, and who answers for it. One row per kind that the
 * business has touched; a kind without a row runs on its own values.
 */
export const deadlineSettings = pgTable(
  'deadline_settings',
  {
    id: primaryId<'deadline-setting'>(),
    ...tenantColumn,
    kind: text('kind').notNull(),
    leadDays: integer('lead_days'),
    intervalDays: integer('interval_days'),
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
  ],
)
