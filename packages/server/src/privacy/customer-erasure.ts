import {
  contractStanding,
  type ContractTerms,
  coreDeadlineKinds,
  type CustomerHold,
  customerHolds,
  type CustomerId,
  type CustomerKind,
  type DocumentKind,
  type DocumentStatus,
  type ErasureRequestStatus,
  type IsoDate,
  shippedRules,
  type TenantId,
} from '@opengewerk/domain'
import { type TenantTransaction } from '@opengewerk/platform-server'
import { auditEntries, auditRedactions, deadlineSettings } from '@opengewerk/platform-server/schema'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'

import {
  customers,
  documents,
  erasureRequests,
  jobs,
  maintenanceContracts,
} from '../database/schema/index.js'
import { warrantiesRunningOut } from '../deadlines/sources.js'

/** The kind of deadline that proposes a customer, as `core.json` has it. */
const customerDeadline = 'privacy.customer_erasure'

/** A request for deletion that runs, as the standing of its customer names it. */
export interface RunningRequest {
  readonly id: string
  readonly receivedOn: IsoDate
  readonly status: Exclude<ErasureRequestStatus, 'erased'>
}

/** What decides whether and when a customer may go (#845). */
export interface CustomerStanding {
  readonly customerId: CustomerId
  readonly kind: CustomerKind
  readonly name: string
  readonly holds: readonly CustomerHold[]
  readonly lastContactOn: IsoDate
  readonly request: RunningRequest | null
}

/**
 * How many months without contact a customer falls due after: what the
 * business set for the kind of deadline, else the kind's own, three years.
 */
export async function contactMonthsOf(tx: TenantTransaction): Promise<number> {
  const [setting] = await tx
    .select({ months: deadlineSettings.intervalMonths })
    .from(deadlineSettings)
    .where(eq(deadlineSettings.kind, customerDeadline))
    .limit(1)
  const kind = coreDeadlineKinds.find((entry) => entry.key === customerDeadline)

  return setting?.months ?? kind?.intervalMonths ?? 36
}

function grouped<Row, Value>(
  rows: readonly Row[],
  keyOf: (row: Row) => string,
  valueOf: (row: Row) => Value,
): Map<string, Value[]> {
  const map = new Map<string, Value[]>()

  for (const row of rows) {
    const key = keyOf(row)
    const list = map.get(key) ?? []
    list.push(valueOf(row))
    map.set(key, list)
  }

  return map
}

/**
 * The standing of every customer not deleted, or of the ones named: what
 * holds it today, its last contact and the request that runs for it. The
 * last contact is the latest of the day it was entered, an entry of its
 * history, a document, a job opened or closed, an appointment that has
 * taken place and the last contact of the lead it came from.
 */
