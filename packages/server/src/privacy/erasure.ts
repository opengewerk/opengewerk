import {
  customerErasureLabel,
  customerHoldSentence,
  type DueErasure,
  type Erasure,
  type ErasureAutomation,
  type ErasureId,
  type ErasureKind,
  erasureKindWords,
  type IsoDate,
  personErasureLabel,
  personHoldSentence,
  prospectErasureLabel,
  prospectSourceLabel,
  sicknessErasureLabel,
  siteHoldSentence,
  staffYearErasureLabel,
  type TenantId,
} from '@opengewerk/domain'
import { idArray, leadsItsTenant, type TenantTransaction } from '@opengewerk/platform-server'
import { auditEntries, auditRedactions, memberships } from '@opengewerk/platform-server/schema'
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'

import {
  customers,
  deadlines,
  erasureAutomations,
  erasureRequests,
  erasures,
  prospects,
} from '../database/schema/index.js'
import { customerStandings, emptyCustomer, redactRecords } from './customer-erasure.js'
import { dueSites, emptySite } from './site-erasure.js'
import {
  duePeople,
  dueSicknesses,
  dueStaffYears,
  type StaffTouched,
  takePerson,
  takeSickness,
  takeStaffYear,
} from './staff-erasure.js'

/** What the change log calls a deletion under the concept, and its switch. */
export const erasureReason = 'privacy.erase'
export const automationReason = 'privacy.automation'

/** Why a deletion is refused to somebody who does not lead the business. */
export const leadersOnly =
  'Löschen nach dem Löschkonzept und es auf automatisch stellen darf nur, wer den Betrieb führt.'

/**
 * Whether a person leads the business of the transaction today: a membership
 * of hers, not blocked and not past its last day, with a role that leads. The
 * policies of `erasures`, `erasure_automations` and `audit_redactions` ask the
 * same of the person in the request; this asks it of anybody, for the pass
 * that deletes in the name of who switched it on.
 */
export async function personLeads(tx: TenantTransaction, userId: string, today: IsoDate) {
  const [found] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        leadsItsTenant(),
        isNull(memberships.blockedAt),
        sql`(${memberships.lastDay} is null or ${memberships.lastDay} >= ${today})`,
      ),
    )
    .limit(1)

  return found !== undefined
}

/**
 * Blacks out every value the change log holds of one record (ADR 0013), with
 * the reason of its kind: each side of each entry that still has a value and
 * is not blacked out already. The database checks that the person of the
 * transaction leads the business and that every entry is as it was written;
 * a refusal rolls back the deletion it belongs to.
 *
 * Returns how many values it blacked out.
 */
export async function redactRecord(
  tx: TenantTransaction,
  input: {
    readonly tenantId: TenantId
    readonly userId: string
    readonly table: string
    readonly recordId: string
    readonly reason: string
  },
): Promise<number> {
  const entries = await tx
    .select({
      id: auditEntries.id,
      old: sql<boolean>`${auditEntries.oldValue} is not null`,
      new: sql<boolean>`${auditEntries.newValue} is not null`,
    })
    .from(auditEntries)
    .where(and(eq(auditEntries.tableName, input.table), eq(auditEntries.recordId, input.recordId)))
    .orderBy(asc(auditEntries.sequence))

  const sides = entries.flatMap((entry) => [
    ...(entry.old ? [{ entryId: entry.id, side: 'old' as const }] : []),
    ...(entry.new ? [{ entryId: entry.id, side: 'new' as const }] : []),
  ])

  if (sides.length === 0) {
    return 0
  }

  await tx.insert(auditRedactions).values(
    sides.map((side) => ({
      tenantId: input.tenantId,
      entryId: side.entryId,
      side: side.side,
      reason: input.reason,
      redactedBy: input.userId,
    })),
  )

  return sides.length
}

/** The open deadlines of a kind of erasure that are due today, by the record they propose. */
async function dueDeadlinesOf(tx: TenantTransaction, kind: ErasureKind, today: IsoDate) {
  const rows = await tx
    .select({ id: deadlines.id, sourceId: deadlines.sourceId, dueOn: deadlines.dueOn })
    .from(deadlines)
    .where(
      and(
        eq(deadlines.kind, erasureKindWords[kind].deadline),
        eq(deadlines.status, 'open'),
        lte(deadlines.dueOn, today),
      ),
    )

  return new Map(rows.map((row) => [row.sourceId.toLowerCase(), row]))
}

