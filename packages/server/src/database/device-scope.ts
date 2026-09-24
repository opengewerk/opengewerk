import { createHash } from 'node:crypto'

import { closedJobsStayDays } from '@opengewerk/domain'
import { type SQL, sql } from 'drizzle-orm'

import type { TenantTransaction } from './database.js'

/**
 * The part of the business the device of one person holds (#140), for a
 * person without `job.read.all`: the jobs they are assigned to that are open,
 * or closed less than `closedJobsStayDays` ago, with what hangs on them, and
 * everything the person created themselves.
 */
export interface DeviceScope {
  readonly userId: string
  readonly jobIds: readonly string[]
  /**
   * What the answer of a pull names as narrowed for each entity it narrows.
   * It changes whenever the jobs change, and a device that finds a different
   * value drops what it holds and asks from the start: a job it lost has to
   * go, and one it gained brings rows that lie behind its cursor.
   */
  readonly value: string
}

/**
 * The jobs of the scope: assigned, not deleted, open or closed recently. The
 * clock is a parameter so that the thirty days can be tested without waiting
 * for them.
 */
export async function deviceScope(
  tx: TenantTransaction,
  userId: string,
  now: Date = new Date(),
): Promise<DeviceScope> {
  const since = new Date(now.getTime() - closedJobsStayDays * 24 * 60 * 60 * 1000)
  const { rows } = await tx.execute<{ id: string }>(sql`
    select j.id
      from jobs j
      join job_assignments a on a.job_id = j.id and a.tenant_id = j.tenant_id
     where a.user_id = ${userId}
       and a.deleted_at is null
       and j.deleted_at is null
       and (j.status in ('draft', 'active') or j.closed_at >= ${since.toISOString()})
     order by j.id`)
  const jobIds = rows.map((row) => row.id)
  const digest = createHash('sha256').update(jobIds.join(',')).digest('hex').slice(0, 16)

  return { userId, jobIds, value: `jobs:${digest}` }
}

/** The entities whose rows a scope narrows; every other entity is sent whole. */
export const scopedEntities: readonly string[] = [
  'jobs',
  'job_assignments',
  'customers',
  'contacts',
  'sites',
  'installations',
  'distribution_boards',
  'board_sections',
  'circuits',
  'equipment',
  'inverters',
  'pv_strings',
  'pv_modules',
  'documents',
  'document_lines',
  'document_signatures',
  'document_sources',
  'tasks',
  'attachments',
  'attachment_versions',
]

/**
 * The condition that keeps the rows of an entity to a scope, in SQL over the
 * table the pull reads, or undefined for an entity it does not narrow.
 *
 * What hangs on a job follows the keys downwards: its customer, site and
 * installation, the other installations at that site, their boards, circuits
 * and PV parts, its documents with their lines, signatures and sources, and
 * the tasks and files at any of these. A task handed to the person or written
 * by them comes along wherever it hangs. And whatever the person created,
 * found in the audit log by its first entry, stays on their device: the
 * customer met on site today is not on a job yet.
 */
export function narrowedTo(scope: DeviceScope, entity: string): SQL | undefined {
  if (!scopedEntities.includes(entity)) {
    return undefined
  }

  const ids = sql`array[${sql.join(
    scope.jobIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`
  const jobs = sql`(select id from jobs where id = any(${ids}))`
  const customers = sql`(select customer_id from jobs where id = any(${ids}))`
  const sites = sql`(select site_id from jobs where id = any(${ids}) and site_id is not null)`
  const installations = sql`(select i.id from installations i
    where i.id in (select installation_id from jobs where id = any(${ids}) and installation_id is not null)
       or i.site_id in ${sites})`
  const boards = sql`(select id from distribution_boards where installation_id in ${installations})`
  const circuits = sql`(select id from circuits where distribution_board_id in ${boards})`
  const inverters = sql`(select id from inverters where installation_id in ${installations})`
  const strings = sql`(select id from pv_strings where inverter_id in ${inverters})`
  const documents = sql`(select id from documents where job_id = any(${ids}))`
  const attachments = sql`(select id from attachments
    where job_id = any(${ids}) or customer_id in ${customers}
       or site_id in ${sites} or installation_id in ${installations})`

  const table = sql.identifier(entity)
  const column = (name: string) => sql`${table}.${sql.identifier(name)}`
  const created = sql`${column('id')} in (select record_id from audit_entries
    where table_name = ${entity} and operation = 'insert' and user_id = ${scope.userId})`

  const own: Readonly<Record<string, SQL>> = {
    jobs: sql`${column('id')} in ${jobs}`,
    job_assignments: sql`${column('job_id')} in ${jobs}`,
    customers: sql`${column('id')} in ${customers}`,
    contacts: sql`(${column('customer_id')} in ${customers} or ${column('site_id')} in ${sites})`,
    sites: sql`${column('id')} in ${sites}`,
    installations: sql`${column('id')} in ${installations}`,
    distribution_boards: sql`${column('id')} in ${boards}`,
    board_sections: sql`${column('distribution_board_id')} in ${boards}`,
    circuits: sql`${column('id')} in ${circuits}`,
    equipment: sql`${column('circuit_id')} in ${circuits}`,
    inverters: sql`${column('id')} in ${inverters}`,
    pv_strings: sql`${column('id')} in ${strings}`,
    pv_modules: sql`${column('pv_string_id')} in ${strings}`,
    documents: sql`${column('id')} in ${documents}`,
    document_lines: sql`${column('document_id')} in ${documents}`,
    document_signatures: sql`${column('document_id')} in ${documents}`,
    document_sources: sql`${column('document_id')} in ${documents}`,
    tasks: sql`(${column('job_id')} in ${jobs}
      or ${column('customer_id')} in ${customers}
      or ${column('site_id')} in ${sites}
      or ${column('assignee_user_id')} = ${scope.userId}
      or ${column('created_by')} = ${scope.userId})`,
    attachments: sql`${column('id')} in ${attachments}`,
    attachment_versions: sql`${column('attachment_id')} in ${attachments}`,
  }

  const condition = own[entity]

  return condition ? sql`(${condition} or ${created})` : undefined
}
