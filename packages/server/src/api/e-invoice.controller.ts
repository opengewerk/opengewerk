import {
  ConflictException,
  Controller,
  Get,
  Inject,
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
  type Duty,
  type EInvoiceGap,
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
import { documentFiles, documents, documentSnapshots, files } from '../database/schema/index.js'
import { ciiInvoice } from '../documents/cii.js'
import { checkedCii, SchemaCheckError } from '../documents/cii-schema.js'
import { contentOf } from '../documents/content.js'
import {
  type FileStorage,
  StoredFileDamagedError,
  StoredFileMissingError,
} from '../storage/file-store.js'
import { fileRowFor } from '../storage/files.js'
import { RequiresPermission } from './authorization.js'
import { FILE_STORE } from './handed-in.js'
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

/** A file name that works in every browser, like the one of the PDF. */
function disposition(number: string): string {
  const safe = number.replaceAll(/[\\/:*?"<>|]+/g, '-')
  const plain = `XRechnung-${safe.replaceAll(/[^\w.-]/g, '-')}.xml`

  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(`XRechnung ${safe}.xml`)}`
}

/**
 * The e-invoice of a document, beside its PDF and under the same right.
 *
 * Two routes. One tells the office which format a document goes out in, why,
 * whether the law already requires it, and what an XRechnung of it would lack;
 * it answers for a draft too, so that a missing value is found before the
 * number is spent. The other hands out the XRechnung itself.
 *
 * The XRechnung is made the first time somebody asks for it, like the PDF, and
 * stored under its hash; every later request gets these bytes back. Unlike the
 * PDF it would come out the same if it were made again, but a later version of
 * the writer might not write it the same, and what went to the customer is the
 * file that was stored.
 */
@Controller('documents/:documentId')
export class EInvoiceController {
  constructor(
    private readonly database: Database,
    @Inject(FILE_STORE) private readonly store: FileStorage,
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

        return {
          ...choice,
          duty: choice.format === 'e_invoice' ? await dutyOf(tx, content) : null,
          issued: document.number !== null,
          xrechnung: {
            missing: choice.format === 'e_invoice' ? eInvoiceGaps(content, 'xrechnung') : [],
          },
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
      const [document] = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status })
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

      const [stored] = await tx
        .select({ sha256: files.sha256 })
        .from(documentFiles)
        .innerJoin(files, eq(files.id, documentFiles.fileId))
        .where(
          and(eq(documentFiles.documentId, document.id), eq(documentFiles.purpose, 'xrechnung')),
        )

      if (stored) {
        return { number: document.number, sha256: stored.sha256, content: null }
      }

      return {
        number: document.number,
        sha256: null,
        content: (await contentFor(tx, documentId)).content,
      }
    })

    const bytes =
      found.content === null
        ? await this.read(found.sha256 ?? '')
        : await this.keep(identity, documentId as DocumentId, this.make(found.content))

    // Not for any cache on the way, like the PDF: an invoice is personal data.
    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/xml; charset=utf-8',
      disposition: disposition(found.number),
      length: bytes.byteLength,
    })
  }

  /**
   * Writes the XRechnung of a frozen content and holds it against the schema.
   *
   * Refused with the reason when it should not exist: a document that goes
   * out as a PDF, or one that lacks what XRechnung asks for. The second is a
   * list, like the missing details of an invoice, because each item is
   * something somebody fixes in another place.
   */
  private make(content: DocumentContent): Uint8Array {
    try {
      const choice = formatFor(shippedRules, content)

      if (choice.format !== 'e_invoice') {
        throw new ConflictException(`Dieser Beleg geht als PDF hinaus. ${choice.reason}`)
      }

      const missing = [
        ...missingDetails(shippedRules, content),
        ...eInvoiceGaps(content, 'xrechnung'),
      ]

      if (missing.length > 0) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message:
            'Für die XRechnung fehlen noch Angaben. ' +
            missing.map((entry) => entry.message).join(' '),
          missing,
        })
      }

      return new TextEncoder().encode(checkedCii(ciiInvoice(content, 'xrechnung')))
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

  /**
   * Stores the XRechnung and links it, the bytes before the row, as for the
   * PDF. Two first requests at the same moment both write it; the unique index
   * lets one of them link, and both hand out what was linked.
   */
  private async keep(
    identity: RequestIdentity,
    documentId: DocumentId,
    bytes: Uint8Array,
  ): Promise<Uint8Array> {
    const blob = await this.store.put(bytes)

    const linked = await this.database.forTenant(identity, async (tx) => {
      const fileId = await fileRowFor(tx, identity.tenantId, blob, 'application/xml')

      await tx
        .insert(documentFiles)
        .values({ tenantId: identity.tenantId, documentId, purpose: 'xrechnung', fileId })
        .onConflictDoNothing({ target: [documentFiles.documentId, documentFiles.purpose] })

      const [row] = await tx
        .select({ sha256: files.sha256 })
        .from(documentFiles)
        .innerJoin(files, eq(files.id, documentFiles.fileId))
        .where(
          and(eq(documentFiles.documentId, documentId), eq(documentFiles.purpose, 'xrechnung')),
        )

      return row?.sha256
    })

    return linked === undefined || linked === blob.sha256 ? bytes : await this.read(linked)
  }

  private async read(sha256: string): Promise<Uint8Array> {
    try {
      return await this.store.get(sha256)
    } catch (error) {
      if (error instanceof StoredFileMissingError || error instanceof StoredFileDamagedError) {
        throw new InternalServerErrorException(error.message)
      }

      throw error
    }
  }
}
