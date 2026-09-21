import {
  BadGatewayException,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { DocumentContent, DocumentFilePurpose, DocumentId } from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'

import { Database, type TenantTransaction } from '../database/database.js'
import { documentFiles, files } from '../database/schema/index.js'
import { type Renderer, RendererUnavailableError } from '../documents/renderer.js'
import { printJob } from '../documents/template.js'
import {
  type FileStorage,
  StoredFileDamagedError,
  StoredFileMissingError,
} from '../storage/file-store.js'
import { fileRowFor } from '../storage/files.js'
import { FILE_STORE, RENDERER } from './handed-in.js'
import type { RequestIdentity } from './identity.js'

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
    identity: RequestIdentity,
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
   * The PDF of an issued document: the one it keeps, or the first time the
   * one printed from its frozen content, kept from then on. `sha256` is what
   * `stored` found for it, read in the caller's transaction.
   */
  async issuedPdf(
    identity: RequestIdentity,
    documentId: DocumentId,
    content: DocumentContent,
    sha256: string | null,
  ): Promise<Uint8Array> {
    return sha256 !== null
      ? this.read(sha256)
      : this.keep(identity, documentId, 'pdf', await this.print(content), 'application/pdf')
  }
}
