import type { Document } from '../model/document.js'
import { isInvoice, retentionNote, taxNotes } from '../model/document.js'
import type {
  DocumentContent,
  IssuerContent,
  LineContent,
  RecipientContent,
  SiteContent,
} from '../model/document-content.js'
import { documentContentVersion } from '../model/document-content.js'
import type { DocumentLine } from '../model/document-line.js'
import { totalsFor } from './invoice.js'
import type { RuleSet } from './rule.js'

/** What a document is put together from. Gathering it is the caller's work. */
export interface ContentSources {
  readonly document: Pick<
    Document,
    'kind' | 'number' | 'documentDate' | 'serviceFrom' | 'serviceUntil' | 'subject' | 'taxTreatment'
  >
  readonly lines: readonly Pick<DocumentLine, keyof LineContent>[]
  readonly issuer: IssuerContent
  readonly recipient: RecipientContent
  readonly site: SiteContent | null
}

/**
 * The sentences a document has to carry, in the order they are printed.
 *
 * The tax note first, because it explains the totals right above it: an
 * invoice without tax has to say why, and the paragraph named in the sentence
 * is what makes it valid. On a quote it says the same thing for the same
 * reason, so it is not limited to invoices.
 *
 * The note on keeping the invoice only where section 14 (4) number 9 UStG asks
 * for it: an invoice, taxed as usual, to somebody who is not a business. Under
 * section 19 there is no taxable supply for the obligation to hang on, and a
 * reverse charge only ever goes to a business.
 */
export function printedNotes(document: {
  readonly kind: Document['kind']
  readonly taxTreatment: Document['taxTreatment']
  readonly recipientIsBusiness: boolean
}): readonly string[] {
  const notes: string[] = []
  const taxNote = taxNotes[document.taxTreatment]

  if (taxNote) {
    notes.push(taxNote)
  }

  if (
    isInvoice(document.kind) &&
    document.taxTreatment === 'standard' &&
    !document.recipientIsBusiness
  ) {
    notes.push(retentionNote)
  }

  return notes
}

/**
 * Puts a document together from its parts, the way it will be printed.
 *
 * Pure, and that is what lets the same function serve two moments: the check
 * before a document is issued, and the record written when it is. A device
 * could run it as well and would come to the same answer, because the rules
 * go in by hand and nothing here asks what today is.
 *
 * The lines are copied field by field rather than passed through. A row from
 * the database carries its tenant, its sync columns and its id, and none of
 * those belong in a record that is meant to say what the customer was sent.
 */
export function documentContent(rules: RuleSet, sources: ContentSources): DocumentContent {
  const { document } = sources

  // Sorted here as well, although the caller usually asks for them in order.
  // A stable sort keeps two lines that share a position in the order they came.
  const lines: LineContent[] = [...sources.lines]
    .sort((left, right) => left.position - right.position)
    .map((line) => ({
      position: line.position,
      designation: line.designation,
      description: line.description,
      quantityMilli: line.quantityMilli,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      vatRate: line.vatRate,
      netCents: line.netCents,
    }))

  return {
    version: documentContentVersion,
    kind: document.kind,
    number: document.number,
    documentDate: document.documentDate,
    serviceFrom: document.serviceFrom,
    serviceUntil: document.serviceUntil,
    subject: document.subject,
    taxTreatment: document.taxTreatment,
    issuer: sources.issuer,
    recipient: sources.recipient,
    site: sources.site,
    lines,
    totals: totalsFor(rules, lines, document),
    notes: printedNotes({
      kind: document.kind,
      taxTreatment: document.taxTreatment,
      recipientIsBusiness: sources.recipient.isBusiness,
    }),
  }
}