export async function customerStandings(
  tx: TenantTransaction,
  today: IsoDate,
  only?: readonly string[],
): Promise<Map<string, CustomerStanding>> {
  if (only !== undefined && only.length === 0) {
    return new Map()
  }

  const ids = only?.map((id) => id.toLowerCase()) as CustomerId[] | undefined
  const ofThese = <Column extends typeof customers.id | typeof documents.customerId>(
    column: Column,
  ) => (ids === undefined ? undefined : inArray(column, ids))

  const people = await tx
    .select({ id: customers.id, kind: customers.kind, name: customers.name })
    .from(customers)
    .where(and(isNull(customers.deletedAt), ofThese(customers.id)))

  if (people.length === 0) {
    return new Map()
  }

  const keys = people.map((person) => person.id)
  const keyList = sql`array[${sql.join(
    keys.map((key) => sql`${key}`),
    sql`, `,
  )}]::uuid[]`

  const papers = await tx
    .select({
      customerId: documents.customerId,
      kind: documents.kind,
      status: documents.status,
      documentDate: documents.documentDate,
    })
    .from(documents)
    .where(
      and(
        isNull(documents.deletedAt),
        ne(documents.status, 'draft'),
        inArray(documents.customerId, keys),
      ),
    )
  const papersOf = grouped(
    papers,
    (row) => row.customerId,
    (row) => ({
      kind: row.kind as DocumentKind,
      status: row.status as DocumentStatus,
      documentDate: row.documentDate as IsoDate,
    }),
  )

  const open = await tx
    .select({ customerId: jobs.customerId })
    .from(jobs)
    .where(
      and(
        isNull(jobs.deletedAt),
        inArray(jobs.status, ['draft', 'active']),
        inArray(jobs.customerId, keys),
      ),
    )
  const openOf = grouped(
    open,
    (row) => row.customerId,
    () => 1,
  )

  const contracts = await tx
    .select()
    .from(maintenanceContracts)
    .where(inArray(maintenanceContracts.customerId, keys))
  const runningOf = grouped(
    contracts.filter(
      (contract) =>
        contractStanding(
          {
            startsOn: contract.startsOn as IsoDate,
            termMonths: contract.termMonths,
            renewal: contract.renewal as ContractTerms['renewal'],
            renewalMonths: contract.renewalMonths,
            noticeMonths: contract.noticeMonths,
            endsOn: contract.endsOn as IsoDate | null,
          },
          today,
        ).tone !== 'over',
    ),
    (row) => row.customerId,
    () => 1,
  )

  const keySet = new Set<string>(keys)
  const warranties = (await warrantiesRunningOut(tx)).filter(
    (warranty) => warranty.values.customerId !== null && keySet.has(warranty.values.customerId),
  )
  const warrantiesOf = grouped(
    warranties,
    (row) => row.values.customerId as string,
    (row) => row.namedDueOn as IsoDate,
  )

  const { rows: contacts } = await tx.execute<{ id: string; last_contact_on: string }>(sql`
    select c.id, greatest(
      (c.created_at at time zone 'Europe/Berlin')::date,
      (select max((m.happened_at at time zone 'Europe/Berlin')::date) from communications m
        where m.customer_id = c.id),
      (select max(d.document_date) from documents d where d.customer_id = c.id and d.deleted_at is null),
      (select max((greatest(j.created_at, coalesce(j.closed_at, j.created_at)) at time zone 'Europe/Berlin')::date)
         from jobs j where j.customer_id = c.id and j.deleted_at is null),
      (select max((a.ends_at at time zone 'Europe/Berlin')::date)
         from appointments a join jobs j on j.id = a.job_id
        where j.customer_id = c.id and a.deleted_at is null and a.ends_at <= now()),
      (select max(p.last_contact_on) from prospects p where p.customer_id = c.id)
    )::text as last_contact_on
      from customers c
     where c.id = any(${keyList})`)
  const lastContactOf = new Map(contacts.map((row) => [row.id, row.last_contact_on as IsoDate]))

  const requests = await tx
    .select({
      id: erasureRequests.id,
      customerId: erasureRequests.customerId,
      receivedOn: erasureRequests.receivedOn,
      status: erasureRequests.status,
    })
    .from(erasureRequests)
    .where(and(ne(erasureRequests.status, 'erased'), inArray(erasureRequests.customerId, keys)))
  const requestOf = new Map(requests.map((row) => [row.customerId as string, row]))

  return new Map(
    people.map((person) => {
      const request = requestOf.get(person.id)

      return [
        person.id,
        {
          customerId: person.id,
          kind: person.kind,
          name: person.name,
          holds: customerHolds(
            {
              documents: papersOf.get(person.id) ?? [],
              warrantiesEndOn: warrantiesOf.get(person.id) ?? [],
              openJobs: openOf.get(person.id)?.length ?? 0,
              runningContracts: runningOf.get(person.id)?.length ?? 0,
            },
            today,
            shippedRules,
          ),
          lastContactOn: lastContactOf.get(person.id) ?? today,
          request:
            request === undefined
              ? null
              : {
                  id: request.id,
                  receivedOn: request.receivedOn as IsoDate,
                  status: request.status as RunningRequest['status'],
                },
        },
      ]
    }),
  )
}

