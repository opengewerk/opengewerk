import { isCancellable } from '../model/document.js'
import type {
  CorrectionContent,
  DocumentContent,
  IssuerContent,
} from '../model/document-content.js'
import type { IsoDate } from '../model/identifier.js'
import type { BilledAmount, DocumentTotals } from './invoice.js'
import { RuleError, withoutNegativeZero } from './rule.js'

function opposite(value: number): number {
  return withoutNegativeZero(-value)
}

function turnedRound(billed: BilledAmount): BilledAmount {
  return {
    netCents: opposite(billed.netCents),
    taxCents: opposite(billed.taxCents),
    grossCents: opposite(billed.grossCents),
    byRate: billed.byRate.map((entry) => ({
      ...entry,
      netCents: opposite(entry.netCents),
      taxCents: opposite(entry.taxCents),
      grossCents: opposite(entry.grossCents),
    })),
  }
}

function totalsTurnedRound(totals: DocumentTotals): DocumentTotals {
  return { ...turnedRound(totals), taxNote: totals.taxNote }
}

/**
 * The cancellation of an invoice: the same document with every figure turned
 * round, and a note of which invoice it takes back. Leading decision 4 and
 * section 4.2: an issued invoice is never changed and never deleted, it is
 * cancelled, and both stay in the books.
 *
 * Mirrored out of what the invoice froze, and not put together again from its
 * rows. A cancellation has to take back exactly what was billed, to the cent
 * and with the deductions of a cumulative invoice included, and the frozen
 * record is the one statement of that. Worked out again from the lines under
 * today's rules, it could take back a figure that is not the one on the
 * customer's paper.
 *
 * The issuer is the business as it is today, because the cancellation is a
 * document it writes today. The recipient, the site and the time of the work
 * stay the invoice's own: the cancellation is about that invoice, to that
 * person, for that work. The texts around the lines stay behind, they were
 * the letter the invoice was.
 */
export function cancellationOf(
  original: DocumentContent,
  facts: {
    readonly number: string | null
    readonly documentDate: IsoDate
    readonly issuer: IssuerContent
  },
): DocumentContent {
  if (!isCancellable(original.kind) || original.number === null) {
    throw new RuleError('Storniert wird eine festgeschriebene Rechnung, und nichts anderes.')
  }

  const corrects: CorrectionContent = {
    kind: original.kind,
    number: original.number,
    documentDate: original.documentDate,
  }

  return {
    ...original,
    kind: 'cancellation_invoice',
    number: facts.number,
    documentDate: facts.documentDate,
    introText: null,
    closingText: null,
    issuer: facts.issuer,
    lines: original.lines.map((line) => ({
      ...line,
      quantityMilli: opposite(line.quantityMilli),
      netCents: opposite(line.netCents),
    })),
    totals: totalsTurnedRound(original.totals),
    deductions: original.deductions.map((deduction) => ({
      ...deduction,
      billed: turnedRound(deduction.billed),
    })),
    billed: turnedRound(original.billed),
    signature: null,
    corrects,
    // A cancellation gives back what the invoice asked for, it asks for
    // nothing itself, and the due date of the invoice is not one of its own.
    paymentTerm: null,
    // And it tells the customer nothing new: whatever went with the invoice
    // went with the invoice.
    instructions: [],
  }
}
