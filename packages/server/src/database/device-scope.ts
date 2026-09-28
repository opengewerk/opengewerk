import { createHash } from 'node:crypto'

import { closedJobsStayDays, recentlyUsedDays } from '@opengewerk/domain'
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
   * Of these the ones still open, draft or active: the jobs whose sites the
   * device holds the ways into (#286), which go when the job is closed.
   */
  readonly openJobIds: readonly string[]
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
  const { rows } = await tx.execute<{ id: string; open: boolean }>(sql`
    select j.id, j.status in ('draft', 'active') as open
      from jobs j
      join job_assignments a on a.job_id = j.id and a.tenant_id = j.tenant_id
     where a.user_id = ${userId}
       and a.deleted_at is null
       and j.deleted_at is null
       and (j.status in ('draft', 'active') or j.closed_at >= ${since.toISOString()})
     order by j.id`)
  const jobIds = rows.map((row) => row.id)
  const openJobIds = rows.filter((row) => row.open).map((row) => row.id)

  return {
    userId,
    jobIds,
    value: `jobs:${digest(jobIds)}`,
    openJobIds,
  }
}

/**
 * The articles every device holds (#296), the office's included: the ones
 * marked as frequent, and those a line of a document or a report took in the
 * last `recentlyUsedDays`, with their selling prices. A catalogue from
 * DATANORM has a hundred thousand, and those stay at the routes of the office.
 *
 * Used lately is counted from when the line was written, not from the date of
 * its document: a report of last year copied today into an invoice uses its
 * material today. A line marked as deleted counts no more, one of any
 * document does, a draft as much as an issued one.
 *
 * Not narrowed by who asks but by what the articles are, and `value` is what
 * the pull names for them: when an article joins or leaves the set, a device
 * finds a different value, drops what it holds and fetches the set anew.
 * Without that, an article no longer frequent would stay on every device,
 * since its change is exactly the one the narrowed pull leaves out.
 */
export interface ArticlesOnDevices {
  readonly articleIds: readonly string[]
  readonly value: string
}

export async function articlesOnDevices(tx: TenantTransaction): Promise<ArticlesOnDevices> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    select id from articles
    where deleted_at is null
      and (frequent or id in (
        select article_id from document_lines
        where article_id is not null and deleted_at is null
          and created_at >= now() - make_interval(days => ${recentlyUsedDays})))
    order by id`)
  const articleIds = rows.map((row) => row.id)

  return { articleIds, value: `articles:${digest(articleIds)}` }
}

/** The condition that keeps the pull of an article or its prices to that set. */
export function articlesNarrowedTo(held: ArticlesOnDevices, entity: string): SQL | undefined {
  const ids = uuidArray(held.articleIds)

  if (entity === 'articles') {
    return sql`${sql.identifier('articles')}.${sql.identifier('id')} = any(${ids})`
  }

  if (entity === 'article_prices') {
    return sql`${sql.identifier('article_prices')}.${sql.identifier('article_id')} = any(${ids})`
  }

  return undefined
}

/** A short fingerprint of a sorted list, for the value an answer names. */
function digest(ids: readonly string[]): string {
  return createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 16)
}

/** A list of ids as a parameter, an empty one included. */
function uuidArray(ids: readonly string[]): SQL {
  return sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`
}

/** The entities whose rows a scope narrows; every other entity is sent whole. */
export const scopedEntities: readonly string[] = [
  'jobs',
  'job_assignments',
  'job_notes',
  'customers',
  'customer_tags',
  'contacts',
  'sites',
  'site_tags',
  'installations',
  'installation_labels',
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
  'form_records',
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
  const createdBy = (name: string) => sql`(select record_id from audit_entries
    where table_name = ${name} and operation = 'insert' and user_id = ${scope.userId})`
  const created = sql`${column('id')} in ${createdBy(entity)}`

  const own: Readonly<Record<string, SQL>> = {
    jobs: sql`${column('id')} in ${jobs}`,
    job_assignments: sql`${column('job_id')} in ${jobs}`,
    job_notes: sql`${column('job_id')} in ${jobs}`,
    customers: sql`${column('id')} in ${customers}`,
    // The tags of every customer and site the device holds, those its person
    // created without a job among them.
    customer_tags: sql`(${column('customer_id')} in ${customers}
      or ${column('customer_id')} in ${createdBy('customers')})`,
    // The people of every supplier as well (#296): the suppliers go to every
    // device whole, and the desk that holds the material ready is who a
    // technician calls on the way.
    contacts: sql`(${column('customer_id')} in ${customers} or ${column('site_id')} in ${sites}
      or ${column('supplier_id')} is not null)`,
    sites: sql`${column('id')} in ${sites}`,
    site_tags: sql`(${column('site_id')} in ${sites} or ${column('site_id')} in ${createdBy('sites')})`,
    installations: sql`${column('id')} in ${installations}`,
    // The labels of the installations the device holds (#308), so that a scan
    // opens one of them without a network, and says nothing of any other.
    installation_labels: sql`${column('installation_id')} in ${installations}`,
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
    form_records: sql`(${column('installation_id')} in ${installations}
      or ${column('job_id')} in ${jobs})`,
  }

  const condition = own[entity]

  return condition ? sql`(${condition} or ${created})` : undefined
}

/**
 * The ways into a site (#286) on a device without `site.access`: the sites of
 * its open jobs, and nothing of a closed one, which `closedJobsStayDays` keeps
 * for everything else. A device with the right holds them all, with a value
 * only for the sites of its person's own open jobs (#447), and asks the route
 * for any other.
 */
export function accessesOfOpenJobs(scope: DeviceScope): SQL {
  return sql`"site_accesses"."site_id" in (select site_id from jobs
    where id = any(${uuidArray(scope.openJobIds)}) and site_id is not null)`
}

/**
 * The sites whose values the device of a person holds on site (#286): those
 * with a way in and an open job the person is assigned to, whatever their
 * role (#447). For a technician they are also the sites whose ways in the
 * device holds at all. `value` changes with the list and goes into the
 * answer, so that a device lets go of the ways into a site whose last open
 * job was closed, and fetches those of a site that got one or that one of its
 * jobs moved to. A site without a way in stays out of the list: a job there
 * changes nothing on the device, and the device would fetch its part anew for
 * nothing.
 */
export async function sitesWithOpenJobs(
  tx: TenantTransaction,
  scope: DeviceScope,
): Promise<{ readonly siteIds: ReadonlySet<string>; readonly value: string }> {
  const { rows } = await tx.execute<{ site_id: string }>(sql`
    select distinct j.site_id
      from jobs j
     where j.id = any(${uuidArray(scope.openJobIds)})
       and j.site_id is not null
       and exists (select 1 from sites s
                    where s.id = j.site_id and s.deleted_at is null)
       and exists (select 1 from site_accesses a
                    where a.site_id = j.site_id and a.deleted_at is null)
     order by j.site_id`)
  const ids = rows.map((row) => row.site_id)

  return { siteIds: new Set(ids), value: `sites:${digest(ids)}` }
}