/** The keys of a table a deletion touched, for the change log to black out. */
interface Touched {
  readonly table: string
  readonly ids: readonly string[]
}

async function ids(tx: TenantTransaction, query: ReturnType<typeof sql>): Promise<string[]> {
  const { rows } = await tx.execute<{ id: string }>(query)

  return rows.map((row) => row.id)
}

/**
 * Empties a customer and what hangs on it (#845), in the transaction that
 * wrote its line of the protocol, which is what opens the locks
 * (`customer_erasing`, migration 0130). What travels to the devices is
 * emptied and marked as deleted, never removed, so that every device learns
 * of it (ADR 0005); what stays on the server goes. The site, its
 * installations, their protocols and defects stay without anything of the
 * customer until #848; the jobs stay as empty rows, since the times of the
 * staff point at them (#846).
 *
 * Returns the keys of every row it touched, by table.
 */
export async function emptyCustomer(
  tx: TenantTransaction,
  customerId: CustomerId,
): Promise<Touched[]> {
  const k = sql`${customerId}::uuid`
  const jobsOf = sql`(select id from jobs where customer_id = ${k})`
  const documentsOf = sql`(select id from documents where customer_id = ${k})`
  const sitesOf = sql`(select id from sites where customer_id = ${k})`
  const appointmentsOf = sql`(select id from appointments where job_id in ${jobsOf})`
  const requestsOf = sql`(select id from early_start_requests where job_id in ${jobsOf})`
  const deadlinesOf = sql`(select id from deadlines
    where customer_id = ${k} or job_id in ${jobsOf} or document_id in ${documentsOf})`
  const touched: Touched[] = []
  const take = async (table: string, query: ReturnType<typeof sql>) => {
    touched.push({ table, ids: await ids(tx, query) })
  }

  // The outbox belongs to the foundation: what it holds of the customer is
  // emptied, and a mail still waiting is given up, so that none goes out.
  await take(
    'mail_outbox',
    sql`update mail_outbox
       set recipient_address = '', recipient_name = null, subject = '', body = '', attachment = null,
           status = case when status = 'pending' then 'failed' else status end,
           last_error = case when status = 'pending' then 'Kunde gelöscht' else last_error end
     where document_id in ${documentsOf} or job_id in ${jobsOf} or appointment_id in ${appointmentsOf}
        or early_start_request_id in ${requestsOf} or deadline_id in ${deadlinesOf}
    returning id`,
  )

  // What stays on the server goes.
  await take('payments', sql`delete from payments where document_id in ${documentsOf} returning id`)
  await take(
    'offer_declines',
    sql`delete from offer_declines where document_id in ${documentsOf} returning id`,
  )
  await take(
    'document_instruction_choices',
    sql`delete from document_instruction_choices where document_id in ${documentsOf} returning id`,
  )
  await take(
    'document_snapshots',
    sql`delete from document_snapshots where document_id in ${documentsOf} returning id`,
  )
  // The file of each goes with it (`document_file_takes_its_file`).
  await take(
    'document_files',
    sql`delete from document_files where document_id in ${documentsOf} returning id`,
  )
  await take(
    'communications',
    sql`delete from communications where customer_id = ${k} returning id`,
  )
  await take('prospects', sql`delete from prospects where customer_id = ${k} returning id`)

  // The files of the customer and its jobs go for good (#712); those of its
  // sites and installations stay with them.
  const { rows: files } = await tx.execute<{ id: string }>(sql`
    select id from attachments where customer_id = ${k} or job_id in ${jobsOf}`)
  const fileIds = files.map((row) => row.id)

  if (fileIds.length > 0) {
    const fileList = sql`array[${sql.join(
      fileIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[]`

    await take(
      'attachment_versions',
      sql`select id from attachment_versions where attachment_id = any(${fileList})`,
    )

    for (const id of fileIds) {
      await tx.execute(sql`select purge_attachment(${id}::uuid, 'Gelöscht')`)
    }

    touched.push({ table: 'attachments', ids: fileIds })
  }

  // What travels is emptied and marked.
  await take(
    'document_sources',
    sql`update document_sources set deleted_at = coalesce(deleted_at, now())
     where document_id in ${documentsOf} returning id`,
  )
  // A signature keeps a path; a single point draws nothing.
  await take(
    'document_signatures',
    sql`update document_signatures
       set signer_name = 'Gelöscht', path = 'M0,0', device_info = null, deleted_at = coalesce(deleted_at, now())
     where document_id in ${documentsOf} returning id`,
  )
  await take(
    'document_lines',
    sql`update document_lines set designation = 'Gelöscht', description = null,
           deleted_at = coalesce(deleted_at, now())
     where document_id in ${documentsOf} returning id`,
  )
  await take(
    'documents',
    sql`update documents set subject = null, intro_text = null, closing_text = null, field_values = null,
           deleted_at = coalesce(deleted_at, now())
     where customer_id = ${k} returning id`,
  )
  await take(
    'job_notes',
    sql`update job_notes set text = 'Gelöscht', deleted_at = coalesce(deleted_at, now())
     where job_id in ${jobsOf} returning id`,
  )
  await take(
    'early_start_requests',
    sql`update early_start_requests
       set signer_name = 'Gelöscht', path = 'M0,0', device_info = null, deleted_at = coalesce(deleted_at, now())
     where job_id in ${jobsOf} returning id`,
  )
  await take(
    'appointment_people',
    sql`update appointment_people set deleted_at = coalesce(deleted_at, now())
     where appointment_id in ${appointmentsOf} returning id`,
  )
  await take(
    'appointments',
    sql`update appointments set note = null, deleted_at = coalesce(deleted_at, now())
     where job_id in ${jobsOf} returning id`,
  )
  await take(
    'tasks',
    sql`update tasks set title = 'Gelöscht', notes = null, deleted_at = coalesce(deleted_at, now())
     where customer_id = ${k} or job_id in ${jobsOf} or site_id in ${sitesOf} returning id`,
  )
  await take(
    'deadlines',
    sql`update deadlines set source_label = 'Gelöscht' where id in ${deadlinesOf} returning id`,
  )
  await take(
    'maintenance_contracts',
    sql`update maintenance_contracts set designation = 'Gelöscht', services = null
     where customer_id = ${k} returning id`,
  )
  // The ways into its sites go with the customer, with their sealed values.
  const accesses = await ids(
    tx,
    sql`update site_accesses set designation = 'Gelöscht', hint = null, deleted_at = coalesce(deleted_at, now())
     where site_id in ${sitesOf} returning id`,
  )
  touched.push({ table: 'site_accesses', ids: accesses })

  if (accesses.length > 0) {
    await tx.execute(
      sql`delete from secrets where record_id = any(array[${sql.join(
        accesses.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[])`,
    )
  }

  await take(
    'contacts',
    sql`update contacts set given_name = null, family_name = 'Gelöscht', role = null, email = null,
           phone = null, mobile = null, deleted_at = coalesce(deleted_at, now())
     where customer_id = ${k} or site_id in ${sitesOf} returning id`,
  )
  await take('sites', sql`update sites set notes = null where customer_id = ${k} returning id`)
  await take(
    'customer_tags',
    sql`update customer_tags set deleted_at = coalesce(deleted_at, now())
     where customer_id = ${k} returning id`,
  )
  await take(
    'jobs',
    sql`update jobs set designation = 'Gelöschter Auftrag', description = null,
           deleted_at = coalesce(deleted_at, now())
     where customer_id = ${k} returning id`,
  )
  await take(
    'customers',
    sql`update customers set name = 'Gelöschter Kunde', email = null, phone = null, street = null,
           house_number = null, postal_code = null, city = null, vat_id = null, buyer_reference = null,
           tax_exemption_certificate_number = null, tax_exemption_valid_until = null, notes = null,
           reminder_ground = null, reminder_ground_on = null, source = null,
           deleted_at = coalesce(deleted_at, now())
     where id = ${k} returning id`,
  )

  return touched.filter((entry) => entry.ids.length > 0)
}

