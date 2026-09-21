import {
  ConflictException,
  Controller,
  Get,
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
  RuleError,
  shippedRules,
} from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import { Database, type TenantTransaction } from '../database/database.js'
import { documents, documentSnapshots } from '../database/schema/index.js'
import { contentOf } from '../documents/content.js'
import { documentTitle } from '../documents/template.js'
import { RequiresPermission } from './authorization.js'
import { DocumentFiles } from './document-files.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** What the first transaction found out about the document. */
type Found =
  | { readonly state: 'live'; readonly content: DocumentContent }
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
  /** Signed and not yet issued: no number, and no draft either. */
  readonly signed: boolean
}

/**
 * A file name that works in every browser: the German one in `filename*`, and
 * a plain one for whoever reads only `filename`. Characters a file system
 * refuses are replaced, because a number pattern may well contain a slash.
 */
function disposition(printed: Printed): string {
  const safe = (value: string) => value.replaceAll(/[\\/:*?"<>|]+/g, '-')
  const name =
    printed.number !== null
      ? `${documentTitle(printed.kind)} ${safe(printed.number)}.pdf`
      : printed.signed
        ? `${documentTitle(printed.kind)} unterschrieben.pdf`
        : `Entwurf ${documentTitle(printed.kind)}.pdf`
  const plain =
    printed.number !== null
      ? `Beleg-${safe(printed.number).replaceAll(/[^\w.-]/g, '-')}.pdf`
      : printed.signed
        ? 'Unterschrieben.pdf'
        : 'Entwurf.pdf'

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
    private readonly files: DocumentFiles,
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
      printed = {
        bytes: await this.files.read(found.sha256),
        kind: found.kind,
        number: found.number,
        signed: false,
      }
    } else if (found.state === 'live') {
      printed = {
        bytes: await this.files.print(found.content),
        kind: found.content.kind,
        number: null,
        signed: found.content.signature !== null,
      }
    } else {
      printed = {
        bytes: await this.files.issuedPdf(identity, documentId as DocumentId, found.content, null),
        kind: found.content.kind,
        number: found.content.number,
        signed: false,
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

    // Printed from the rows every time while there is no snapshot to print
    // from: a draft, because it may still change, and a signed report, because
    // it has no number yet and so no snapshot. Neither is kept.
    if (document.status === 'draft' || document.status === 'signed') {
      try {
        return { state: 'live', content: await contentOf(tx, document, shippedRules) }
      } catch (error) {
        if (error instanceof RuleError) {
          throw new UnprocessableEntityException(error.message)
        }

        throw error
      }
    }

    const stored = await this.files.stored(tx, document.id, 'pdf')

    if (stored !== null) {
      return { state: 'stored', sha256: stored, kind: document.kind, number: document.number }
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
}
