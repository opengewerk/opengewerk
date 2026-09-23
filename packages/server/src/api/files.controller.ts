import { createHash } from 'node:crypto'

import {
  BadRequestException,
  Controller,
  Inject,
  Param,
  PayloadTooLargeException,
  Put,
  Req,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { attachmentSizeProblem, fileHashProblem } from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'
import type { Request } from 'express'

import { storedMediaType } from '../attachments/media-type.js'
import { Database } from '../database/database.js'
import { files } from '../database/schema/index.js'
import type { FileStorage } from '../storage/file-store.js'
import { fileRowFor } from '../storage/files.js'
import { RequiresPermission } from './authorization.js'
import { FILE_STORE } from './handed-in.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { AcceptsBody } from './origin.js'

/** How a file travels: as bytes, with a type a form cannot send. */
export const fileUploadType = 'application/octet-stream'

const refusal =
  'Eine Datei wird als application/octet-stream geschickt, mit ihrem Typ im Kopf X-Media-Type.'

/**
 * The bytes of the files in a business's records, stored ahead of the
 * version that names them (#77).
 *
 * A device that took a photo in a cellar holds the bytes and their hash and
 * nothing else the server knows; this is where the bytes go when the network
 * is back, before the version is sent through the outbox. Addressed by hash,
 * so sending the same file again is harmless: the store keeps it once, the
 * business has one row for it, and a device that lost the answer to its last
 * upload simply sends it again.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly database: Database,
    @Inject(FILE_STORE) private readonly store: FileStorage,
  ) {}

  /**
   * The body is the file itself as `application/octet-stream`, a type no form
   * can send, and the type the browser gave it travels in `X-Media-Type`. The
   * hash in the address has to be the hash of the body: a file damaged on its
   * way is refused here and not stored under a name that claims otherwise.
   */
  @Put(':sha256')
  @RequiresPermission('attachment.write')
  @AcceptsBody([fileUploadType], refusal)
  async upload(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('sha256') sha256: string,
    @Req() request: Request,
  ) {
    const malformed = fileHashProblem(sha256)

    if (malformed) {
      throw new BadRequestException(malformed)
    }

    const body: unknown = request.body

    if (!Buffer.isBuffer(body)) {
      // The parser leaves an empty body alone, so an empty file arrives as
      // no body at all and not as zero bytes.
      throw Number(request.header('content-length') ?? '0') === 0
        ? new BadRequestException(attachmentSizeProblem(0))
        : new UnsupportedMediaTypeException(refusal)
    }

    const tooLarge = attachmentSizeProblem(body.byteLength)

    if (tooLarge) {
      throw body.byteLength === 0
        ? new BadRequestException(tooLarge)
        : new PayloadTooLargeException(tooLarge)
    }

    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)

    if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
      throw new UnprocessableEntityException(
        'Der Inhalt passt nicht zu seiner Prüfsumme. Die Datei ist unterwegs beschädigt worden; ' +
          'der nächste Abgleich schickt sie noch einmal.',
      )
    }

    const declared = request.header('x-media-type') ?? ''

    // Into the store first, then the row, for the same reason as with a PDF:
    // the other order could leave a row pointing at a file nobody wrote.
    const blob = await this.store.put(bytes)

    return this.database.forTenant(identity, async (tx) => {
      await fileRowFor(tx, identity.tenantId, blob, storedMediaType(bytes, declared))

      // The row that was there already keeps its type: the same bytes are
      // the same file, whatever a second upload declared.
      const [row] = await tx
        .select({ sha256: files.sha256, sizeBytes: files.sizeBytes, mediaType: files.mediaType })
        .from(files)
        .where(and(eq(files.tenantId, identity.tenantId), eq(files.sha256, blob.sha256)))

      return row
    })
  }
}