/** Why a record is not deleted as asked, by its key. */
export class ErasureRefused extends Error {}

/**
 * Deletes leads under the deletion concept (#317), each one that is due and
 * never became a customer: the row goes, every value of it in the change log
 * is blacked out, and a line of the protocol says what went, without a name.
 * One transaction for all of them, so a refusal of any keeps every one.
 */
async function eraseProspects(
  tx: TenantTransaction,
  input: {
    readonly tenantId: TenantId
    readonly userId: string
    readonly ids: readonly string[]
    readonly automatic: boolean
    readonly today: IsoDate
  },
): Promise<Erasure[]> {
  const due = await dueDeadlinesOf(tx, 'prospect', input.today)
  const keys = input.ids.map((id) => id.toLowerCase())
  const rows = await tx
    .select()
    .from(prospects)
    .where(inArray(prospects.id, keys as (typeof prospects.$inferSelect)['id'][]))
    .for('update')
  const byKey = new Map(rows.map((row) => [row.id.toLowerCase(), row]))
  const written: Erasure[] = []

  for (const key of keys) {
    const prospect = byKey.get(key)
    const deadline = due.get(key)

    if (prospect === undefined) {
      throw new ErasureRefused('Ein ausgewählter Lead ist nicht mehr da.')
    }

    if (prospect.customerId !== null) {
      throw new ErasureRefused('Aus einem ausgewählten Lead ist ein Kunde geworden; er bleibt.')
    }

    if (deadline === undefined) {
      throw new ErasureRefused('Ein ausgewählter Lead ist noch nicht zum Löschen fällig.')
    }

    const label = prospectErasureLabel(prospect)

    await tx.delete(prospects).where(eq(prospects.id, prospect.id))

    const redactions = await redactRecord(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      table: 'prospects',
      recordId: prospect.id,
      reason: erasureKindWords.prospect.reason,
    })

    const [line] = await tx
      .insert(erasures)
      .values({
        tenantId: input.tenantId,
        kind: 'prospect',
        recordId: prospect.id,
        label,
        dueOn: deadline.dueOn,
        automatic: input.automatic,
        redactions,
        // Set by `record_note_author` from the person of the transaction.
        createdBy: input.userId,
      })
      .returning()

    if (line === undefined) {
      throw new Error('The protocol of the deletion concept took no line')
    }

    written.push(erasureOf(line))
  }

  return written
}

/**
 * Deletes customers under the deletion concept (#845), each one that nothing
 * holds any more and that is due or asked to be deleted: the line of the
 * protocol first, which opens the locks for this customer in this
 * transaction alone (`customer_erasing`), then the request is done, then the
 * customer and what hangs on it are emptied (`emptyCustomer`), and every
 * value of every row it touched is blacked out in the change log. One
 * transaction for all of them, so a refusal of any keeps every one.
 */
