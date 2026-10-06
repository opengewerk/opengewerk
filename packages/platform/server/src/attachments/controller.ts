import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  type Provider,
  StreamableFile,
  type Type,
} from '@nestjs/common'
import { and, eq, getTableColumns, isNull } from 'drizzle-orm'

import { RequiresPermission } from '../api/authorization.js'
import { CurrentIdentity, type RequestIdentity } from '../api/identity.js'
import type { AccessRules } from '../authentication/access.js'
import { Database, type TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import type {
  AttachmentRow,
  AttachmentsTable,
  AttachmentVersionRow,
  AttachmentVersionsTable,
  OwnAttachmentColumns,
} from '../database/schema/attachments.js'
import { files } from '../database/schema/files.js'
import { FILE_STORE } from '../files/controller.js'
import { dispositionFor } from '../files/media-type.js'
import type { FileStorage } from '../files/store.js'

/** What the routes of the files are told by the application, under which a module hands it in. */
export const ATTACHMENT_ROUTES = Symbol('AttachmentRoutes')

/** What the foundation answers for a file that is not there for whoever asks. */
export const attachmentGone =
  'Diese Datei gibt es nicht, oder sie ist aus der Ablage entfernt worden.'

/** What a route is shown of a file before it hands one out. */
export interface AttachmentReading {
  readonly tx: TenantTransaction
  readonly identity: RequestIdentity
  /** The file the version belongs to, with the columns of the application. */
  readonly attachment: Readonly<Record<string, unknown>>
}

/** What the routes of the files are told by the application. */
export interface AttachmentRoutes<
  Own extends OwnAttachmentColumns = Record<never, never>,
  VersionOwn extends OwnAttachmentColumns = Record<never, never>,
> {
  /** The files of the application and their versions, made with `attachmentsSchema`. */
  readonly tables: {
    readonly attachments: AttachmentsTable<Own>
    readonly attachmentVersions: AttachmentVersionsTable<VersionOwn>
  }
  /**
   * What the application looks at before a file is handed out, in the
   * transaction that found it: whether what the file hangs on is there for
   * whoever asks, where the policies on its tables do not already say so. A
   * file it does not let through is answered like one that is not there.
   */
  readonly readable?: (reading: AttachmentReading) => Promise<boolean> | boolean
  /**
   * The sentence for a file that is not there for whoever asks, where the
   * application calls a file something else than the foundation does.
   */
  readonly gone?: string
}

/** The rights the routes of the files ask for, the application's. */
export interface AttachmentRights<Right extends string> {
  /** Reading a file of the records. */
  readonly read: Right
}

type AnyRoutes = AttachmentRoutes

/**
 * The files of the records of an application, handed out by version
 * (opengewerk-haustechnik#97).
 *
 * Asked by the id of a version and never by hash. The version is found under
 * row level security together with its file, which has to be one nobody
 * removed and one the same policies show to whoever asks, and only then are
 * the bytes looked up, by tenant and hash. A version id of another tenant
 * finds nothing, and neither does its hash, which is not a way in here at
 * all. An older version is handed out like the newest: a new version is laid
 * over the ones before it and replaces none.
 *
 * `no-store`: what somebody may see is decided on every request, and a file
 * removed from the records should not stay readable from a cache. What a
 * device keeps for itself, the previews of photos, it keeps in its own store,
 * next to the rest of what it knows.
 *
 * The type is the one the server read off the first bytes when the file was
 * stored, and anything that is neither a picture nor a PDF is handed out to
 * be saved and never shown in the page (`dispositionFor`).
 *
 * Made by a function because the right is the application's. Nothing but its
 * routes is on the class: whoever walks the routes of a module reads every
 * property of it.
 */
function attachmentsController(rights: AttachmentRights<string>): Type<unknown> {
  @Controller('attachments')
  class AttachmentsController {
    constructor(
      readonly database: Database,
      @Inject(ATTACHMENT_ROUTES) readonly routes: AnyRoutes,
      @Inject(FILE_STORE) readonly store: FileStorage,
    ) {}

    /** The file of a version, as it was stored. */
    @Get('versions/:versionId/content')
    @RequiresPermission(rights.read)
    @Header('Cache-Control', 'no-store')
    content(@CurrentIdentity() identity: RequestIdentity, @Param('versionId') versionId: string) {
      return serve(this.database, this.routes, this.store, identity, versionId, 'content')
    }

    /** The small picture of a photo, for a list. Nothing for any other file. */
    @Get('versions/:versionId/preview')
    @RequiresPermission(rights.read)
    @Header('Cache-Control', 'no-store')
    preview(@CurrentIdentity() identity: RequestIdentity, @Param('versionId') versionId: string) {
      return serve(this.database, this.routes, this.store, identity, versionId, 'preview')
    }
  }

  return AttachmentsController
}

async function serve(
  database: Database,
  routes: AnyRoutes,
  store: FileStorage,
  identity: RequestIdentity,
  versionId: string,
  which: 'content' | 'preview',
): Promise<StreamableFile> {
  const gone = routes.gone ?? attachmentGone

  if (!isUuid(versionId)) {
    throw new NotFoundException(gone)
  }

  // Read as every table of files: the columns of the application are reached
  // by name, and only by the application.
  const attachments = routes.tables.attachments as unknown as AttachmentsTable
  const versions = routes.tables.attachmentVersions as unknown as AttachmentVersionsTable

  const found = await database.forTenant(identity, async (tx) => {
    const [row] = await tx
      .select({
        sha256: versions.sha256,
        previewSha256: versions.previewSha256,
        fileName: versions.fileName,
        attachment: getTableColumns(attachments),
      })
      .from(versions)
      .innerJoin(
        attachments,
        and(eq(attachments.tenantId, versions.tenantId), eq(attachments.id, versions.attachmentId)),
      )
      .where(
        and(
          eq(versions.id, versionId as AttachmentVersionRow['id']),
          isNull(attachments.deletedAt),
        ),
      )

    const hash = which === 'content' ? row?.sha256 : row?.previewSha256

    if (!row || !hash) {
      return null
    }

    const attachment: AttachmentRow = row.attachment

    if (routes.readable && !(await routes.readable({ tx, identity, attachment }))) {
      return null
    }

    const [file] = await tx
      .select({ sha256: files.sha256, mediaType: files.mediaType })
      .from(files)
      .where(and(eq(files.tenantId, identity.tenantId), eq(files.sha256, hash)))

    return file ? { ...file, fileName: row.fileName } : null
  })

  if (!found) {
    throw new NotFoundException(gone)
  }

  const bytes = await store.get(found.sha256)
  const name = which === 'content' ? found.fileName : `Vorschau ${found.fileName}.jpg`

  return new StreamableFile(Buffer.from(bytes), {
    type: found.mediaType,
    disposition: dispositionFor(found.mediaType, name),
    length: bytes.byteLength,
  })
}

/** What the routes of the files are put together from. */
export interface AttachmentParts<
  Right extends string,
  Own extends OwnAttachmentColumns,
  VersionOwn extends OwnAttachmentColumns,
> {
  /** The rights of the application, which have to hold the one named below. */
  readonly access: Pick<AccessRules<Right>, 'catalogue'>
  readonly rights: AttachmentRights<Right>
  readonly routes: AttachmentRoutes<Own, VersionOwn>
}

/**
 * The routes of the files and what they are handed, for the module of an
 * application. A function and not a module of its own, for the reason
 * `authenticationParts` is one: the guard, the database and the identity
 * source are the application's to register, once.
 *
 * The bytes come out of the store the route of the file store keeps them in,
 * so the module registers `fileParts` as well, which hands the store in.
 *
 * Refuses an application whose catalogue lacks the right it names: that would
 * only show with the first request.
 */
export function attachmentParts<
  Right extends string,
  Own extends OwnAttachmentColumns = Record<never, never>,
  VersionOwn extends OwnAttachmentColumns = Record<never, never>,
>(
  parts: AttachmentParts<Right, Own, VersionOwn>,
): { readonly controllers: Type<unknown>[]; readonly providers: Provider[] } {
  if (!parts.access.catalogue.isRight(parts.rights.read)) {
    throw new Error(`The catalogue lacks the right to read a file: ${parts.rights.read}`)
  }

  return {
    controllers: [attachmentsController({ read: parts.rights.read })],
    providers: [{ provide: ATTACHMENT_ROUTES, useValue: parts.routes as unknown as AnyRoutes }],
  }
}
