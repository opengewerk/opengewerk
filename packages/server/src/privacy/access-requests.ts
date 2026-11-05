import {
  type AccessRequest,
  type AccessRequestId,
  type AccessRequestView,
  type AccessSubjectHit,
  accessDay,
  answeredShownMonths,
  type IsoDate,
  type PersonalSubject,
  addMonths,
} from '@opengewerk/domain'
import { type TenantTransaction } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'

import { accessRequests } from '../database/schema/index.js'

/** What a request reads as, from its row. */
export function accessRequestOf(row: typeof accessRequests.$inferSelect): AccessRequest {
  return {
    id: row.id as AccessRequestId,
    subject: row.subject,
    subjectId: row.customerId ?? row.contactId ?? row.prospectId ?? row.personId ?? null,
    receivedOn: row.receivedOn as IsoDate,
    channel: row.channel,
    status: row.status,
    answerDueOn: row.answerDueOn as IsoDate,
    producedAt: row.producedAt?.toISOString() ?? null,
    producedBy: row.producedBy,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }
}

/** A person as a request and the search name them: the name and what tells them apart. */
interface Named {
  readonly subject: PersonalSubject
  readonly id: string
  readonly name: string
  readonly detail: string
}

function addressOf(row: Record<string, unknown>): string {
  const street = [row['street'], row['house_number']].filter(Boolean).join(' ')
  const place = [row['postal_code'], row['city']].filter(Boolean).join(' ')

  return [street, place].filter((part) => part !== '').join(', ')
}

/** The query that names the people of one kind, narrowed by a condition on their row. */
function namesQuery(subject: PersonalSubject, where: ReturnType<typeof sql>) {
  switch (subject) {
    case 'customer':
      return sql`select c.id::text as id, c.name, c.street, c.house_number, c.postal_code, c.city,
                        null::text as owner, null::date as last_contact_on, null::date as left_on
                   from customers c where ${where} order by c.name limit 20`
    case 'contact':
      return sql`select k.id::text as id,
                        trim(concat_ws(' ', k.given_name, k.family_name)) as name,
                        null as street, null as house_number, null as postal_code, null as city,
                        coalesce(c.name, s.name) as owner, null::date as last_contact_on, null::date as left_on
                   from contacts k
                   left join customers c on c.id = k.customer_id
                   left join suppliers s on s.id = k.supplier_id
                  where ${where} order by k.family_name, k.given_name limit 20`
    case 'prospect':
      return sql`select p.id::text as id, p.name, null as street, null as house_number, null as postal_code,
                        null as city, null::text as owner, p.last_contact_on, null::date as left_on
                   from prospects p where ${where} order by p.name limit 20`
    case 'person':
      return sql`select p.id::text as id, p.name, null as street, null as house_number, null as postal_code,
                        null as city, null::text as owner, null::date as last_contact_on, p.left_on
                   from people p where ${where} order by p.name limit 20`
  }
}

function detailOf(subject: PersonalSubject, row: Record<string, unknown>): string {
  switch (subject) {
    case 'customer': {
      const address = addressOf(row)

      return address === '' ? 'Kunde' : `Kunde, ${address}`
    }
    case 'contact':
      return typeof row['owner'] === 'string' && row['owner'] !== ''
        ? `Ansprechpartner bei ${row['owner']}`
        : 'Ansprechpartner'
    case 'prospect':
      return typeof row['last_contact_on'] === 'string'
        ? `Lead, letzter Kontakt ${accessDay(row['last_contact_on'] as IsoDate)}`
        : 'Lead'
    case 'person':
      return typeof row['left_on'] === 'string'
        ? `Mitarbeiter, ausgetreten am ${accessDay(row['left_on'] as IsoDate)}`
        : 'Mitarbeiter'
  }
}

/** The condition that keeps what is gone or deleted out of the search. */
function stillThere(subject: PersonalSubject) {
  switch (subject) {
    case 'customer':
      return sql`c.deleted_at is null`
    case 'contact':
      return sql`k.deleted_at is null`
    case 'prospect':
      return sql`true`
    case 'person':
      return sql`p.deleted_at is null`
  }
}

function nameColumn(subject: PersonalSubject) {
  switch (subject) {
    case 'customer':
      return sql`c.name`
    case 'contact':
      return sql`concat_ws(' ', k.given_name, k.family_name)`
    case 'prospect':
      return sql`p.name`
    case 'person':
      return sql`p.name`
  }
}

function idColumn(subject: PersonalSubject) {
  switch (subject) {
    case 'customer':
      return sql`c.id`
    case 'contact':
      return sql`k.id`
    case 'prospect':
      return sql`p.id`
    case 'person':
      return sql`p.id`
  }
}

const kinds: readonly PersonalSubject[] = ['customer', 'contact', 'prospect', 'person']

/**
 * The customers, contacts, leads and files whose name holds what was typed,
 * at most twenty of each kind, for the office to record a request for. What
 * is deleted is not found, a restricted customer is: it may ask what is left.
 */
export async function findSubjects(
  tx: TenantTransaction,
  typed: string,
): Promise<AccessSubjectHit[]> {
  const pattern = `%${typed.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`
  const hits: AccessSubjectHit[] = []

  for (const subject of kinds) {
    const { rows } = await tx.execute<Record<string, unknown>>(
      namesQuery(subject, sql`${stillThere(subject)} and ${nameColumn(subject)} ilike ${pattern}`),
    )

    hits.push(
      ...rows.map((row) => ({
        subject,
        id: String(row['id']),
        name: String(row['name'] ?? ''),
        detail: detailOf(subject, row),
      })),
    )
  }

  return hits.sort((one, other) => one.name.localeCompare(other.name, 'de'))
}

/** One person by kind and key, as the business still has them, or null. */
export async function subjectOf(
  tx: TenantTransaction,
  subject: PersonalSubject,
  id: string,
): Promise<Named | null> {
  const { rows } = await tx.execute<Record<string, unknown>>(
    namesQuery(subject, sql`${idColumn(subject)}::text = ${id.toLowerCase()}`),
  )
  const [row] = rows

  return row === undefined
    ? null
    : {
        subject,
        id: String(row['id']),
        name: String(row['name'] ?? ''),
        detail: detailOf(subject, row),
      }
}

/**
 * The requests the screen lists: those that run, oldest first, then those
 * answered in the last twelve months, newest first, each with whom it is
 * about. A request whose lead went is listed without a name.
 */
export async function accessRequestsOf(
  tx: TenantTransaction,
  today: IsoDate,
): Promise<AccessRequestView[]> {
  const since = addMonths(today, -answeredShownMonths)
  const rows = await tx
    .select()
    .from(accessRequests)
    .where(sql`${accessRequests.status} = 'open' or ${accessRequests.answeredAt} >= ${since}::date`)
  const views: AccessRequestView[] = []

  for (const row of rows) {
    const request = accessRequestOf(row)
    const named =
      request.subjectId === null ? null : await subjectOf(tx, request.subject, request.subjectId)

    views.push({
      request,
      name: named?.name ?? null,
      detail: named?.detail ?? 'Gelöscht nach dem Löschkonzept',
    })
  }

  const open = views
    .filter((view) => view.request.status === 'open')
    .sort((one, other) => one.request.receivedOn.localeCompare(other.request.receivedOn))
  const answered = views
    .filter((view) => view.request.status === 'answered')
    .sort((one, other) =>
      (other.request.answeredAt ?? '').localeCompare(one.request.answeredAt ?? ''),
    )

  return [...open, ...answered]
}
