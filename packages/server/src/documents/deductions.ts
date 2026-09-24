import {
  currentContent,
  type DeductionContent,
  type DocumentId,
  deducts,
  receivedShare,
  RuleError,
} from '@opengewerk/domain'
import { eq } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { documents, documentSnapshots } from '../database/schema/index.js'
import { receivedOn } from '../payments/payments.js'

type DocumentRow = typeof documents.$inferSelect

/**
 * The progress invoices a document takes off: every issued progress invoice
 * up its chain of predecessors, oldest first, with the figures its snapshot
 * states.
 *
 * Read from the snapshot and not from the lines, because the snapshot is what
 * was printed and sent. Worked out again from the rows, a correction to a rule
 * package in between would deduct an amount that differs from the one on the
 * customer's paper, and the chain would stop adding up.
 *
 * The chain is walked through `predecessorDocumentId`, the link every
 * successor gets. A cancelled progress invoice in it is passed over, because
 * its cancellation took back what it billed. A link that points back into the
 * part already walked ends the walk: the field can be set by hand on a draft,
 * and a loop in it must not hang the request.
 *
 * A final invoice also learns what came in on each of them (#189), from the
 * payments the office recorded, and takes that off instead of what was
 * billed: section 14 (5) UStG deducts the partial amounts received. Nothing
 * recorded is nothing received, and the office confirms that before the final
 * invoice is issued. A progress invoice keeps taking off what the ones before
 * it billed, which is what the cumulative progress invoice of section 4.2 does.
 */
export async function deductionsFor(
  tx: TenantTransaction,
  document: Pick<DocumentRow, 'id' | 'kind' | 'predecessorDocumentId'>,
): Promise<DeductionContent[]> {
  if (!deducts(document.kind)) {
    return []
  }

  const found: (DeductionContent & { readonly id: DocumentId })[] = []
  const walked = new Set<string>([document.id])
  let next: DocumentId | null = document.predecessorDocumentId

  while (next !== null && !walked.has(next)) {
    walked.add(next)

    const [row] = await tx
      .select({
        id: documents.id,
        kind: documents.kind,
        status: documents.status,
        number: documents.number,
        predecessorDocumentId: documents.predecessorDocumentId,
      })
      .from(documents)
      .where(eq(documents.id, next))

    if (!row) {
      break
    }

    if (row.kind === 'progress_invoice' && row.status === 'issued') {
      const [snapshot] = await tx
        .select({ content: documentSnapshots.content })
        .from(documentSnapshots)
        .where(eq(documentSnapshots.documentId, row.id))

      if (!snapshot) {
        // Every document issued since #71 has one. One issued before that has
        // no record of what it billed, and guessing an amount to deduct from
        // a final invoice is worse than saying so.
        throw new RuleError(
          `Für die Abschlagsrechnung ${row.number ?? row.id} ist nicht festgehalten, was sie ` +
            'gestellt hat, deshalb lässt sie sich nicht abziehen.',
        )
      }

      const content = currentContent(snapshot.content)

      found.push({
        id: row.id,
        number: content.number ?? row.number ?? '',
        documentDate: content.documentDate,
        taxTreatment: content.taxTreatment,
        billed: content.billed,
        received: null,
        receivedOn: null,
      })
    }

    next = row.predecessorDocumentId
  }

  // Walked from the newest back, printed from the oldest on.
  const oldestFirst = found.reverse()
  const came =
    document.kind === 'final_invoice'
      ? await receivedOn(
          tx,
          oldestFirst.map((entry) => entry.id),
        )
      : null

  return oldestFirst.map(({ id, ...deduction }) => {
    if (came === null) {
      return deduction
    }

    const paid = came.get(id)

    return {
      ...deduction,
      // Never more than it billed: an overpayment is for the open items of
      // phase 3 to settle, and recording one is refused before it gets here.
      received: receivedShare(
        deduction.billed,
        Math.min(paid?.cents ?? 0, Math.max(deduction.billed.grossCents, 0)),
      ),
      receivedOn: paid?.lastOn ?? null,
    }
  })
}