/** The most entries blacked out in one statement. */
const redactedAtOnce = 500

/**
 * Blacks out every value the change log holds of the rows a deletion
 * touched (ADR 0013), with the reason of its kind; `redactRecord` for many
 * records at once. Returns how many values it blacked out.
 */
export async function redactRecords(
  tx: TenantTransaction,
  input: {
    readonly tenantId: TenantId
    readonly userId: string
    readonly touched: readonly Touched[]
    readonly reason: string
  },
): Promise<number> {
  let count = 0

  for (const { table, ids: recordIds } of input.touched) {
    for (let start = 0; start < recordIds.length; start += redactedAtOnce) {
      const slice = recordIds.slice(start, start + redactedAtOnce)
      const entries = await tx
        .select({
          id: auditEntries.id,
          old: sql<boolean>`${auditEntries.oldValue} is not null`,
          new: sql<boolean>`${auditEntries.newValue} is not null`,
        })
        .from(auditEntries)
        .where(and(eq(auditEntries.tableName, table), inArray(auditEntries.recordId, slice)))
      const sides = entries.flatMap((entry) => [
        ...(entry.old ? [{ entryId: entry.id, side: 'old' as const }] : []),
        ...(entry.new ? [{ entryId: entry.id, side: 'new' as const }] : []),
      ])

      for (let at = 0; at < sides.length; at += redactedAtOnce) {
        await tx.insert(auditRedactions).values(
          sides.slice(at, at + redactedAtOnce).map((side) => ({
            tenantId: input.tenantId,
            entryId: side.entryId,
            side: side.side,
            reason: input.reason,
            redactedBy: input.userId,
          })),
        )
      }

      count += sides.length
    }
  }

  return count
}

