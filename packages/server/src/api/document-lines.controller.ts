import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import {
  type DocumentId,
  type DocumentLineId,
  lineNetCents,
  lineUnits,
  shippedRules,
  totalsFor,
  vatRates,
} from '@opengewerk/domain'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { Database, type TenantTransaction } from '../database/database.js'
import { documentLines, documents } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

const writableFields = [
  'position',
  'designation',
  'description',
  'quantityMilli',
  'unit',
  'unitPriceCents',
  'vatRate',
] as const

/**
 * `netCents` is not on that list and cannot be. It is quantity times price,
 * rounded, and a caller that could set it could put an amount in the books
 * that does not follow from the two numbers printed next to it. The server
 * works it out, and a check constraint in the database refuses a row where the
 * three disagree.
 */
function totalOf(
  values: Partial<Record<(typeof writableFields)[number], unknown>>,
  from?: {
    quantityMilli: number
    unitPriceCents: number
  },
): number {
  return lineNetCents({
    quantityMilli: Number(values.quantityMilli ?? from?.quantityMilli ?? 0),
    unitPriceCents: Number(values.unitPriceCents ?? from?.unitPriceCents ?? 0),
  })
}

/** Refuses a value that is not one of the ones the column knows. */
function oneOf(name: string, value: unknown, allowed: readonly string[]): void {
  if (value !== undefined && !allowed.includes(String(value))) {
    throw new BadRequestException(
      `${name} muss einer von diesen Werten sein: ${allowed.join(', ')}`,
    )
  }
}

/**
 * The positions of a document.
 *
 * Their own controller and not part of the document's, because they are their
 * own records with their own rights and their own sync policy. What they are
 * not is their own subject: they carry the rights of the document, because a
 * position is not a thing somebody may read or write independently of the
 * document it stands on.
 */
@Controller('documents/:documentId/lines')
export class DocumentLinesController {
  constructor(private readonly database: Database) {}

  /**
   * The document, if it is there and in reach. Every route starts here, so
   * that a line can never be reached through a document of another tenant:
   * row level security answers that question once, and the rest follows.
   */
  private async documentOf(tx: TenantTransaction, documentId: string) {
    const [document] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId as DocumentId), isNull(documents.deletedAt)))

    if (!document) {
      throw new NotFoundException()
    }

    return document
  }

  private async draftOf(tx: TenantTransaction, documentId: string) {
    const document = await this.documentOf(tx, documentId)

    if (document.status !== 'draft') {
      // The database would refuse it too, and says so in German through the
      // trigger. This is here so that the answer is a 409 and not a 500: the
      // request was well formed, the document has simply moved on.
      throw new ConflictException(
        'Der Beleg ist festgeschrieben. Eine Korrektur ist eine Stornierung oder eine Gutschrift.',
      )
    }

    return document
  }

  @Get()
  @RequiresPermission('document.read')
  list(@CurrentIdentity() identity: RequestIdentity, @Param('documentId') documentId: string) {
    return this.database.forTenant(identity, async (tx) => {
      await this.documentOf(tx, documentId)

      return await tx
        .select()
        .from(documentLines)
        .where(
          and(
            eq(documentLines.documentId, documentId as DocumentId),
            isNull(documentLines.deletedAt),
          ),
        )
        .orderBy(asc(documentLines.position))
    })
  }

  @Post()
  @RequiresPermission('document.write')
  async create(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireFields(values, ['designation', 'quantityMilli', 'unit', 'unitPriceCents'])
    oneOf('unit', values.unit, lineUnits)
    oneOf('vatRate', values.vatRate, vatRates)

    return await this.database.forTenant(identity, async (tx) => {
      await this.draftOf(tx, documentId)

      const [created] = await tx
        .insert(documentLines)
        .values({
          ...(values as typeof documentLines.$inferInsert),
          tenantId: identity.tenantId,
          documentId: documentId as DocumentId,
          // Behind the last one when nobody says where it goes, which is what
          // somebody adding a line to a list means.
          position: Number(values.position ?? (await this.nextPosition(tx, documentId))),
          netCents: totalOf(values),
        })
        .returning()

      return created
    })
  }

  @Patch(':lineId')
  @RequiresPermission('document.write')
  async change(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
    @Param('lineId') lineId: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, writableFields)
    requireSomething(values)
    oneOf('unit', values.unit, lineUnits)
    oneOf('vatRate', values.vatRate, vatRates)

    return await this.database.forTenant(identity, async (tx) => {
      await this.draftOf(tx, documentId)

      const [existing] = await tx
        .select()
        .from(documentLines)
        .where(
          and(
            eq(documentLines.id, lineId as DocumentLineId),
            eq(documentLines.documentId, documentId as DocumentId),
            isNull(documentLines.deletedAt),
          ),
        )

      if (!existing) {
        throw new NotFoundException()
      }

      const [updated] = await tx
        .update(documentLines)
        .set({
          ...(values as Partial<typeof documentLines.$inferInsert>),
          netCents: totalOf(values, existing),
        })
        .where(eq(documentLines.id, lineId as DocumentLineId))
        .returning()

      return updated
    })
  }

  @Delete(':lineId')
  @RequiresPermission('document.write')
  async remove(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
    @Param('lineId') lineId: string,
  ) {
    return await this.database.forTenant(identity, async (tx) => {
      await this.draftOf(tx, documentId)

      // Marked, not removed, like everything a device knows about. A row that
      // is gone is a row a device that was offline never hears about again.
      const [removed] = await tx
        .update(documentLines)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(documentLines.id, lineId as DocumentLineId),
            eq(documentLines.documentId, documentId as DocumentId),
            isNull(documentLines.deletedAt),
          ),
        )
        .returning()

      if (!removed) {
        throw new NotFoundException()
      }

      return { removed: removed.id }
    })
  }

  private async nextPosition(tx: TenantTransaction, documentId: string): Promise<number> {
    const rows = await tx
      .select({ position: documentLines.position })
      .from(documentLines)
      .where(
        and(
          eq(documentLines.documentId, documentId as DocumentId),
          isNull(documentLines.deletedAt),
        ),
      )

    return rows.reduce((highest, row) => Math.max(highest, row.position), 0) + 1
  }
}

/**
 * What the document adds up to.
 *
 * A route of its own rather than a field on the document, and that is the
 * whole point of issue #54: a total kept on the head would be the same number
 * in a second place, and two places drift. This one is worked out from the
 * lines every time it is asked for, by the rules of the document's own date.
 */
@Controller('documents/:documentId/totals')
export class DocumentTotalsController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('document.read')
  totals(@CurrentIdentity() identity: RequestIdentity, @Param('documentId') documentId: string) {
    return this.database.forTenant(identity, async (tx) => {
      const [document] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, documentId as DocumentId), isNull(documents.deletedAt)))

      if (!document) {
        throw new NotFoundException()
      }

      const lines = await tx
        .select({ netCents: documentLines.netCents, vatRate: documentLines.vatRate })
        .from(documentLines)
        .where(
          and(
            eq(documentLines.documentId, documentId as DocumentId),
            isNull(documentLines.deletedAt),
          ),
        )

      return totalsFor(shippedRules, lines, document)
    })
  }
}