async function eraseCustomers(
  tx: TenantTransaction,
  input: {
    readonly tenantId: TenantId
    readonly userId: string
    readonly ids: readonly string[]
    readonly automatic: boolean
    readonly today: IsoDate
  },
): Promise<Erasure[]> {
  const due = await dueDeadlinesOf(tx, 'customer', input.today)
  const keys = input.ids.map((id) => id.toLowerCase())

  await tx
    .select({ id: customers.id })
    .from(customers)
    .where(inArray(customers.id, keys as (typeof customers.$inferSelect)['id'][]))
    .for('update')

  const standings = await customerStandings(tx, input.today, keys)
  const written: Erasure[] = []

  for (const key of keys) {
    const standing = standings.get(key)

    if (standing === undefined) {
      throw new ErasureRefused('Ein ausgewählter Kunde ist nicht mehr da.')
    }

    const [hold] = standing.holds

    if (hold !== undefined) {
      throw new ErasureRefused(`Ein ausgewählter Kunde bleibt noch: ${customerHoldSentence(hold)}`)
    }

    const deadline = due.get(key)

    if (deadline === undefined && standing.request === null) {
      throw new ErasureRefused('Ein ausgewählter Kunde ist noch nicht zum Löschen fällig.')
    }

    const requestedOn = standing.request?.receivedOn ?? null
    const [line] = await tx
      .insert(erasures)
      .values({
        tenantId: input.tenantId,
        kind: 'customer',
        recordId: standing.customerId,
        label: customerErasureLabel({
          kind: standing.kind,
          lastContactOn: standing.lastContactOn,
          requestedOn,
        }),
        dueOn: deadline?.dueOn ?? requestedOn,
        automatic: input.automatic,
        redactions: 0,
        // Set by `record_note_author` from the person of the transaction.
        createdBy: input.userId,
      })
      .returning()

    if (line === undefined) {
      throw new Error('The protocol of the deletion concept took no line')
    }

    if (standing.request !== null) {
      await tx
        .update(erasureRequests)
        .set({ status: 'erased', erasedAt: new Date(), updatedAt: new Date() })
        .where(eq(erasureRequests.id, standing.request.id as never))
    }

    const touched = await emptyCustomer(tx, standing.customerId)
    const redactions = await redactRecords(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      touched,
      reason: erasureKindWords.customer.reason,
    })
    const [counted] = await tx
      .update(erasures)
      .set({ redactions })
      .where(eq(erasures.id, line.id))
      .returning()

    written.push(erasureOf(counted ?? line))
  }

  return written
}

/** One record of the staff that is due (#846), as the list shows it and the deletion takes it. */
interface StaffRecord {
  readonly deadlineId: string
  readonly recordId: string
  /** Who it is, for the list before confirming. */
  readonly name: string
  /** What it is without a name, for the list and the protocol. */
  readonly label: string
  readonly dueOn: IsoDate
  readonly take: (tx: TenantTransaction) => Promise<StaffTouched[]>
}

type StaffKind = 'sickness' | 'staff_year' | 'person'

/**
 * The records of a kind of the staff a deadline proposes today, or of those
 * asked for, by their key: what the pass found due and is due still. A file
 * held by an access that has not ended is not among them.
 */
async function staffRecords(
  tx: TenantTransaction,
  kind: StaffKind,
  today: IsoDate,
  ids?: readonly string[],
): Promise<Map<string, StaffRecord>> {
  const due = await dueDeadlinesOf(tx, kind, today)
  const records: Omit<StaffRecord, 'deadlineId' | 'dueOn'>[] = []

  if (kind === 'sickness') {
    for (const sickness of await dueSicknesses(tx, today, ids)) {
      records.push({
        recordId: sickness.absenceId,
        name: sickness.personName,
        label: sicknessErasureLabel(sickness.lastDay),
        take: (inner) => takeSickness(inner, sickness.absenceId),
      })
    }
  } else if (kind === 'staff_year') {
    for (const year of await dueStaffYears(tx, today, ids)) {
      records.push({
        recordId: year.key,
        name: year.personName,
        label: staffYearErasureLabel(year.year),
        take: (inner) => takeStaffYear(inner, year),
      })
    }
  } else {
    for (const person of await duePeople(tx, today, ids)) {
      if (person.holds.length === 0) {
        records.push({
          recordId: person.personId,
          name: person.personName,
          label: personErasureLabel(person.leftOn),
          take: (inner) => takePerson(inner, person),
        })
      }
    }
  }

  return new Map(
    records.flatMap((record) => {
      const deadline = due.get(record.recordId.toLowerCase())

      return deadline === undefined
        ? []
        : [
            [
              record.recordId.toLowerCase(),
              { ...record, deadlineId: deadline.id, dueOn: deadline.dueOn as IsoDate },
            ] as const,
          ]
    }),
  )
}

/**
 * Deletes records of the staff under the deletion concept (#846), as
 * `eraseCustomers` does: for each, the line of the protocol first, so that the
 * locks of 0131 open, then the rows, then every value of them in the change
 * log blacked out, and the count. One transaction for all of them, so a
 * refusal of any keeps every one.
 */
