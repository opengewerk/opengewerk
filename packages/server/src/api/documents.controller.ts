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
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type CustomerId,
  defaultPatterns,
  type DocumentContent,
  type DocumentId,
  type DocumentKind,
  documentKinds,
  formatDocumentNumber,
  type IsoDate,
  missingDetails,
  numberRangeOf,
  RuleError,
  shippedRules,
  type TaxTreatment,
  treatmentFor,
} from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import { Database, type TenantTransaction } from '../database/database.js'
import { assignDocumentNumber } from '../database/number-ranges.js'
import { parameterAt } from '../database/parameters.js'
import { customers, documents, documentSnapshots, numberRanges } from '../database/schema/index.js'
import { contentOf } from '../documents/content.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

/**
 * What treatment a new document should carry, from the two sides that decide
 * it: what the customer is, and what the business claims for itself.
 *
 * Both are read as they stood on the document's date, not as they stand today,
 * because that is the only reading that keeps an old invoice readable. A
 * business that claimed section 19 in 2027 wrote section 19 invoices in 2027,
 * whatever it claims now.
 *
 * A proposal, not a verdict: the field is writable while the document is a
 * draft, because the two flags do not know every case.
 */
async function proposedTreatment(
  tx: TenantTransaction,
  customerId: CustomerId,
  on: IsoDate,
): Promise<TaxTreatment> {
  const [customer] = await tx
    .select({ construction: customers.isConstructionServiceRecipient })
    .from(customers)
    .where(eq(customers.id, customerId))

  const claimed = await parameterAt(tx, 'small_business.claimed', on)

  return treatmentFor({
    customerIsConstructionServiceRecipient: customer?.construction ?? false,
    businessClaimsSmallBusiness: claimed?.value === 1,
  })
}

/**
 * What a document says, put together for issuing, and what it still lacks.
 *
 * A date the rules have nothing for is the one way this can fail on input
 * rather than on a bug: a document dated 2005 has no VAT rate and no limit
 * for a small amount in the packages, and the engine says so instead of
 * guessing. That is something the person issuing can fix, so it comes back as
 * a refusal with the sentence.
 */
async function contentForIssuing(
  tx: TenantTransaction,
  document: typeof documents.$inferSelect,
): Promise<{ content: DocumentContent; missing: ReturnType<typeof missingDetails> }> {
  try {
    const content = await contentOf(tx, document, shippedRules)

    return { content, missing: missingDetails(shippedRules, content) }
  } catch (error) {
    if (error instanceof RuleError) {
      throw new UnprocessableEntityException(error.message)
    }

    throw error
  }
}

const writableFields = [
  'customerId',
  'jobId',
  'siteId',
  'installationId',
  'predecessorDocumentId',
  'kind',
  'documentDate',
  // When the work was done. Required on most invoices, see `missingDetails`,
  // and entered by whoever writes the document, not worked out.
  'serviceFrom',
  'serviceUntil',
  'subject',
  // Writable while the document is a draft, and refused afterwards by the
  // trigger like every other field. The proposal above is right in the common
  // case and cannot be right in all of them.
  'taxTreatment',
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

    const [created] = await this.database.forTenant(identity, async (tx) =>
      tx
        .insert(documents)
        .values({
          ...(values as typeof documents.$inferInsert),
          tenantId: identity.tenantId,
          // Worked out once, here, and then it belongs to the document. Asking
          // the customer record again on reading would rewrite an invoice from
          // last year the day a customer's flag changes.
          taxTreatment:
            (values['taxTreatment'] as TaxTreatment | undefined) ??
            (await proposedTreatment(
              tx,
              values['customerId'] as CustomerId,
              values['documentDate'] as IsoDate,
            )),
        })
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
   * Before the number, the mandatory details. An invoice that lacks one of
   * them is refused with a list of what is missing, each item naming the
   * paragraph, and the counter is not touched: section 4.2 wants the check
   * before the fixing, and a number spent on an invoice that then cannot go
   * out would be a hole the next tax audit asks about.
   *
   * After the number, the snapshot. What the document says is written down in
   * the same transaction, so that the PDF printed from it next week or in ten
   * years shows the customer's address of today and not of then.
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
        .where(and(eq(documents.id, id as DocumentId), isNull(documents.deletedAt)))

      if (!existing) {
        throw new NotFoundException()
      }

      if (existing.status !== 'draft') {
        throw new ConflictException('Der Beleg ist nicht mehr im Entwurf.')
      }

      const { content, missing } = await contentForIssuing(tx, existing)

      if (missing.length > 0) {
        // A sentence for whoever reads only `message`, and the list for a
        // screen that wants to point at each field.
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message:
            'Der Beleg kann noch nicht festgeschrieben werden, es fehlen Pflichtangaben. ' +
            missing.map((entry) => entry.message).join(' '),
          missing,
        })
      }

      const issuedAt = new Date()
      const number = await assignDocumentNumber(tx, identity.tenantId, existing.kind, issuedAt)

      // `deletedAt` a second time, and not out of habit: between the read
      // above and this write somebody can delete the document, and the two
      // conditions that are here anyway would both still hold. What comes out
      // of that race cannot be repaired on a running installation. The number
      // is spent, the entry is in the hash chain, and the document is fixed
      // and out of every list at the same time.
      const [issued] = await tx
        .update(documents)
        .set({ status: 'issued', number, issuedAt, updatedAt: issuedAt })
        .where(
          and(
            eq(documents.id, existing.id),
            eq(documents.status, 'draft'),
            isNull(documents.deletedAt),
          ),
        )
        .returning()

      if (!issued) {
        throw new NotFoundException()
      }

      await tx.insert(documentSnapshots).values({
        tenantId: identity.tenantId,
        documentId: issued.id,
        content: { ...content, number },
      })

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
