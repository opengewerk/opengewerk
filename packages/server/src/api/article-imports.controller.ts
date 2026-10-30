import { createHash } from 'node:crypto'

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  RequestTimeoutException,
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
  /**
   * The tenants whose file of a delivery is being read right now. A body of
   * up to 200 MB is held in memory while it is read and hashed, and the
   * budgets of the hour count it only afterwards, so they bound what is
   * stored and not what is held (security reviews of #777). So one file at a
   * time for each tenant, and a few in all on the instance, which bounds the
   * memory without one tenant locking out the others.
   */
  private readonly readingFor = new Set<string>()

  /** The accounts whose last file was cut off for coming in too slowly, and when. */
  private readonly cutAt = new Map<string, number>()

  /**
   * How long a file may take to come in: 30 seconds without a byte, ten
   * minutes in all, which is still 200 MB at 2.7 Mbit/s. Two files at once on
   * the instance, and five minutes of waiting for an account whose file was
   * cut off, so that sending slowly does not hold a place again and again.
   * Shorter in a test.
   */
  readLimits = { quietMs: 30_000, wholeMs: 600_000, atOnce: 2, waitAfterCutMs: 300_000 }

  /** Why a file of this person is not read now, or null when it is. */
  private busyFor(identity: RequestIdentity): string | null {
    const cut = this.cutAt.get(identity.userId)

    if (cut !== undefined && cut + this.readLimits.waitAfterCutMs > Date.now()) {
      return 'Die letzte Datei kam zu langsam an. Bitte in ein paar Minuten noch einmal versuchen.'
    }

    this.cutAt.delete(identity.userId)

    if (this.readingFor.has(identity.tenantId)) {
      return 'Gerade wird schon eine Datei eines Imports dieses Betriebs gespeichert. Bitte gleich noch einmal versuchen.'
    }

    if (this.readingFor.size >= this.readLimits.atOnce) {
      return 'Gerade werden schon Dateien von Importen gespeichert. Bitte gleich noch einmal versuchen.'
    }

    return null
  }

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

    // Refused before a byte of the body is read.
    const busy = this.busyFor(identity)

    if (busy) {
      throw new HttpException(busy, HttpStatus.TOO_MANY_REQUESTS)
    }

    this.readingFor.add(identity.tenantId)

    try {
      return await this.stored(identity, sha256, request)
    } catch (error) {
      if (error instanceof RequestTimeoutException) {
        this.cutAt.set(identity.userId, Date.now())
      }

      throw error
    } finally {
      this.readingFor.delete(identity.tenantId)
    }
  }

  /** The body, read within `readLimits`; one that stalls or takes too long is cut off. */
  private async bodyOf(request: Request): Promise<Buffer | null> {
    const late = new Error('The file came in too slowly')
    const cut = () => request.destroy(late)
    const deadline = setTimeout(cut, this.readLimits.wholeMs)

    request.setTimeout(this.readLimits.quietMs, cut)

    try {
      return await bodyBytesOf(request, importFileBytes)
    } catch (error) {
      throw error === late
        ? new RequestTimeoutException('Die Datei kam zu langsam an und wurde nicht gespeichert.')
        : error
    } finally {
      clearTimeout(deadline)
      request.setTimeout(0)
    }
  }

  private async stored(identity: RequestIdentity, sha256: string, request: Request) {
    const body = await this.bodyOf(request)

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