async function eraseStaff(
  tx: TenantTransaction,
  kind: StaffKind,
  input: {
    readonly tenantId: TenantId
    readonly userId: string
    readonly ids: readonly string[]
    readonly automatic: boolean
    readonly today: IsoDate
  },
): Promise<Erasure[]> {
  const records = await staffRecords(tx, kind, input.today, input.ids)

  if (kind === 'person') {
    const [held] = (await duePeople(tx, input.today, input.ids)).filter(
      (person) => person.holds.length > 0,
    )
    const [hold] = held?.holds ?? []

    if (hold !== undefined) {
      throw new ErasureRefused(`Eine ausgewählte Akte bleibt noch: ${personHoldSentence(hold)}`)
    }
  }

  const written: Erasure[] = []

  for (const key of input.ids.map((id) => id.toLowerCase())) {
    const record = records.get(key)

    if (record === undefined) {
      throw new ErasureRefused(
        `${erasureKindWords[kind].one}: ein ausgewählter Eintrag ist nicht mehr da oder nicht zum Löschen fällig.`,
      )
    }

    const [line] = await tx
      .insert(erasures)
      .values({
        tenantId: input.tenantId,
        kind,
        recordId: record.recordId,
        label: record.label,
        dueOn: record.dueOn,
        automatic: input.automatic,
        redactions: 0,
        // Set by `record_note_author` from the person of the transaction.
        createdBy: input.userId,
      })
      .returning()

    if (line === undefined) {
      throw new Error('The protocol of the deletion concept took no line')
    }

    const touched = await record.take(tx)
    const redactions = await redactRecords(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      touched: touched.filter((entry) => entry.ids.length > 0),
      reason: erasureKindWords[kind].reason,
    })
    const [counted] = await tx
      .update(erasures)
      .set({ redactions })
      .where(eq(erasures.id, line.id))
      .returning()

    written.push(erasureOf(counted ?? line))
  }

  return written
}

/**
 * Deletes sites of deleted customers under the deletion concept (#848), as
 * `eraseStaff` does: for each, the line of the protocol first, so that the
 * locks of 0132 open for this site in this transaction alone
 * (`site_erasing`), then the site and everything that hangs on it are emptied
 * (`emptySite`), then every value of them in the change log is blacked out,
 * and the count. A site the pass did not find due, or one a maintenance
 * contract still holds, is refused. One transaction for all of them, so a
 * refusal of any keeps every one.
 */
async function eraseSites(
  tx: TenantTransaction,
  input: {
    readonly tenantId: TenantId
    readonly userId: string
    readonly ids: readonly string[]
    readonly automatic: boolean
    readonly today: IsoDate
  },
): Promise<Erasure[]> {
  const due = await dueDeadlinesOf(tx, 'site', input.today)
  const keys = input.ids.map((id) => id.toLowerCase())

  await tx.execute(sql`select id from sites where id = any(${idArray(keys)}) for update`)

  const standings = new Map(
    (await dueSites(tx, input.today, keys)).map((standing) => [
      standing.siteId.toLowerCase(),
      standing,
    ]),
  )
  const written: Erasure[] = []

  for (const key of keys) {
    const standing = standings.get(key)
    const deadline = due.get(key)

    if (standing === undefined || deadline === undefined) {
      throw new ErasureRefused(
        'Objekt: ein ausgewähltes Objekt ist nicht mehr da oder nicht zum Löschen fällig.',
      )
    }

    const [hold] = standing.holds

    if (hold !== undefined) {
      throw new ErasureRefused(`Ein ausgewähltes Objekt bleibt noch: ${siteHoldSentence(hold)}`)
    }

    const [line] = await tx
      .insert(erasures)
      .values({
        tenantId: input.tenantId,
        kind: 'site',
        recordId: standing.siteId,
        label: standing.label,
        dueOn: deadline.dueOn,
        automatic: input.automatic,
        redactions: 0,
        // Set by `record_note_author` from the person of the transaction.
        createdBy: input.userId,
      })
      .returning()

    if (line === undefined) {
      throw new Error('The protocol of the deletion concept took no line')
    }

    const touched = await emptySite(tx, standing.siteId)
    const redactions = await redactRecords(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      touched,
      reason: erasureKindWords.site.reason,
    })
    const [counted] = await tx
      .update(erasures)
      .set({ redactions })
      .where(eq(erasures.id, line.id))
      .returning()

    written.push(erasureOf(counted ?? line))
  }

  return written
}

