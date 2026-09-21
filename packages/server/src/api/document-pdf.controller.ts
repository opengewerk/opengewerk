import {
  BadGatewayException,
  ConflictException,
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  currentContent,
  type DocumentContent,
  type DocumentId,
  type DocumentKind,
  RuleError,
  shippedRules,
} from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import { Database, type TenantTransaction } from '../database/database.js'
import { documentFiles, documents, documentSnapshots, files } from '../database/schema/index.js'
import { contentOf } from '../documents/content.js'
import { type Renderer, RendererUnavailableError } from '../documents/renderer.js'
import { documentTitle, printJob } from '../documents/template.js'
import {
  type FileStorage,
  StoredFileDamagedError,
  StoredFileMissingError,
} from '../storage/file-store.js'
import { fileRowFor } from '../storage/files.js'
import { RequiresPermission } from './authorization.js'
import { FILE_STORE, RENDERER } from './handed-in.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** What the first transaction found out about the document. */
type Found =
  | { readonly state: 'draft'; readonly content: DocumentContent }
  | {
      readonly state: 'stored'
      readonly sha256: string
      readonly kind: DocumentKind
      readonly number: string | null
    }
  | { readonly state: 'unprinted'; readonly content: DocumentContent }

/** The PDF of a stored file, the bytes of which have been read already. */
interface Printed {
  readonly bytes: Uint8Array
  readonly kind: DocumentKind
  readonly number: string | null
}

/**
 * A file name that works in every browser: the German one in `filename*`, and
 * a plain one for whoever reads only `filename`. Characters a file system
 * refuses are replaced, because a number pattern may well contain a slash.
 */
