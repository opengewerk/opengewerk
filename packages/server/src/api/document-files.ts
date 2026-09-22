import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type DocumentContent,
  type DocumentFilePurpose,
  type DocumentId,
  type DocumentKind,
  eInvoiceGaps,
  type EInvoiceProfile,
  formatFor,
  missingDetails,
  RuleError,
  shippedRules,
} from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import { type Actor, Database, type TenantTransaction } from '../database/database.js'
import { documentFiles, documents, files } from '../database/schema/index.js'
import { ciiInvoice } from '../documents/cii.js'
import { contentOf, frozenContent } from '../documents/content.js'
import { checkedCii, SchemaCheckError } from '../documents/cii-schema.js'
import { type Renderer, RendererUnavailableError } from '../documents/renderer.js'
import { instructionSheet, type PrintAssets, printJob } from '../documents/template.js'
import { zugferdPdf } from '../documents/zugferd.js'
import {
  type FileStorage,
  StoredFileDamagedError,
  StoredFileMissingError,
} from '../storage/file-store.js'
import { fileRowFor } from '../storage/files.js'
import { FILE_STORE, RENDERER } from './handed-in.js'

/** What the two forms are called in a sentence that says what one of them lacks. */
const formNames: Readonly<Record<EInvoiceProfile, string>> = {
  xrechnung: 'die XRechnung',
  en16931: 'das ZUGFeRD-PDF',
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
export function eInvoiceXml(content: DocumentContent, profile: EInvoiceProfile): string {
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

/** The files an issued document keeps, and the one each of them is. */
export type IssuedPurpose = 'pdf' | 'xrechnung' | 'zugferd'

/** A file of an issued document, with what it takes to name it. */
export interface IssuedFile {
  readonly bytes: Uint8Array
  readonly kind: DocumentKind
  readonly number: string
}

/** A file a message carries: an issued document's, or a signed report's without a number. */
export interface MailedFile {
  readonly bytes: Uint8Array
  readonly kind: DocumentKind
  readonly number: string | null
}

/**
 * The frozen content of an issued document, or the refusal for one issued
 * before 0013. Made out of the live rows it would carry today's customer on
 * an old invoice.
 */
async function frozenOrRefused(
  tx: TenantTransaction,
  documentId: DocumentId,
): Promise<DocumentContent> {
  const content = await frozenContent(tx, documentId)

  if (content === null) {
    throw new ConflictException(
      'Dieser Beleg wurde festgeschrieben, bevor OpenGewerk den Inhalt beim Festschreiben ' +
        'festhielt. Eine E-Rechnung, die sicher dem damaligen Stand entspricht, lässt sich dazu ' +
        'nicht erzeugen.',
    )
  }

  return content
}

/** The document a file is asked for, which has to have its number by then. */
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

/**
 * The files an issued document keeps: its PDF, its XRechnung and its ZUGFeRD
 * PDF.
 *
 * Each of them is made the first time somebody asks for it and stored under
 * its hash, and every later request gets these bytes back, checked against
 * the hash on the way out. Not made again: Chromium does not lay out the same
 * page identically twice, a later version of a writer might not write the
 * same file, and what went to the customer is the file that was stored.
 *
 * One place for the three routes that hand them out, because the order of
 * storing and linking is the whole point and must not differ between them.
 */
@Injectable()
export class DocumentFiles {
  constructor(
    private readonly database: Database,
    @Inject(FILE_STORE) private readonly store: FileStorage,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  /** The hash of the file a document keeps for a purpose, or null while it keeps none. */
  async stored(
    tx: TenantTransaction,
    documentId: DocumentId,
    purpose: DocumentFilePurpose,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ sha256: files.sha256 })
      .from(documentFiles)
      .innerJoin(files, eq(files.id, documentFiles.fileId))
      .where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.purpose, purpose)))

    return row?.sha256 ?? null
  }

  /**
   * Stores the first file of a purpose and links it. Returns the bytes that
   * are linked afterwards, which are these unless somebody else was faster, in
   * which case they are theirs: two first requests at the same moment both
   * make the file, the unique index lets one of them link, and both callers
   * hand out the same bytes.
   *
   * The bytes go into the store before the row goes into the database. The
   * other order would, on a failure between the two, leave a row pointing at a
   * file that does not exist; this order leaves at worst a file nothing points
   * at, which harms nobody.
   */
  async keep(
    identity: Actor,
    documentId: DocumentId,
    purpose: DocumentFilePurpose,
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<Uint8Array> {
    const blob = await this.store.put(bytes)

    const linked = await this.database.forTenant(identity, async (tx) => {
      const fileId = await fileRowFor(tx, identity.tenantId, blob, mediaType)

      await tx
        .insert(documentFiles)
        .values({ tenantId: identity.tenantId, documentId, purpose, fileId })
        .onConflictDoNothing({ target: [documentFiles.documentId, documentFiles.purpose] })

      return this.stored(tx, documentId, purpose)
    })

    return linked === null || linked === blob.sha256 ? bytes : await this.read(linked)
  }

  /** The bytes of a stored file. One that is gone or damaged is a fault of the installation. */
  async read(sha256: string): Promise<Uint8Array> {
    try {
      return await this.store.get(sha256)
    } catch (error) {
      if (error instanceof StoredFileMissingError || error instanceof StoredFileDamagedError) {
        throw new InternalServerErrorException(error.message)
      }

      throw error
    }
  }

  /**
   * Prints a content record. A renderer that is not there is an operating
   * matter and says which service is missing; one that refuses the document
   * is a fault in the template and says so too, and neither is a crash.
   */
  async print(content: DocumentContent): Promise<Uint8Array> {
    return this.rendered(content, (assets) => printJob(content, assets))
  }

  /**
   * One instruction of a content record as a sheet of its own. Printed on
   * every request and not kept: it says nothing the snapshot does not, and
   * nobody receives it by mail.
   */
  async printSheet(content: DocumentContent, index: number): Promise<Uint8Array> {
    return this.rendered(content, (assets) => instructionSheet(content, index, assets))
  }

  private async rendered(
    content: DocumentContent,
    job: (assets: PrintAssets) => Parameters<Renderer>[0],
  ): Promise<Uint8Array> {
    const logo = content.issuer.logo
      ? {
          mediaType: content.issuer.logo.mediaType,
          bytes: await this.read(content.issuer.logo.sha256),
        }
      : null

    try {
      return await this.render(job({ logo }))
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * The PDF of an issued document: the one it keeps, or the first time the
   * one printed from its frozen content, kept from then on. `sha256` is what
   * `stored` found for it, read in the caller's transaction.
   */
  async issuedPdf(
    identity: Actor,
    documentId: DocumentId,
    content: DocumentContent,
    sha256: string | null,
  ): Promise<Uint8Array> {
    return sha256 !== null
      ? this.read(sha256)
      : this.keep(identity, documentId, 'pdf', await this.print(content), 'application/pdf')
  }

  /**
   * A file of an issued document: the one it keeps, or the first time the one
   * made out of its frozen content, kept from then on.
   *
   * The routes that hand the files out and the job that attaches them to a
   * message both come through here, so that a customer who downloads an
   * invoice and one who gets it by mail get the same bytes.
   *
   * For the ZUGFeRD PDF the XML is written and checked before anything is
   * printed, so a document that goes out as a PDF or lacks a value is refused
   * without a round trip to the renderer. The page inside is the PDF the
   * document keeps, printed now and kept as its PDF if nobody asked for that
   * before: a customer who got the PDF first and the ZUGFeRD PDF later sees
   * the same page twice.
   */
  async issued(actor: Actor, documentId: string, purpose: IssuedPurpose): Promise<IssuedFile> {
    const found = await this.database.forTenant(actor, async (tx) => {
      const document = await numberedDocument(tx, documentId)
      const stored = await this.stored(tx, document.id, purpose)

      if (stored !== null) {
        return { document, stored, content: null, pdf: null }
      }

      return {
        document,
        stored,
        content: await frozenOrRefused(tx, document.id),
        pdf: purpose === 'zugferd' ? await this.stored(tx, document.id, 'pdf') : null,
      }
    })

    const { document } = found
    let bytes: Uint8Array

    if (found.content === null) {
      bytes = await this.read(found.stored ?? '')
    } else if (purpose === 'pdf') {
      bytes = await this.issuedPdf(actor, document.id, found.content, null)
    } else if (purpose === 'xrechnung') {
      bytes = await this.keep(
        actor,
        document.id,
        'xrechnung',
        new TextEncoder().encode(eInvoiceXml(found.content, 'xrechnung')),
        'application/xml',
      )
    } else {
      const xml = eInvoiceXml(found.content, 'en16931')
      const pdf = await this.issuedPdf(actor, document.id, found.content, found.pdf)

      bytes = await this.keep(
        actor,
        document.id,
        'zugferd',
        await zugferdPdf(pdf, xml, new Date()),
        'application/pdf',
      )
    }

    return { bytes, kind: document.kind, number: document.number }
  }

  /**
   * The file a message about a document carries.
   *
   * An issued document gives the file it keeps, as above. A report that the
   * customer signed and the office has not issued yet has no number and so no
   * snapshot; its PDF is printed from its rows, as it is on every request,
   * and not kept. Nothing on it changes any more, the signature saw to that.
   */
  async forMail(actor: Actor, documentId: string, purpose: IssuedPurpose): Promise<MailedFile> {
    if (purpose === 'pdf') {
      const signed = await this.database.forTenant(actor, async (tx) => {
        const [document] = await tx
          .select()
          .from(documents)
          .where(and(eq(documents.id, documentId as DocumentId), isNull(documents.deletedAt)))

        if (!document) {
          throw new NotFoundException()
        }

        return document.number === null && document.status === 'signed'
          ? contentOf(tx, document, shippedRules)
          : null
      })

      if (signed) {
        return { bytes: await this.print(signed), kind: signed.kind, number: null }
      }
    }

    return this.issued(actor, documentId, purpose)
  }
}
