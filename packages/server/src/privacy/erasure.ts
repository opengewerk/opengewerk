import {
  type DueErasure,
  type Erasure,
  type ErasureAutomation,
  type ErasureId,
  type ErasureKind,
  erasureKindWords,
  type IsoDate,
  prospectErasureLabel,
  prospectSourceLabel,
  type TenantId,
} from '@opengewerk/domain'
import { leadsItsTenant, type TenantTransaction } from '@opengewerk/platform-server'
import { auditEntries, auditRedactions, memberships } from '@opengewerk/platform-server/schema'
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'

import { deadlines, erasureAutomations, erasures, prospects } from '../database/schema/index.js'

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

/** What is due, with who each record is, for the office before it confirms. */
export async function dueErasuresOf(tx: TenantTransaction, today: IsoDate): Promise<DueErasure[]> {
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