/** Deletes records of a kind under the deletion concept, as `eraseProspects` says for leads. */
export function eraseRecords(
  tx: TenantTransaction,
  input: {
    readonly tenantId: TenantId
    readonly userId: string
    readonly kind: ErasureKind
    readonly ids: readonly string[]
    readonly automatic: boolean
    readonly today: IsoDate
  },
): Promise<Erasure[]> {
  switch (input.kind) {
    case 'prospect':
      return eraseProspects(tx, input)
    case 'customer':
      return eraseCustomers(tx, input)
    case 'sickness':
    case 'staff_year':
    case 'person':
      return eraseStaff(tx, input.kind, input)
    case 'site':
      return eraseSites(tx, input)
  }
}

function erasureOf(row: typeof erasures.$inferSelect): Erasure {
  return {
    id: row.id as ErasureId,
    kind: row.kind,
    label: row.label,
    dueOn: row.dueOn as IsoDate | null,
    erasedAt: row.createdAt.toISOString(),
    erasedBy: row.createdBy,
    automatic: row.automatic,
    redactions: row.redactions,
  }
}

function germanDay(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

/** The leads that are due, with who each is, for the office before it confirms. */
async function dueProspectsOf(tx: TenantTransaction, today: IsoDate): Promise<DueErasure[]> {
  const rows = await tx
    .select({
      deadlineId: deadlines.id,
      dueOn: deadlines.dueOn,
      recordId: prospects.id,
      name: prospects.name,
      source: prospects.source,
      concern: prospects.concern,
      lastContactOn: prospects.lastContactOn,
    })
    .from(deadlines)
    .innerJoin(prospects, sql`${prospects.id} = ${deadlines.sourceId}`)
    .where(
      and(
        eq(deadlines.kind, erasureKindWords.prospect.deadline),
        eq(deadlines.status, 'open'),
        lte(deadlines.dueOn, today),
        isNull(prospects.customerId),
      ),
    )
    .orderBy(asc(deadlines.dueOn), asc(prospects.name))

  return rows.map((row) => ({
    deadlineId: row.deadlineId,
    kind: 'prospect',
    recordId: row.recordId,
    name: row.name,
    detail: [
      prospectSourceLabel[row.source],
      row.concern,
      `letzter Kontakt ${germanDay(row.lastContactOn)}`,
    ]
      .filter((part): part is string => part !== null && part.trim() !== '')
      .join(' · '),
    dueOn: row.dueOn as IsoDate,
  }))
}

/**
 * The customers that are due (#845), with who each is: the label of its
 * deadline says why, by its last contact or its request.
 */
async function dueCustomersOf(tx: TenantTransaction, today: IsoDate): Promise<DueErasure[]> {
  const rows = await tx
    .select({
      deadlineId: deadlines.id,
      dueOn: deadlines.dueOn,
      recordId: customers.id,
      name: customers.name,
      label: deadlines.sourceLabel,
    })
    .from(deadlines)
    .innerJoin(customers, sql`${customers.id} = ${deadlines.sourceId}`)
    .where(
      and(
        eq(deadlines.kind, erasureKindWords.customer.deadline),
        eq(deadlines.status, 'open'),
        lte(deadlines.dueOn, today),
        isNull(customers.deletedAt),
      ),
    )
    .orderBy(asc(deadlines.dueOn), asc(customers.name))

  return rows.map((row) => ({
    deadlineId: row.deadlineId,
    kind: 'customer',
    recordId: row.recordId,
    name: row.name,
    detail: row.label,
    dueOn: row.dueOn as IsoDate,
  }))
}

/** What of the staff is due, of the kinds the person may read (#846). */
async function staffDueOf(
  tx: TenantTransaction,
  today: IsoDate,
  readable: readonly ErasureKind[],
): Promise<DueErasure[]> {
  const kinds = (['sickness', 'staff_year', 'person'] as const).filter((kind) =>
    readable.includes(kind),
  )
  const due: DueErasure[] = []

  for (const kind of kinds) {
    for (const record of (await staffRecords(tx, kind, today)).values()) {
      due.push({
        deadlineId: record.deadlineId,
        kind,
        recordId: record.recordId,
        name: record.name,
        detail: record.label,
        dueOn: record.dueOn,
      })
    }
  }

  return due
}

/**
 * The sites of deleted customers that are due (#848) and nothing holds, with
 * what each is called and where it stands: a site keeps its designation and
 * address until it goes, and the label says from when the ten years counted.
 */
async function dueSitesOf(tx: TenantTransaction, today: IsoDate): Promise<DueErasure[]> {
  const due = await dueDeadlinesOf(tx, 'site', today)

  return (await dueSites(tx, today))
    .flatMap((standing) => {
      const deadline = due.get(standing.siteId.toLowerCase())

      return deadline === undefined || standing.holds.length > 0
        ? []
        : [
            {
              deadlineId: deadline.id,
              kind: 'site' as const,
              recordId: standing.siteId,
              name: standing.name,
              detail: [standing.address, standing.label]
                .filter((part) => part.trim() !== '')
                .join(' · '),
              dueOn: deadline.dueOn as IsoDate,
            },
          ]
    })
    .sort(
      (left, right) => left.dueOn.localeCompare(right.dueOn) || left.name.localeCompare(right.name),
    )
}

/**
 * What is due, with who each record is, for the office before it confirms:
 * of each kind whose records the person may read (`read` of the kind).
 */
export async function dueErasuresOf(
  tx: TenantTransaction,
  today: IsoDate,
  readable: readonly ErasureKind[],
): Promise<DueErasure[]> {
  return [
    ...(readable.includes('prospect') ? await dueProspectsOf(tx, today) : []),
    ...(readable.includes('customer') ? await dueCustomersOf(tx, today) : []),
    ...(await staffDueOf(tx, today, readable)),
    ...(readable.includes('site') ? await dueSitesOf(tx, today) : []),
  ]
}

/** The protocol, newest first. */
export async function erasuresOf(tx: TenantTransaction, most = 200): Promise<Erasure[]> {
  const rows = await tx.select().from(erasures).orderBy(desc(erasures.createdAt)).limit(most)

  return rows.map(erasureOf)
}

/** The kinds that go by themselves, with who switched each on. */
export async function automationsOf(tx: TenantTransaction): Promise<ErasureAutomation[]> {
  const rows = await tx.select().from(erasureAutomations).orderBy(asc(erasureAutomations.kind))

  return rows.map((row) => ({
    kind: row.kind,
    enabledBy: row.createdBy,
    enabledAt: row.createdAt.toISOString(),
  }))
}

/**
 * Deletes the source of a deadline of a kind of erasure, as the action of the
 * engine (#317): only where the business set the kind to go by itself, and
 * only while who did so leads it. The deletion then happens in that person's
 * name, in the transaction of the action, which is the pass's alone; the
 * person and the reason are set for this transaction and no other. Otherwise
 * nothing happens, and the deadline waits under "Datenschutz".
 */
export async function eraseByItself(
  tx: TenantTransaction,
  input: {
    readonly tenantId: TenantId
    readonly kind: ErasureKind
    readonly sourceId: string
    readonly today: IsoDate
  },
): Promise<Erasure[]> {
  const [automation] = await tx
    .select()
    .from(erasureAutomations)
    .where(eq(erasureAutomations.kind, input.kind))
    .limit(1)

  if (automation === undefined || !(await personLeads(tx, automation.createdBy, input.today))) {
    return []
  }

  await tx.execute(sql`select set_config('app.user_id', ${automation.createdBy}, true),
                              set_config('app.reason', ${erasureReason}, true)`)

  try {
    return await eraseRecords(tx, {
      tenantId: input.tenantId,
      userId: automation.createdBy,
      kind: input.kind,
      ids: [input.sourceId],
      automatic: true,
      today: input.today,
    })
  } catch (error) {
    // A lead that became a customer or is gone since the pass found it is
    // nothing to delete: the deadline drops with the next pass.
    if (error instanceof ErasureRefused) {
      return []
    }

    throw error
  }
}
