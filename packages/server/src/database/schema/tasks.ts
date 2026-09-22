import { taskStatuses } from '@opengewerk/domain'
import { date, foreignKey, index, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { customers } from './customers.js'
import { jobs } from './jobs.js'
import { memberships } from './memberships.js'
import { tenantIsolation } from './rls.js'
import { sites } from './sites.js'
import { tenantColumn } from './tenants.js'

export const taskStatus = pgEnum('task_status', taskStatuses)

/**
 * Something one person has to do by a day, and where it belongs.
 *
 * The person is held to the business twice over. The key runs through the
 * membership, tenant and user together, so a task can only be handed to
 * somebody who works in the same business: a user id from next door has no
 * membership here and the row is refused. A single column pointing at the
 * account would have taken any user of the instance.
 *
 * `created_by` is null for a task no person wrote, which is the way in for the
 * deadline engine of phase 2. It carries no key, like `updated_by`: it names
 * who acted, and a record of that must not be something a later change to an
 * account can take away.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: primaryId<'task'>(),
    ...tenantColumn,
    title: text('title').notNull(),
    notes: text('notes'),
    dueOn: date('due_on').notNull(),
    assigneeUserId: text('assignee_user_id').notNull(),
    status: taskStatus('status').notNull().default('open'),
    customerId: reference<'customer'>('customer_id'),
    siteId: reference<'site'>('site_id'),
    jobId: reference<'job'>('job_id'),
    createdBy: text('created_by'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('tasks_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'tasks_customer_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'tasks_site_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'tasks_job_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.assigneeUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'tasks_assignee_works_here',
    }).onDelete('restrict'),
    index('tasks_assignee_idx').on(table.tenantId, table.assigneeUserId, table.status),
    index('tasks_customer_idx').on(table.tenantId, table.customerId),
    index('tasks_site_idx').on(table.tenantId, table.siteId),
    index('tasks_job_idx').on(table.tenantId, table.jobId),
  ],
)
