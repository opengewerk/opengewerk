import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  berlinClock,
  declineRefusal,
  type DocumentId,
  type IsoDate,
  offerDeclineProblems,
} from '@opengewerk/domain'
import { Database, isUuid, pick, type TenantTransaction } from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { documents, maintenanceContracts, offerDeclines } from '../database/schema/index.js'
import { RequiresPermission } from './authorization.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/** A decline as the office reads it. */
export type OfferDeclineEntry = typeof offerDeclines.$inferSelect

/**
 * The offer a decline is about, locked like the successor route locks it, so
 * that a decline and a successor made at the same moment wait for each other
 * and the second finds the first.
 */
async function lockedOffer(tx: TenantTransaction, documentId: string) {
  if (!isUuid(documentId)) {
    throw new NotFoundException()
  }

  const [offer] = await tx
    .select({
      id: documents.id,
      kind: documents.kind,
      status: documents.status,
      documentDate: documents.documentDate,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId as DocumentId), isNull(documents.deletedAt)))
    .for('update')

  if (!offer) {
    throw new NotFoundException()
  }

  return offer
}

/**
 * That the customer turned an offer down (#841): the office marks an issued
 * quote or cost estimate nothing follows yet, with the day and a reason, and
 * takes the mark back when the customer returns. Read with the documents,
 * kept by whoever issues them, like a maintenance contract out of a quote.
 */
@Controller('offer-declines')
export class OfferDeclinesController {
  constructor(private readonly database: Database) {}

  @Get()
  @RequiresPermission('document.read')
  list(@CurrentIdentity() identity: RequestIdentity) {
    return this.database.forTenant(identity, (tx) => tx.select().from(offerDeclines))
  }

  @Put(':documentId')
  @RequiresPermission('document.issue')
  async decline(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ) {
    const today = berlinClock(new Date()).day
    const given = pick(body, ['declinedOn', 'reason'] as const)
    const reason =
      typeof given.reason === 'string' && given.reason.trim() !== '' ? given.reason.trim() : null
    const values = { declinedOn: given.declinedOn ?? today, reason }

    return this.database.forTenant(identity, async (tx) => {
      const offer = await lockedOffer(tx, documentId)
      const [following] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.predecessorDocumentId, offer.id), isNull(documents.deletedAt)))
        .limit(1)
      const [contract] = await tx
        .select({ id: maintenanceContracts.id })
        .from(maintenanceContracts)
        .where(eq(maintenanceContracts.quoteId, offer.id))
        .limit(1)
      const refusal = declineRefusal({
        kind: offer.kind,
        status: offer.status,
        followed: following !== undefined,
        contracted: contract !== undefined,
      })

      if (refusal !== null) {
        throw new ConflictException(refusal)
      }

      const [, problem] =
        Object.entries(
          offerDeclineProblems(values, { today, offeredOn: offer.documentDate as IsoDate }),
        )[0] ?? []

      if (problem !== undefined) {
        throw new UnprocessableEntityException(problem)
      }

      const [kept] = await tx
        .insert(offerDeclines)
        .values({
          tenantId: identity.tenantId,
          documentId: offer.id,
          declinedOn: values.declinedOn as string,
          reason,
        })
        .onConflictDoUpdate({
          target: [offerDeclines.tenantId, offerDeclines.documentId],
          set: { declinedOn: values.declinedOn as string, reason, updatedAt: new Date() },
        })
        .returning()

      return kept
    })
  }

  /** Takes the mark back: the customer wants the offer after all. */
  @Delete(':documentId')
  @RequiresPermission('document.issue')
  async withdraw(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
  ) {
    return this.database.forTenant(identity, async (tx) => {
      const offer = await lockedOffer(tx, documentId)
      const [gone] = await tx
        .delete(offerDeclines)
        .where(eq(offerDeclines.documentId, offer.id))
        .returning({ id: offerDeclines.id })

      if (!gone) {
        throw new NotFoundException()
      }

      return { documentId: offer.id }
    })
  }
}
