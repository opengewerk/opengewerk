import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Delete,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import {
  defaultPatterns,
  type DocumentId,
  type DocumentKind,
  documentKinds,
  formatDocumentNumber,
  numberRangeOf,
} from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import { Database } from '../database/database.js'
import { assignDocumentNumber } from '../database/number-ranges.js'
import { documents, numberRanges } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

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
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) =>
      tx.select().from(documents).where(isNull(documents.deletedAt)),
    )
  }

  @Post()
  @RequiresPermission('document.write')
  async create(@CurrentIdentity() identity: RequestIdentity, @Body() body: unknown) {
    const values = pick(body, writableFields)
    requireFields(values, ['customerId', 'kind', 'documentDate'])

    const [created] = await this.database.forTenant(identity, (tx) =>
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
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)

    const [updated] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(documents)
        .set(values as Partial<typeof documents.$inferInsert>)
        // Only a draft can be changed. A document that has been issued is
        // corrected by a cancellation or a credit note, never edited; that is
        // leading decision 4 and it is not negotiable by a PATCH.
        .where(
          and(
            eq(documents.id, id as DocumentId),
            eq(documents.status, 'draft'),
            isNull(documents.deletedAt),
          ),
        )
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
   * From here the document is fixed. The number is handed out inside this
   * transaction, so a failure further down takes the number back with it and
   * leaves no hole in the sequence.
   *
   * This route exists only on the server, and that is the answer to "issuing
   * works online only": there is no offline path to it. A device without a
   * network can write drafts and nothing else.
   */
  @Post(':id/issue')
  @RequiresPermission('document.issue')
  async issue(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    return this.database.forTenant(identity, async (tx) => {
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

      const issuedAt = new Date()
      const number = await assignDocumentNumber(tx, identity.tenantId, existing.kind, issuedAt)

      const [issued] = await tx
        .update(documents)
        .set({ status: 'issued', number, issuedAt, updatedAt: issuedAt })
        .where(and(eq(documents.id, existing.id), eq(documents.status, 'draft')))
        .returning()

      return issued
    })
  }

  /**
   * What the next number will be. The client shows it while somebody is still
   * writing the document, and it is a preview and not a promise: whoever
   * issues first takes it, and the next one moves on. It is built by the same
   * function that builds the real one, so the two cannot drift apart.
   */
  @Get('next-number/:kind')
  @RequiresPermission('document.read')
  async nextNumber(@CurrentIdentity() identity: RequestIdentity, @Param('kind') kind: string) {
    if (!(documentKinds as readonly string[]).includes(kind)) {
      throw new BadRequestException(`Unbekannte Belegart: ${kind}`)
    }

    const key = numberRangeOf(kind as DocumentKind)

    return this.database.forTenant(identity, async (tx) => {
      const [range] = await tx
        .select()
        .from(numberRanges)
        .where(and(eq(numberRanges.tenantId, identity.tenantId), eq(numberRanges.key, key)))

      const pattern = range?.pattern ?? defaultPatterns[key]
      const counter = range?.nextValue ?? 1

      return {
        preview: formatDocumentNumber(pattern, { counter, year: new Date().getFullYear() }),
        pattern,
      }
    })
  }

  /**
   * Only a draft, and the database says so too. A document that has been
   * issued is cancelled, never removed, not even by marking it: that is
   * leading decision 4, and the trigger on the table refuses it whichever way
   * somebody comes.
   */
  @Delete(':id')
  @RequiresPermission('document.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    const [removed] = await this.database.forTenant(identity, (tx) =>
      tx
        .update(documents)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(documents.id, id as DocumentId),
            eq(documents.status, 'draft'),
            isNull(documents.deletedAt),
          ),
        )
        .returning(),
    )

    if (!removed) {
      throw new NotFoundException()
    }

    return removed
  }
}
