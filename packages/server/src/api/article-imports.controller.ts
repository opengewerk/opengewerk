import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import { type ArticleImportId, isAllowed, type SupplierId } from '@opengewerk/domain'

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
  constructor(private readonly imports: ArticleImports) {}

  private importerOf(identity: RequestIdentity): Importer {
    if (!isAllowed(identity, 'article.write')) {
      throw new ForbiddenException()
    }

    return { tenantId: identity.tenantId, userId: identity.userId }
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

  /** The options of the preview, `{ charset?, validFrom?, listAsSelling? }`; reads again. */
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
