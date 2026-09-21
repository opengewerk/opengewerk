import {
  ConflictException,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  currentContent,
  type DocumentContent,
  type DocumentId,
  type DocumentKind,
  type Duty,
  type EInvoiceGap,
  type EInvoiceProfile,
  type EInvoiceStatus,
  eInvoiceDuty,
  eInvoiceGaps,
  formatFor,
  missingDetails,
  RuleError,
  shippedRules,
  supplyDateOf,
} from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import { Database, type TenantTransaction } from '../database/database.js'
import { parameterAt } from '../database/parameters.js'
import { documents, documentSnapshots } from '../database/schema/index.js'
import { ciiInvoice } from '../documents/cii.js'
import { checkedCii, SchemaCheckError } from '../documents/cii-schema.js'
import { contentOf } from '../documents/content.js'
import { documentTitle } from '../documents/template.js'
import { zugferdPdf } from '../documents/zugferd.js'
import { RequiresPermission } from './authorization.js'
import { DocumentFiles } from './document-files.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * Whether the e-invoice is required for a document that goes out as one.
 *
 * Read with the claim the business had made for the day of the work, because
 * that is the day the transition of section 27 (38) UStG asks about. A shared
 * function, since the issuing refuses on it and the screen shows it, and the
 * two must never give different answers.
 */
export async function dutyOf(tx: TenantTransaction, content: DocumentContent): Promise<Duty> {
  const claim = await parameterAt(tx, 'e_invoice.transition_claimed', supplyDateOf(content))

  return eInvoiceDuty(shippedRules, content, claim?.value === 1)
}

/**
 * What an invoice that is about to be issued would lack for the e-invoice the
 * law requires of it. Empty when it goes out as a PDF, when the e-invoice is
 * not required yet, and when nothing is missing.
 *
 * The standard and not XRechnung. The law asks for an invoice in the
 * European standard, and XRechnung is the German usage of it, with more
 * demands than the law has; an invoice is not refused for lacking what only
 * XRechnung wants.
 */
export async function eInvoiceRefusals(
  tx: TenantTransaction,
  content: DocumentContent,
): Promise<readonly EInvoiceGap[]> {
  if (formatFor(shippedRules, content).format !== 'e_invoice') {
    return []
  }

  return (await dutyOf(tx, content)).required ? eInvoiceGaps(content, 'en16931') : []
}

/** The document and the content it says, frozen or, for a draft, as it stands. */
async function contentFor(
  tx: TenantTransaction,
  documentId: string,
): Promise<{
  readonly document: typeof documents.$inferSelect
  readonly content: DocumentContent
}> {
  const [document] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId as DocumentId), isNull(documents.deletedAt)))

  if (!document) {
    throw new NotFoundException()
  }

  if (document.status === 'draft' || document.status === 'signed') {
    try {
      return { document, content: await contentOf(tx, document, shippedRules) }
    } catch (error) {
      if (error instanceof RuleError) {
        throw new UnprocessableEntityException(error.message)
      }

      throw error
    }
  }

  const [snapshot] = await tx
    .select({ content: documentSnapshots.content })
    .from(documentSnapshots)
    .where(eq(documentSnapshots.documentId, document.id))

  if (!snapshot) {
    // Only a document issued before 0013. Made out of the live rows it would
    // carry today's customer on an old invoice, so it is refused.
    throw new ConflictException(
      'Dieser Beleg wurde festgeschrieben, bevor OpenGewerk den Inhalt beim Festschreiben ' +
        'festhielt. Eine E-Rechnung, die sicher dem damaligen Stand entspricht, lässt sich dazu ' +
        'nicht erzeugen.',
    )
  }

  return { document, content: currentContent(snapshot.content) }
}

/** The document an e-invoice is asked for, which has to have its number by then. */
async function numberedDocument(
  tx: TenantTransaction,
  documentId: string,
): Promise<{ readonly id: DocumentId; readonly kind: DocumentKind; readonly number: string }> {
  const [document] = await tx
    .select({ id: documents.id, kind: documents.kind, number: documents.number })
    .from(documents)
    .where(and(eq(documents.id, documentId as DocumentId), isNull(documents.deletedAt)))

  if (!document) {
    throw new NotFoundException()
  }

  if (document.number === null) {
    throw new ConflictException(
      'Eine E-Rechnung gibt es erst, wenn die Rechnung festgeschrieben ist: vorher hat sie ' +
        'keine Nummer, und ohne Nummer bucht sie niemand.',
    )
  }

  return { id: document.id, kind: document.kind, number: document.number }
}