/**
 * Answers an open request by restricting its customer (Art. 18 DSGVO): the
 * database lets only whoever leads do it, and only from open. Whether the
 * customer may be restricted rather than deleted is the caller's to ask.
 */
export async function restrictCustomer(tx: TenantTransaction, requestId: string): Promise<boolean> {
  const updated = await tx
    .update(erasureRequests)
    .set({ status: 'restricted', restrictedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(erasureRequests.id, requestId as never), eq(erasureRequests.status, 'open')))
    .returning({ id: erasureRequests.id })

  return updated.length > 0
}

/** The customers restricted today, by key, for the pull and the mails to leave out. */
export async function restrictedCustomers(tx: TenantTransaction): Promise<string[]> {
  const rows = await tx
    .select({ customerId: erasureRequests.customerId })
    .from(erasureRequests)
    .where(eq(erasureRequests.status, 'restricted'))
    .orderBy(erasureRequests.customerId)

  return rows.map((row) => row.customerId)
}

/** The SQL that holds a customer's key to those not restricted, for a mail or a list. */
export function notRestricted(customerId: ReturnType<typeof sql> | typeof customers.id) {
  return sql`not exists (select 1 from erasure_requests r
    where r.customer_id = ${customerId} and r.status = 'restricted')`
}

/**
 * Whether a customer is restricted on a request for deletion (#845, Art. 18
 * DSGVO): asked by every way a mail to a customer goes, which then sends
 * none.
 */
export async function customerRestricted(
  tx: TenantTransaction,
  customerId: string,
): Promise<boolean> {
  const [found] = await tx
    .select({ id: erasureRequests.id })
    .from(erasureRequests)
    .where(
      and(
        eq(erasureRequests.customerId, customerId as CustomerId),
        eq(erasureRequests.status, 'restricted'),
      ),
    )
    .limit(1)

  return found !== undefined
}
