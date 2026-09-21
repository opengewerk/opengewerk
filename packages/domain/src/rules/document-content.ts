import type { Document } from '../model/document.js'
import { isInvoice, retentionNote, showsPrices, taxNotes } from '../model/document.js'
import type {
  DeductionContent,
  DocumentContent,
  DocumentContentV2,
  DocumentContentV3,
  DocumentContentV4,
  DocumentContentV5,
  IssuerContent,
  LineContent,
  RecipientContent,
  SignatureContent,
  SiteContent,
  StoredDocumentContent,
} from '../model/document-content.js'
import { documentContentVersion } from '../model/document-content.js'
import type { DocumentLine } from '../model/document-line.js'
import { billedAfter, billedOf, totalsFor } from './invoice.js'
import type { RuleSet } from './rule.js'

/** What a document is put together from. Gathering it is the caller's work. */
export interface ContentSources {
  readonly document: Pick<
    Document,
    | 'kind'
    | 'number'
    | 'documentDate'
    | 'serviceFrom'
    | 'serviceUntil'
    | 'subject'
    | 'introText'
    | 'closingText'
    | 'taxTreatment'
  >
  readonly lines: readonly Pick<DocumentLine, keyof LineContent>[]
  readonly issuer: IssuerContent
  readonly recipient: RecipientContent
  readonly site: SiteContent | null
  readonly signature: SignatureContent | null
  /**
   * The progress invoices of the chain this document takes off, oldest first,
   * as their snapshots state them. Gathered by the caller, because finding them
   * means walking the chain and reading what was frozen, and empty for every
   * kind that deducts nothing.
   */
  readonly deductions: readonly DeductionContent[]
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

  // Only where there are figures for it to explain. A report without prices
  // that says no VAT is charged answers a question it never raised.
  if (taxNote && showsPrices(document.kind)) {
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
      kind: line.kind,
      position: line.position,
      designation: line.designation,
      description: line.description,
      quantityMilli: line.quantityMilli,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      vatRate: line.vatRate,
      netCents: line.netCents,
    }))

  const totals = totalsFor(rules, lines, document)

  return {
    version: documentContentVersion,
    kind: document.kind,
    number: document.number,
    documentDate: document.documentDate,
    serviceFrom: document.serviceFrom,
    serviceUntil: document.serviceUntil,
    subject: document.subject,
    introText: document.introText,
    closingText: document.closingText,
    taxTreatment: document.taxTreatment,
    issuer: sources.issuer,
    recipient: sources.recipient,
    site: sources.site,
    lines,
    totals,
    notes: printedNotes({
      kind: document.kind,
      taxTreatment: document.taxTreatment,
      recipientIsBusiness: sources.recipient.isBusiness,
    }),
    signature: sources.signature,
    deductions: sources.deductions,
    billed: billedAfter(totals, sources.deductions, document.taxTreatment),
    // Only a cancellation cancels something, and it is not put together here
    // but mirrored out of its invoice: see `cancellationOf`.
    corrects: null,
  }
}

/**
 * A stored snapshot in the shape of today, whatever shape it was written in.
 *
 * The snapshot itself is never rewritten, that is the point of it. What
 * changes is how it is read, one version at a time: a record from version 1
 * had no titles and no texts, so every line of it is a position and both texts
 * are empty; a record from version 2 had no signature; a record from version 3
 * deducted nothing and billed its totals; a record from version 4 cancelled
 * nothing; a record from version 5 kept nothing of the recipient that only an
 * e-invoice needs. That is exactly what each of them said when it was printed.
 * The figures, the addresses and the notes are carried over as they are.
 *
 * Version 5 is lifted with empty values and not with those of the customer
 * today. An e-invoice made out of such a record lacks them and says so, which
 * is better than one that carries an e-mail address the customer did not have
 * when the invoice went out.
 */
export function currentContent(stored: StoredDocumentContent): DocumentContent {
  switch (stored.version) {
    case documentContentVersion:
      return stored
    case 5:
      return {
        ...stored,
        version: documentContentVersion,
        recipient: { ...stored.recipient, email: null, vatId: null, buyerReference: null },
      }
    case 4: {
      const fifth: DocumentContentV5 = { ...stored, version: 5, corrects: null }

      return currentContent(fifth)
    }
    case 3: {
      const fourth: DocumentContentV4 = {
        ...stored,
        version: 4,
        deductions: [],
        billed: billedOf(stored.totals),
      }

      return currentContent(fourth)
    }
    case 2: {
      const third: DocumentContentV3 = { ...stored, version: 3, signature: null }

      return currentContent(third)
    }
    case 1: {
      const second: DocumentContentV2 = {
        ...stored,
        version: 2,
        introText: null,
        closingText: null,
        lines: stored.lines.map((line) => ({ ...line, kind: 'item' as const })),
      }

      return currentContent(second)
    }
  }
}