function disposition(printed: Printed): string {
  const safe = (value: string) => value.replaceAll(/[\\/:*?"<>|]+/g, '-')
  const name =
    printed.number === null
      ? `Entwurf ${documentTitle(printed.kind)}.pdf`
      : `${documentTitle(printed.kind)} ${safe(printed.number)}.pdf`
  const plain =
    printed.number === null
      ? 'Entwurf.pdf'
      : `Beleg-${safe(printed.number).replaceAll(/[^\w.-]/g, '-')}.pdf`

  return `inline; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * The PDF of a document.
 *
 * Its own controller, like the lines, and under the document's rights: a PDF
 * is a way of reading a document, not a thing of its own.
 *
 * Three cases, and the difference between them is the whole design.
 *
 * **A draft** is printed from its live rows every time and never stored. It is
 * what somebody looks at before issuing, it carries "Entwurf" across every
 * page, and it has no number yet.
 *
 * **An issued document the first time** is printed from its snapshot, the
 * record written when it was issued, and the PDF is stored under its hash and
 * linked to the document. Two first requests at the same moment both print,
 * and the unique index lets one of them link; the other gives back the one
 * that was linked, so both callers see the same bytes.
 *
 * **Every time after that** the stored bytes come back unchanged, checked
 * against their hash on the way out. Not printed again: Chromium does not lay
 * out the same page identically twice, and a document that looks a little
 * different every time it is opened is not the document that was sent.
 */
@Controller('documents/:documentId/pdf')
export class DocumentPdfController {
  constructor(
    private readonly database: Database,
    @Inject(FILE_STORE) private readonly store: FileStorage,
    @Inject(RENDERER) private readonly render: Renderer,
  ) {}

  @Get()
  @RequiresPermission('document.read')
  async pdf(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const found = await this.database.forTenant(identity, (tx) => this.find(tx, documentId))

    let printed: Printed

    if (found.state === 'stored') {
      printed = { bytes: await this.read(found.sha256), kind: found.kind, number: found.number }
    } else {
      const bytes = await this.print(found.content)

      printed =
        found.state === 'draft'
          ? { bytes, kind: found.content.kind, number: null }
          : {
              bytes: await this.keep(identity, documentId as DocumentId, bytes),
              kind: found.content.kind,
              number: found.content.number,
            }
    }

    // Not for any cache between here and the browser, and not for the
    // browser's either: an invoice is personal data, and a draft changes.
    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(printed.bytes), {
      type: 'application/pdf',
      disposition: disposition(printed),
      length: printed.bytes.byteLength,
    })
  }

  private async find(tx: TenantTransaction, documentId: string): Promise<Found> {
    const [document] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId as DocumentId), isNull(documents.deletedAt)))

    if (!document) {
      throw new NotFoundException()
    }

    if (document.status === 'draft') {
      try {
        return { state: 'draft', content: await contentOf(tx, document, shippedRules) }
      } catch (error) {
        if (error instanceof RuleError) {
          throw new UnprocessableEntityException(error.message)
        }

        throw error
      }
    }

    const [stored] = await tx
      .select({ sha256: files.sha256 })
      .from(documentFiles)
      .innerJoin(files, eq(files.id, documentFiles.fileId))
      .where(and(eq(documentFiles.documentId, document.id), eq(documentFiles.purpose, 'pdf')))

    if (stored) {
      return {
        state: 'stored',
        sha256: stored.sha256,
        kind: document.kind,
        number: document.number,
      }
    }

    const [snapshot] = await tx
      .select({ content: documentSnapshots.content })
      .from(documentSnapshots)
      .where(eq(documentSnapshots.documentId, document.id))

    if (!snapshot) {
      // Only a document issued before 0013 can get here. Printing it from the
      // live rows would put today's address on an old invoice and call it the
      // original, so it is refused with the reason instead.
      throw new ConflictException(
        'Dieser Beleg wurde festgeschrieben, bevor OpenGewerk den Inhalt beim Festschreiben ' +
          'festhielt. Ein PDF, das sicher dem damaligen Stand entspricht, lässt sich dazu nicht ' +
          'erzeugen.',
      )
    }

    // A snapshot keeps the shape it was written in. One from before titles and
    // document texts is read as a document without either, which is what it
    // was, and printed from that.
    return { state: 'unprinted', content: currentContent(snapshot.content) }
  }

  /**
   * Prints a content record. A renderer that is not there is an operating
   * matter and says which service is missing; one that refuses the document
   * is a fault in the template and says so too, and neither is a crash.
   */
  private async print(content: DocumentContent): Promise<Uint8Array> {
    const logo = content.issuer.logo
      ? {
          mediaType: content.issuer.logo.mediaType,
          bytes: await this.read(content.issuer.logo.sha256),
        }
      : null

    try {
      return await this.render(printJob(content, { logo }))
    } catch (error) {
      if (error instanceof RendererUnavailableError) {
        throw new ServiceUnavailableException(error.message)
      }

      throw new BadGatewayException(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Stores the first PDF of an issued document and links it. Returns the bytes
   * that are linked afterwards, which are these unless somebody else was
   * faster, in which case they are theirs.
   *
   * The bytes go into the store before the row goes into the database. The
   * other order would, on a failure between the two, leave a row pointing at
   * a file that does not exist; this order leaves at worst a file nothing
   * points at, which harms nobody.
   */
  private async keep(
    identity: RequestIdentity,
    documentId: DocumentId,
    bytes: Uint8Array,
  ): Promise<Uint8Array> {
    const blob = await this.store.put(bytes)

    const linked = await this.database.forTenant(identity, async (tx) => {
      const fileId = await fileRowFor(tx, identity.tenantId, blob, 'application/pdf')

      await tx
        .insert(documentFiles)
        .values({ tenantId: identity.tenantId, documentId, purpose: 'pdf', fileId })
        .onConflictDoNothing({ target: [documentFiles.documentId, documentFiles.purpose] })

      const [row] = await tx
        .select({ sha256: files.sha256 })
        .from(documentFiles)
        .innerJoin(files, eq(files.id, documentFiles.fileId))
        .where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.purpose, 'pdf')))

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
