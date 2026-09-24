import {
  currentContent,
  type DocumentId,
  type IsoDate,
  type Payment,
  paymentProblem,
  receivesPayments,
  type TenantId,
} from '@opengewerk/domain'
import { and, asc, eq, sql } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { documents, documentSnapshots, payments } from '../database/schema/index.js'

/** A payment that is not recorded, with the sentence saying why. */
export class PaymentRefused extends Error {}

/** What came in on an invoice, and what that leaves open. */
export interface PaymentsOf {
  readonly payments: readonly Payment[]
  /** What the invoice asks for, gross, as its frozen state says. */
  readonly billedCents: number
  readonly receivedCents: number
}

function asPayment(row: typeof payments.$inferSelect): Payment {
  return {
    id: row.id,
    documentId: row.documentId as DocumentId,
    amountCents: row.amountCents,
    receivedOn: row.receivedOn as IsoDate,
  }
}

/**
 * The payments of one invoice, oldest first, and what the invoice asks for.
 *
 * What it asks for comes from its snapshot, the figures that were printed:
 * the amount after deductions on a final invoice or a cumulative progress
 * invoice, and the totals on any other. Null for a document that takes no
 * payments, or one not issued yet, which has no snapshot and is not owed.
 */
export async function paymentsOf(
  tx: TenantTransaction,
  documentId: DocumentId,
): Promise<PaymentsOf | null> {
  const [document] = await tx
    .select({ kind: documents.kind, status: documents.status })
    .from(documents)
    .where(eq(documents.id, documentId))

  if (!document || !receivesPayments(document.kind) || document.status === 'draft') {
    return null
  }

  const [snapshot] = await tx
    .select({ content: documentSnapshots.content })
    .from(documentSnapshots)
    .where(eq(documentSnapshots.documentId, documentId))

  if (!snapshot) {
    return null
  }

  const rows = await tx
    .select()
    .from(payments)
    .where(eq(payments.documentId, documentId))
    .orderBy(asc(payments.receivedOn), asc(payments.createdAt))

  return {
    payments: rows.map(asPayment),
    billedCents: currentContent(snapshot.content).billed.grossCents,
    receivedCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  }
}

/**
 * Records a payment on an issued invoice.
 *
 * Refused, with the sentence the form would show, when it is no payment the
 * domain accepts, when the document takes none, and when it would bring what
 * came in above what the invoice asks for. More than that is an overpayment,
 * which belongs to the open items of phase 3; taken off a final invoice, it
 * would make the final invoice give back money nobody decided to give back.
 */
export async function recordPayment(
  tx: TenantTransaction,
  tenantId: TenantId,
  documentId: DocumentId,
  payment: { readonly amountCents: unknown; readonly receivedOn: unknown },
  today: IsoDate,
): Promise<Payment> {
  const problem = paymentProblem(payment, today)

  if (problem !== null) {
    throw new PaymentRefused(problem)
  }

  // The row of the document is locked for the rest of the transaction, so
  // that two payments recorded at the same moment are counted one after the
  // other and cannot together pass what the invoice asks for.
  await tx.execute(sql`select 1 from documents where id = ${documentId} for update`)

  const [document] = await tx
    .select({ kind: documents.kind, status: documents.status })
    .from(documents)
    .where(eq(documents.id, documentId))

  if (!document) {
    throw new PaymentRefused('Diesen Beleg gibt es nicht.')
  }

  if (!receivesPayments(document.kind)) {
    throw new PaymentRefused('Ein Eingang wird nur zu einer Rechnung erfasst, die etwas fordert.')
  }

  if (document.status !== 'issued') {
    throw new PaymentRefused(
      document.status === 'cancelled'
        ? 'Die Rechnung ist storniert, auf sie geht nichts mehr ein.'
        : 'Ein Eingang wird erst zu einer festgeschriebenen Rechnung erfasst.',
    )
  }

  const open = await paymentsOf(tx, documentId)

  if (!open) {
    throw new PaymentRefused('Zu dieser Rechnung ist nicht festgehalten, was sie fordert.')
  }

  const amountCents = payment.amountCents as number

  if (open.receivedCents + amountCents > open.billedCents) {
    throw new PaymentRefused(
      'So viel fordert die Rechnung nicht. Offen ist noch ' +
        `${euros(Math.max(open.billedCents - open.receivedCents, 0))}.`,
    )
  }

  const [row] = await tx
    .insert(payments)
    .values({
      tenantId,
      documentId,
      amountCents,
      receivedOn: payment.receivedOn as IsoDate,
    })
    .returning()

  if (!row) {
    throw new Error('The payment was not written.')
  }

  return asPayment(row)
}

/** Removes a payment recorded by mistake. True when there was one to remove. */
export async function removePayment(
  tx: TenantTransaction,
  documentId: DocumentId,
  paymentId: string,
): Promise<boolean> {
  const removed = await tx
    .delete(payments)
    .where(and(eq(payments.id, paymentId as never), eq(payments.documentId, documentId)))
    .returning({ id: payments.id })

  return removed.length > 0
}

/**
 * What came in on each of these invoices, the sum and the day of the last
 * payment, keyed by invoice. An invoice nothing came in on is missing.
 */
export async function receivedOn(
  tx: TenantTransaction,
  documentIds: readonly DocumentId[],
): Promise<Map<string, { readonly cents: number; readonly lastOn: IsoDate }>> {
  const found = new Map<string, { cents: number; lastOn: IsoDate }>()

  for (const documentId of documentIds) {
    const rows = await tx
      .select({ amountCents: payments.amountCents, receivedOn: payments.receivedOn })
      .from(payments)
      .where(eq(payments.documentId, documentId))

    if (rows.length === 0) {
      continue
    }

    found.set(documentId, {
      cents: rows.reduce((sum, row) => sum + row.amountCents, 0),
      lastOn: rows
        .map((row) => row.receivedOn as IsoDate)
        .sort()
        .at(-1) as IsoDate,
    })
  }

  return found
}

const format = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

function euros(cents: number): string {
  return format.format(cents / 100)
}
