import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common'
import type { AttachmentVersionId } from '@opengewerk/domain'
import {
  Database,
  dispositionFor,
  FILE_STORE,
  type FileStorage,
  isUuid,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { attachments, attachmentVersions, files } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const gone = 'Diese Datei gibt es nicht, oder sie ist aus der Ablage entfernt worden.'

/**
 * The files of a business's records, handed out by version (#77).
 *
 * Asked by the id of a version and never by hash. The version is found under
 * row level security, its attachment has to be one nobody removed, and only
 * then is the file looked up, by business and hash. A version id of another
 * business finds nothing, and neither does its hash, which is not a way in
 * here at all.
 *
 * `no-store`, like the logo: what somebody may see is decided on every
 * request, and a file removed from the records should not stay readable from
 * a cache. What a device keeps for itself, the previews of photos, it keeps in
 * its own store, next to the rest of what it knows.
 */
@Controller('attachments')
export class AttachmentsController {
  constructor(
    private readonly database: Database,
    @Inject(FILE_STORE) private readonly store: FileStorage,
  ) {}

  /** The file of a version, as it was stored. */
  @Get('versions/:versionId/content')
  @RequiresPermission('attachment.read')
  @Header('Cache-Control', 'no-store')
  content(@CurrentIdentity() identity: RequestIdentity, @Param('versionId') versionId: string) {
    return this.serve(identity, versionId, 'content')
  }

  /** The small picture of a photo, for a list. Nothing for any other file. */
  @Get('versions/:versionId/preview')
  @RequiresPermission('attachment.read')
  @Header('Cache-Control', 'no-store')
  preview(@CurrentIdentity() identity: RequestIdentity, @Param('versionId') versionId: string) {
    return this.serve(identity, versionId, 'preview')
  }

  private async serve(
    identity: RequestIdentity,
    versionId: string,
    which: 'content' | 'preview',
  ): Promise<StreamableFile> {
    if (!isUuid(versionId)) {
      throw new NotFoundException(gone)
    }

    const found = await this.database.forTenant(identity, async (tx) => {
      const [version] = await tx
        .select({
          sha256: attachmentVersions.sha256,
          previewSha256: attachmentVersions.previewSha256,
          fileName: attachmentVersions.fileName,
        })
        .from(attachmentVersions)
        .innerJoin(
          attachments,
          and(
            eq(attachments.tenantId, attachmentVersions.tenantId),
            eq(attachments.id, attachmentVersions.attachmentId),
          ),
        )
        .where(
          and(
            eq(attachmentVersions.id, versionId as AttachmentVersionId),
            isNull(attachments.deletedAt),
          ),
        )

      const hash = which === 'content' ? version?.sha256 : version?.previewSha256

      if (!version || !hash) {
        return null
      }

      const [file] = await tx
        .select({ sha256: files.sha256, mediaType: files.mediaType })
        .from(files)
        .where(and(eq(files.tenantId, identity.tenantId), eq(files.sha256, hash)))

      return file ? { ...file, fileName: version.fileName } : null
    })

    if (!found) {
      throw new NotFoundException(gone)
    }

    const bytes = await this.store.get(found.sha256)
    const name = which === 'content' ? found.fileName : `Vorschau ${found.fileName}.jpg`

    return new StreamableFile(Buffer.from(bytes), {
      type: found.mediaType,
      disposition: dispositionFor(found.mediaType, name),
      length: bytes.byteLength,
    })
  }
}
