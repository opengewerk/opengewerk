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
  cancellationOf,
  currentContent,
  type CustomerId,
  defaultPatterns,
  type DocumentContent,
  type DocumentId,
  type DocumentKind,
  documentKinds,
  type DocumentStatus,
  type EInvoiceGap,
  type InstructionGap,
  formatDocumentNumber,
  isCancellable,
  type IsoDate,
  type MissingDetail,
  missingDetails,
  noInstructionChoices,
  numberRangeOf,
  paymentTermProblem,
  RuleError,
  shippedRules,
  successorsOf,
  type TaxTreatment,
  whyFixed,
} from '@opengewerk/domain'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { Database, type TenantTransaction } from '../database/database.js'
import { assignDocumentNumber } from '../database/number-ranges.js'
import {
  documentInstructionChoices,
  documentLines,
  documents,
  documentSnapshots,
  numberRanges,
} from '../database/schema/index.js'
import { contentAndGapsOf, issuerOf } from '../documents/content.js'
import { deductionsFor } from '../documents/deductions.js'
import { choicesOf } from '../documents/instructions.js'
import { proposedTreatment } from '../documents/treatment.js'
import { documentTitle } from '../documents/template.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { eInvoiceRefusals } from './e-invoice.controller.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { todayInGermany } from './today.js'

/** What stands between a draft and its number, whatever the list it comes from. */
type Missing = MissingDetail | EInvoiceGap | InstructionGap

/**
 * What a document says, put together for issuing, and what it still lacks.
 *
 * A date the rules have nothing for is the one way this can fail on input
 * rather than on a bug: a document dated 2005 has no VAT rate and no limit
 * for a small amount in the packages, and the engine says so instead of
 * guessing. That is something the person issuing can fix, so it comes back as
 * a refusal with the sentence.
 *
 * What an invoice lacks includes, once the law requires the e-invoice of it,
 * what the e-invoice lacks. From then on a PDF alone is not a proper invoice,
 * and an invoice that could only go out as one is not issued; before then it
 * is, and the office sees on its screen what the e-invoice would still need.
 */
async function contentForIssuing(
  tx: TenantTransaction,
  document: typeof documents.$inferSelect,
): Promise<{ content: DocumentContent; missing: readonly Missing[] }> {
  try {
    const { content, gaps } = await contentAndGapsOf(tx, document, shippedRules)

    return {
      content,
      missing: [
        ...missingDetails(shippedRules, content),
        ...(await eInvoiceRefusals(tx, content)),
        ...gaps,
      ],
    }
  } catch (error) {
    if (error instanceof RuleError) {
      throw new UnprocessableEntityException(error.message)
    }

    throw error
  }
}

/** The refusal for a document that lacks mandatory details, the same for every route. */
function lacking(missing: readonly Missing[]): UnprocessableEntityException {
  // A sentence for whoever reads only `message`, and the list for a screen
  // that wants to point at each field.
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    message:
      'Der Beleg kann noch nicht festgeschrieben werden, es fehlen Pflichtangaben. ' +
      missing.map((entry) => entry.message).join(' '),
    missing,
  })
}

/** The states a document is issued from: a draft, or a report the customer signed. */
const issuable: readonly DocumentStatus[] = ['draft', 'signed']

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
  'introText',
  'closingText',
  // Writable while the document is a draft, and refused afterwards by the
  // trigger like every other field. The proposal above is right in the common
  // case and cannot be right in all of them.
  'taxTreatment',
  // The document's own payment term, or null for the business's setting.
  'paymentTermDays',
] as const

/**
 * Refuses a payment term no form of this system would send, with the sentence
 * the form shows. Null is not refused: it hands the document back to the
 * business's setting. The check in the database would refuse the rest too,
 * with a sentence written for a developer.
 */