/** A number as it may stand in a file name. A number pattern may well contain a slash. */
function safe(number: string): string {
  return number.replaceAll(/[\\/:*?"<>|]+/g, '-')
}

/**
 * A file name that works in every browser, like the one of the PDF: the
 * German one in `filename*`, and a plain one for whoever reads only
 * `filename`.
 */
function disposition(name: string, plain: string): string {
  return (
    `attachment; filename="${plain.replaceAll(/[^\w.-]/g, '-')}"; ` +
    `filename*=UTF-8''${encodeURIComponent(name)}`
  )
}

/** What the two forms are called in a sentence that says what one of them lacks. */
const formNames: Readonly<Record<EInvoiceProfile, string>> = {
  xrechnung: 'die XRechnung',
  en16931: 'das ZUGFeRD-PDF',
}

/**
 * The e-invoice of a document, beside its PDF and under the same right.
 *
 * Three routes. One tells the office which format a document goes out in,
 * why, whether the law already requires it, and what each form of the
 * e-invoice would lack; it answers for a draft too, so that a missing value is
 * found before the number is spent. The other two hand out the two forms: the
 * XRechnung, XML of its own, and the ZUGFeRD PDF, the PDF of the invoice with
 * the XML inside.
 *
 * Both are made the first time somebody asks for them, like the PDF, and kept
 * from then on. Unlike the PDF the XML would come out the same if it were made
 * again, but a later version of the writer might not write it the same, and
 * what went to the customer is the file that was stored.
 */
@Controller('documents/:documentId')
export class EInvoiceController {
  constructor(
    private readonly database: Database,
    private readonly files: DocumentFiles,
  ) {}

  @Get('e-invoice')
  @RequiresPermission('document.read')
  status(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
  ): Promise<EInvoiceStatus> {
    return this.database.forTenant(identity, async (tx) => {
      const { document, content } = await contentFor(tx, documentId)

      try {
        const choice = formatFor(shippedRules, content)
        const electronic = choice.format === 'e_invoice'

        return {
          ...choice,
          duty: electronic ? await dutyOf(tx, content) : null,
          issued: document.number !== null,
          xrechnung: { missing: electronic ? eInvoiceGaps(content, 'xrechnung') : [] },
          zugferd: { missing: electronic ? eInvoiceGaps(content, 'en16931') : [] },
        }
      } catch (error) {
        // A date the rules have no answer for, one from before the packages
        // begin, is something the office can fix, as it is at issuing.
        if (error instanceof RuleError) {
          throw new UnprocessableEntityException(error.message)
        }

        throw error
      }
    })
  }

  @Get('xrechnung')
  @RequiresPermission('document.read')
  async xrechnung(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const found = await this.database.forTenant(identity, async (tx) => {
      const document = await numberedDocument(tx, documentId)
      const stored = await this.files.stored(tx, document.id, 'xrechnung')

      return {
        document,
        stored,
        content: stored === null ? (await contentFor(tx, documentId)).content : null,
      }
    })

    const bytes =
      found.content === null
        ? await this.files.read(found.stored ?? '')
        : await this.files.keep(
            identity,
            found.document.id,
            'xrechnung',
            new TextEncoder().encode(this.make(found.content, 'xrechnung')),
            'application/xml',
          )

    // Not for any cache on the way, like the PDF: an invoice is personal data.
    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/xml; charset=utf-8',
      disposition: disposition(
        `XRechnung ${safe(found.document.number)}.xml`,
        `XRechnung-${safe(found.document.number)}.xml`,
      ),
      length: bytes.byteLength,
    })
  }

  /**
   * The ZUGFeRD PDF: the PDF of the invoice, the one the document keeps, with
   * the e-invoice in the profile of the standard inside it.
   *
   * The XML is written and checked before anything is printed, so a document
   * that goes out as a PDF or lacks a value is refused without a round trip
   * to the renderer. The page is the PDF the document keeps, printed now and
   * kept as its PDF if nobody asked for that before: a customer who got the
   * PDF first and the ZUGFeRD PDF later sees the same page twice.
   */
  @Get('zugferd')
  @RequiresPermission('document.read')
  async zugferd(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const found = await this.database.forTenant(identity, async (tx) => {
      const document = await numberedDocument(tx, documentId)
      const stored = await this.files.stored(tx, document.id, 'zugferd')

      if (stored !== null) {
        return { document, stored, content: null, pdf: null }
      }

      return {
        document,
        stored,
        content: (await contentFor(tx, documentId)).content,
        pdf: await this.files.stored(tx, document.id, 'pdf'),
      }
    })

    let bytes: Uint8Array

    if (found.content === null) {
      bytes = await this.files.read(found.stored ?? '')
    } else {
      const xml = this.make(found.content, 'en16931')
      const pdf = await this.files.issuedPdf(identity, found.document.id, found.content, found.pdf)

      bytes = await this.files.keep(
        identity,
        found.document.id,
        'zugferd',
        await zugferdPdf(pdf, xml, new Date()),
        'application/pdf',
      )
    }

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: disposition(
        `${documentTitle(found.document.kind)} ${safe(found.document.number)} ZUGFeRD.pdf`,
        `ZUGFeRD-${safe(found.document.number)}.pdf`,
      ),
      length: bytes.byteLength,
    })
  }

  /**
   * Writes the e-invoice of a frozen content in a profile and holds it
   * against the schema.
   *
   * Refused with the reason when it should not exist: a document that goes
   * out as a PDF, or one that lacks what the profile asks for. The second is a
   * list, like the missing details of an invoice, because each item is
   * something somebody fixes in another place.
   */
  private make(content: DocumentContent, profile: EInvoiceProfile): string {
    try {
      const choice = formatFor(shippedRules, content)

      if (choice.format !== 'e_invoice') {
        throw new ConflictException(`Dieser Beleg geht als PDF hinaus. ${choice.reason}`)
      }

      const missing = [...missingDetails(shippedRules, content), ...eInvoiceGaps(content, profile)]

      if (missing.length > 0) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message:
            `Für ${formNames[profile]} fehlen noch Angaben. ` +
            missing.map((entry) => entry.message).join(' '),
          missing,
        })
      }

      return checkedCii(ciiInvoice(content, profile))
    } catch (error) {
      if (error instanceof RuleError) {
        throw new UnprocessableEntityException(error.message)
      }

      // A file the schema refuses is a fault of the writer, not of anything a
      // business entered: those are checked above. It is not stored and not
      // handed out, and the message says what the schema found.
      if (error instanceof SchemaCheckError) {
        throw new InternalServerErrorException(error.message)
      }

      throw error
    }
  }
}
