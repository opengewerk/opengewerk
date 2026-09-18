import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import type { DocumentId, Identity } from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { documents } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity } from './identity.js'

const writableFields = [
  'customerId',
  'jobId',
  'siteId',
  'installationId',
  'predecessorDocumentId',
  'kind',
  'documentDate',
  'subject',
] as const

@Controller('documents')
export class DocumentsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('document.read')
  list(@CurrentIdentity() identity: Identity) {
    return this.database.forTenant(identity.tenantId, (tx) => tx.select().from(documents))
  }

  @Post()
  @RequiresPermission('document.write')
  async create(@CurrentIdentity() identity: Identity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['customerId', 'kind', 'documentDate'])

    const [created] = await this.database.forTenant(identity.tenantId, (tx) =>
      tx
        .insert(documents)
        .values({ ...(values as typeof documents.$inferInsert), tenantId: identity.tenantId })
        .returning(),
    )

    return created
  }

  @Patch(':id')
  @RequiresPermission('document.write')
  async update(
    @CurrentIdentity() identity: Identity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    const [updated] = await this.database.forTenant(identity.tenantId, (tx) =>
      tx
        .update(documents)
        .set({ ...(values as Partial<typeof documents.$inferInsert>), updatedAt: new Date() })
        // Only a draft can be changed. A document that has been issued is
        // corrected by a cancellation or a credit note, never edited; that is
        // leading decision 4 and it is not negotiable by a PATCH.
        .where(and(eq(documents.id, id as DocumentId), eq(documents.status, 'draft')))
        .returning(),
    )

    if (!updated) {
      throw new NotFoundException()
    }

    return updated
  }

  /**
   * Issuing a document. Its own right, and the reason the two are separate:
   * a technician writes the report on site, the office turns it into something
   * the bookkeeping is built on.
   *
   * What happens here is deliberately thin. The gap free number and the write
   * protection that goes with it belong to the number range work; this route
   * sets the status and the timestamp and makes sure nothing is issued twice.
   */
  @Post(':id/issue')
  @RequiresPermission('document.issue')
  async issue(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.database.forTenant(identity.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(documents)
        .where(eq(documents.id, id as DocumentId))

      if (!existing) {
        throw new NotFoundException()
      }

      if (existing.status !== 'draft') {
        throw new ConflictException('Der Beleg ist nicht mehr im Entwurf.')
      }

      const [issued] = await tx
        .update(documents)
        .set({ status: 'issued', issuedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(documents.id, existing.id), eq(documents.status, 'draft')))
        .returning()

      return issued
    })
  }
}