function checkPaymentTerm(values: Partial<Record<string, unknown>>): void {
  if (values['paymentTermDays'] === undefined || values['paymentTermDays'] === null) {
    return
  }

  const problem = paymentTermProblem(values['paymentTermDays'])

  if (problem !== null) {
    throw new BadRequestException(problem)
  }
}

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
    checkPaymentTerm(values)

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
    checkPaymentTerm(values)

    return this.database.forTenant(identity, async (tx) => {
      const [updated] = await tx
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
        .returning()

      if (updated) {
        return updated
      }

      // Nothing changed, and there are two very different reasons for that.
      // A document that is not there is a 404. One that is there and fixed
      // gets the sentence why, because "not found" for a quote the office is
      // looking at would send somebody searching for a fault that is none.
      const [existing] = await tx
        .select({ kind: documents.kind, status: documents.status })
        .from(documents)
        .where(and(eq(documents.id, id as DocumentId), isNull(documents.deletedAt)))

      const reason = existing ? whyFixed(existing) : null

      if (reason === null) {
        throw new NotFoundException()
      }

      throw new ConflictException(reason)
    })
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
   *
   * A signed report is issued the same way. The customer's signature froze
   * what it says; issuing adds the number and the moment, and the trigger on
   * the table lets exactly that through and nothing more.
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

      if (!issuable.includes(existing.status)) {
        throw new ConflictException('Der Beleg ist schon festgeschrieben.')
      }

      const { content, missing } = await contentForIssuing(tx, existing)

      if (missing.length > 0) {
        throw lacking(missing)
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
            inArray(documents.status, [...issuable]),
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
   * The next document in the chain of section 1.4, made out of this one: an
   * order confirmation out of a quote, an invoice out of what the work was
   * agreed or recorded on, the next progress invoice out of the one before.
   * Which kind may follow which is `successorKinds` in `domain`.
   *
   * On the server and in one transaction, because it is a head and every line
   * of the predecessor. Through the outbox it would be dozens of operations
   * arriving one by one, and a connection lost halfway would leave an order
   * confirmation with half the positions of the quote it confirms.
   *
   * Only out of an issued document. What the customer accepted is the quote
   * that went out, not a draft that may still change after the confirmation
   * has been written against it.
   *
   * The lines are copied and not referenced. The confirmation is a document of
   * its own: it may drop a position the customer did not order, and it is
   * frozen on its own when it is issued. The link back is the predecessor
   * reference, which is what the quantity comparison of section 1.4 walks.
   *
   * The tax treatment comes along from the predecessor rather than being
   * proposed anew. The confirmation confirms that deal, and a treatment
   * somebody chose by hand on the quote is part of it.
   *
   * The texts above and below the lines stay behind. They were written for
   * the letter the quote was, and an order confirmation that opens with
   * "thank you for your enquiry" answers a question nobody asked any more.
   *
   * The time of the work comes along where the predecessor knows it. A report
   * is written on the day of the work, so its date is the date of service of
   * the invoice made out of it, which section 14 (4) number 6 UStG asks for;
   * any other predecessor passes on the period it states, if it states one.
   */
  @Post(':id/successors')
  @RequiresPermission('document.write')
  async successor(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const values = pick(body, ['kind', 'documentDate'] as const)
    requireFields(values, ['kind'])

    if (!(documentKinds as readonly string[]).includes(String(values.kind))) {
      throw new BadRequestException(`Unbekannte Belegart: ${String(values.kind)}`)
    }

    const kind = values.kind as DocumentKind
    const documentDate = (values.documentDate as IsoDate | undefined) ?? todayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const [predecessor] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, id as DocumentId), isNull(documents.deletedAt)))

      if (!predecessor) {
        throw new NotFoundException()
      }

      if (!successorsOf(predecessor.kind).includes(kind)) {
        throw new BadRequestException(
          `Aus einem Beleg der Art ${documentTitle(predecessor.kind)} entsteht keine ` +
            `${documentTitle(kind)}.`,
        )
      }

      if (predecessor.status !== 'issued') {
        throw new ConflictException(
          predecessor.status === 'draft'
            ? 'Ein Folgebeleg entsteht aus einem festgeschriebenen Beleg, und dieser ist noch ein ' +
                'Entwurf. Erst festschreiben, dann den Folgebeleg anlegen.'
            : 'Aus einem stornierten Beleg entsteht kein Folgebeleg.',
        )
      }

      const [created] = await tx
        .insert(documents)
        .values({
          tenantId: identity.tenantId,
          customerId: predecessor.customerId,
          jobId: predecessor.jobId,
          siteId: predecessor.siteId,
          installationId: predecessor.installationId,
          predecessorDocumentId: predecessor.id,
          kind,
          documentDate,
          subject: predecessor.subject,
          taxTreatment: predecessor.taxTreatment,
          // A term the quote stated for itself was agreed with the customer,
          // and the invoice out of it asks for the same. Without one, the
          // successor follows the setting on its own date, as it would anyway.
          paymentTermDays: predecessor.paymentTermDays,
          serviceFrom:
            predecessor.serviceFrom ??
            (predecessor.kind === 'time_and_material_report' ? predecessor.documentDate : null),
          serviceUntil: predecessor.serviceUntil,
        })
        .returning()

      if (!created) {
        throw new Error('The successor was written and is not readable afterwards.')
      }

      // The kind of contract belongs to the deal and not to the letter: the
      // order confirmation of a delivery is about a delivery as well. What is
      // switched on or off stays behind, because the successor is a different
      // kind and gets the proposal for its own.
      const { variant } = await choicesOf(tx, predecessor.id)

      if (variant !== noInstructionChoices.variant) {
        await tx
          .insert(documentInstructionChoices)
          .values({ tenantId: identity.tenantId, documentId: created.id, variant })
      }

      const lines = await tx
        .select()
        .from(documentLines)
        .where(and(eq(documentLines.documentId, predecessor.id), isNull(documentLines.deletedAt)))
        .orderBy(asc(documentLines.position), asc(documentLines.id))

      if (lines.length > 0) {
        await tx.insert(documentLines).values(
          lines.map((line) => ({
            tenantId: identity.tenantId,
            documentId: created.id,
            kind: line.kind,
            position: line.position,
            designation: line.designation,
            description: line.description,
            quantityMilli: line.quantityMilli,
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            vatRate: line.vatRate,
            netCents: line.netCents,
          })),
        )
      }

      return created
    })
  }

  /**
   * The progress invoices this document takes off, oldest first. Empty for a
   * kind that deducts nothing.
   *
   * A draft gets them out of its chain, as they stand in the snapshots of the
   * progress invoices. An issued document gets the list it froze, and that is
   * also how a cancellation shows the deductions it turns round: it has no
   * chain of its own to walk, only the mirror of its invoice.
   */
  @Get(':id/deductions')
  @RequiresPermission('document.read')
  async deductions(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    return this.database.forTenant(identity, async (tx) => {
      const [document] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, id as DocumentId), isNull(documents.deletedAt)))

      if (!document) {
        throw new NotFoundException()
      }

      if (document.status === 'issued' || document.status === 'cancelled') {
        const [snapshot] = await tx
          .select({ content: documentSnapshots.content })
          .from(documentSnapshots)
          .where(eq(documentSnapshots.documentId, document.id))

        if (snapshot) {
          return currentContent(snapshot.content).deductions
        }
      }

      try {
        return await deductionsFor(tx, document)
      } catch (error) {
        if (error instanceof RuleError) {
          throw new UnprocessableEntityException(error.message)
        }

        throw error
      }
    })
  }

  /**
   * Cancelling an invoice, section 4.2 and leading decision 4: an issued
   * invoice is never changed and never deleted, it is cancelled by an invoice
   * of its own that turns every figure round, and both stay in the books.
   *
   * One step and one transaction, like issuing. The cancellation is made, its
   * lines are written as the mirror of the invoice's, its mandatory details
   * are checked, it gets the next number of the invoice sequence and its
   * snapshot, and the invoice becomes `cancelled`. A failure anywhere takes all
   * of it back and leaves no hole in the numbers. What it says comes out of
   * the invoice's own snapshot, see `cancellationOf`.
   *
   * Its right is the right to issue: a cancellation is a booking as much as
   * the invoice was, and a technician writes neither.
   *
   * Not while another issued invoice builds on this one. A progress invoice
   * that a later invoice deducted is part of that invoice's figures, and
   * cancelling it from under it would leave the later one deducting something
   * that no longer stands. The later one goes first.
   *
   * The transaction marks itself with `app.cancelling`, the one mark the
   * database accepts for making a document of this kind; see migration 0016.
   */
  @Post(':id/cancellation')
  @RequiresPermission('document.issue')
  async cancel(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    return this.database.forTenant(identity, async (tx) => {
      const [original] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, id as DocumentId), isNull(documents.deletedAt)))

      if (!original) {
        throw new NotFoundException()
      }

      if (original.kind === 'cancellation_invoice') {
        throw new BadRequestException(
          'Eine Stornorechnung wird nicht storniert. Soll die Leistung wieder berechnet werden, ' +
            'entsteht dafür eine neue Rechnung.',
        )
      }

      if (!isCancellable(original.kind)) {
        throw new BadRequestException(
          'Storniert wird nur eine Rechnung. Ein anderer Beleg, der nicht mehr gilt, wird durch ' +
            'einen neuen ersetzt.',
        )
      }

      if (original.status === 'draft') {
        throw new ConflictException(
          'Ein Entwurf wird nicht storniert, sondern gelöscht: er steht noch in keinen Büchern.',
        )
      }

      if (original.status !== 'issued') {
        throw new ConflictException('Die Rechnung ist schon storniert.')
      }

      const [later] = await tx
        .select({ kind: documents.kind, number: documents.number })
        .from(documents)
        .where(
          and(
            eq(documents.predecessorDocumentId, original.id),
            eq(documents.status, 'issued'),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1)

      if (later) {
        throw new ConflictException(
          `Auf diese Rechnung baut die ${documentTitle(later.kind)} ${later.number ?? ''} auf. ` +
            'Erst jene stornieren, dann diese.',
        )
      }

      const [snapshot] = await tx
        .select({ content: documentSnapshots.content })
        .from(documentSnapshots)
        .where(eq(documentSnapshots.documentId, original.id))

      if (!snapshot) {
        throw new UnprocessableEntityException(
          'Für diese Rechnung ist nicht festgehalten, was sie gestellt hat, deshalb lässt sich ' +
            'ihr Spiegel nicht schreiben.',
        )
      }

      const documentDate = todayInGermany()
      const content = cancellationOf(currentContent(snapshot.content), {
        number: null,
        documentDate,
        issuer: await issuerOf(tx, identity.tenantId),
      })
      // Not held back for the e-invoice, unlike an invoice: a cancellation that
      // cannot be written leaves an invoice standing that should not stand,
      // which is worse than a cancellation whose e-invoice lacks a value. It
      // names the same customer as the invoice, so on that side it lacks at
      // most what the invoice lacked, and the office sees it on its screen.
      const missing = missingDetails(shippedRules, content)

      if (missing.length > 0) {
        throw lacking(missing)
      }

      await tx.execute(sql`select set_config('app.cancelling', 'on', true)`)

      const [created] = await tx
        .insert(documents)
        .values({
          tenantId: identity.tenantId,
          customerId: original.customerId,
          jobId: original.jobId,
          siteId: original.siteId,
          installationId: original.installationId,
          predecessorDocumentId: original.id,
          kind: 'cancellation_invoice',
          documentDate,
          serviceFrom: original.serviceFrom,
          serviceUntil: original.serviceUntil,
          subject: original.subject,
          taxTreatment: original.taxTreatment,
        })
        .returning()

      if (!created) {
        throw new Error('The cancellation was written and is not readable afterwards.')
      }

      const lines = await tx
        .select()
        .from(documentLines)
        .where(and(eq(documentLines.documentId, original.id), isNull(documentLines.deletedAt)))
        .orderBy(asc(documentLines.position), asc(documentLines.id))

      if (lines.length > 0) {
        await tx.insert(documentLines).values(
          lines.map((line) => ({
            tenantId: identity.tenantId,
            documentId: created.id,
            kind: line.kind,
            position: line.position,
            designation: line.designation,
            description: line.description,
            // The mirror: the quantity turned round, the price as it was, so
            // the total comes out turned round by the same arithmetic.
            quantityMilli: -line.quantityMilli || 0,
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            vatRate: line.vatRate,
            netCents: -line.netCents || 0,
          })),
        )
      }

      const issuedAt = new Date()
      const number = await assignDocumentNumber(
        tx,
        identity.tenantId,
        'cancellation_invoice',
        issuedAt,
      )

      const [issued] = await tx
        .update(documents)
        .set({ status: 'issued', number, issuedAt, updatedAt: issuedAt })
        .where(and(eq(documents.id, created.id), eq(documents.status, 'draft')))
        .returning()

      await tx.insert(documentSnapshots).values({
        tenantId: identity.tenantId,
        documentId: created.id,
        content: { ...content, number },
      })

      // The status and nothing else, which is exactly what the trigger on the
      // table lets through for an issued document. Checked on `issued` again:
      // two cancellations of the same invoice at the same moment would both
      // have passed the check above, and the second finds nothing to cancel
      // here and takes its own cancellation back with it.
      const [cancelled] = await tx
        .update(documents)
        .set({ status: 'cancelled', updatedAt: issuedAt })
        .where(
          and(
            eq(documents.id, original.id),
            eq(documents.status, 'issued'),
            isNull(documents.deletedAt),
          ),
        )
        .returning({ id: documents.id })

      if (!issued || !cancelled) {
        throw new ConflictException('Die Rechnung ist inzwischen storniert worden.')
      }

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
    return this.database.forTenant(identity, async (tx) => {
      const [removed] = await tx
        .update(documents)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(documents.id, id as DocumentId),
            eq(documents.status, 'draft'),
            isNull(documents.deletedAt),
          ),
        )
        .returning()

      if (removed) {
        return removed
      }

      // The same two answers as a refused change: not there, or there and
      // past the point where it could be removed, with the sentence why.
      const [existing] = await tx
        .select({ kind: documents.kind, status: documents.status })
        .from(documents)
        .where(and(eq(documents.id, id as DocumentId), isNull(documents.deletedAt)))

      const reason = existing ? whyFixed(existing) : null

      if (reason === null) {
        throw new NotFoundException()
      }

      throw new ConflictException(reason)
    })
  }
}
