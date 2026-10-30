import { createHash } from 'node:crypto'

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type ArticleImportId,
  fileHashProblem,
  importFileBytes,
  isAllowed,
  type SupplierId,
} from '@opengewerk/domain'
import {
  AcceptsBody,
  bodyBytesOf,
  Database,
  FILE_STORE,
  type FileStorage,
  fileRowFor,
  fileUploadType,
  storedMediaType,
  UploadLimits,
} from '@opengewerk/platform-server'
import type { Request } from 'express'

import { ArticleImports, type Importer } from '../datanorm/imports.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * Imports from DATANORM (#297), at the supplier whose files they are. Under
 * `purchase.write` and with `article.write` besides: an import writes the
 * catalogue and the supplier's prices in one, and whoever may do only one of
 * the two may not start it. Today both belong to the owner and the office.
 *
 * Reading and taking over run in the background; the routes answer at once
 * with the import, and the screen asks again until its state moves on.
 */
@Controller('suppliers/:supplierId/imports')
export class ArticleImportsController {
  constructor(
    private readonly imports: ArticleImports,
    private readonly database: Database,
    @Inject(FILE_STORE) private readonly store: FileStorage,
    private readonly limits: UploadLimits,
  ) {}

  private importerOf(identity: RequestIdentity): Importer {
    if (!isAllowed(identity, 'article.write')) {
      throw new ForbiddenException()
    }

    return { tenantId: identity.tenantId, userId: identity.userId }
  }

  /**
   * Stores one file of a delivery, before the import names it: as the route
   * of the foundation stores every file, the body the file itself with its
   * hash in the address, within what the account, the tenant and the
   * instance may store in this hour and the room the volume keeps, only up
   * to `importFileBytes` instead of 25 MB.
   */
  @Put('files/:sha256')
  @RequiresPermission('purchase.write')
  @AcceptsBody(
    [fileUploadType],
    'Eine Datei eines Imports wird als application/octet-stream geschickt.',
  )
  async upload(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('sha256') sha256: string,
    @Req() request: Request,
  ) {
    this.importerOf(identity)

    const malformed = fileHashProblem(sha256)

    if (malformed) {
      throw new BadRequestException(malformed)
    }

    const body = await bodyBytesOf(request, importFileBytes)

    if (body === null) {
      throw new PayloadTooLargeException(
        `Eine Datei eines Imports hat höchstens ${String(importFileBytes / 1_000_000)} MB.`,
      )
    }

    if (body.byteLength === 0) {
      throw new BadRequestException('Die Datei ist leer.')
    }

    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)

    if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
      throw new UnprocessableEntityException(
        'Der Inhalt passt nicht zu seiner Prüfsumme. Die Datei ist unterwegs beschädigt worden.',
      )
    }

    await this.limits.admit(identity, bytes.byteLength)

    // Into the store first, then the row, as the foundation does.
    const blob = await this.store.put(bytes)

    await this.database.forTenant(identity, (tx) =>
      fileRowFor(tx, identity.tenantId, blob, storedMediaType(bytes, '')),
    )

    return { sha256: blob.sha256, sizeBytes: bytes.byteLength }
  }

  @Get()
  @RequiresPermission('purchase.write')
  list(@CurrentIdentity() identity: RequestIdentity, @Param('supplierId') supplierId: string) {
    return this.imports.list(this.importerOf(identity), supplierId as SupplierId)
  }

  /** Names the uploaded files, `{ files: [{ name, sha256 }], charset? }`, and starts reading. */
  @Post()
  @HttpCode(202)
  @RequiresPermission('purchase.write')
  start(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('supplierId') supplierId: string,
    @Body() body: unknown,
  ) {
    return this.imports.start(this.importerOf(identity), supplierId as SupplierId, body)
  }

  @Get(':importId')
  @RequiresPermission('purchase.write')
  get(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('supplierId') supplierId: string,
    @Param('importId') importId: string,
  ) {
    return this.imports.get(
      this.importerOf(identity),
      supplierId as SupplierId,
      importId as ArticleImportId,
    )
  }

  /** The options of the preview, `{ charset?, validFrom? }`; reads again. */
  @Patch(':importId')
  @HttpCode(202)
  @RequiresPermission('purchase.write')
  change(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('supplierId') supplierId: string,
    @Param('importId') importId: string,
    @Body() body: unknown,
  ) {
    return this.imports.change(
      this.importerOf(identity),
      supplierId as SupplierId,
      importId as ArticleImportId,
      body,
    )
  }

  @Post(':importId/apply')
  @HttpCode(202)
  @RequiresPermission('purchase.write')
  apply(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('supplierId') supplierId: string,
    @Param('importId') importId: string,
  ) {
    return this.imports.apply(
      this.importerOf(identity),
      supplierId as SupplierId,
      importId as ArticleImportId,
    )
  }

  @Post(':importId/discard')
  @HttpCode(200)
  @RequiresPermission('purchase.write')
  discard(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('supplierId') supplierId: string,
    @Param('importId') importId: string,
  ) {
    return this.imports.discard(
      this.importerOf(identity),
      supplierId as SupplierId,
      importId as ArticleImportId,
    )
  }
}
