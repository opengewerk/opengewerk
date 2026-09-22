import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Res,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  type DocumentId,
  type InstructionChoices,
  type InstructionContent,
  type InstructionTemplate,
  proposedFor,
  RuleError,
  shippedRules,
  whyFixed,
  type WithdrawalVariant,
  withdrawalVariants,
} from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'
import type { Response } from 'express'

import { Database, type TenantTransaction } from '../database/database.js'
import { customers, documentInstructionChoices, documents } from '../database/schema/index.js'
import { contentOf, frozenContent, issuerOf } from '../documents/content.js'
import { choicesOf, instructionsFor, instructionsOf } from '../documents/instructions.js'
import { documentTitle } from '../documents/template.js'
import { RequiresPermission } from './authorization.js'
import { pick } from './body.js'
import { DocumentFiles } from './document-files.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'

type DocumentRow = typeof documents.$inferSelect

/** One instruction of the business, and whether it goes with this document. */
export interface InstructionChoiceView {
  readonly id: string
  readonly title: string
  readonly template: InstructionTemplate | null
  /** Proposed for this document by its kind and its customer. */
  readonly proposed: boolean
  /** Goes with it: the proposal, or what the office chose instead. */
  readonly included: boolean
  readonly withDocument: boolean
  /** A shipped one whose words the business changed. */
  readonly changed: boolean
}

/** An instruction the way it is printed with this document; the index names its sheet. */
export interface PrintedInstructionView {
  readonly index: number
  readonly title: string
  readonly withDocument: boolean
  readonly changed: boolean
  /** Where its model is in the law, for a shipped one. */
  readonly source: string | null
}

export interface DocumentInstructionsView {
  /** Nothing left to choose: the document was issued, or signed on site. */
  readonly fixed: boolean
  readonly variant: WithdrawalVariant
  /** Every instruction of the business, for a draft. Empty once the document is fixed. */
  readonly choices: readonly InstructionChoiceView[]
  /** What goes with the document, in the order it is printed. */
  readonly printed: readonly PrintedInstructionView[]
  /** What stands in the way of issuing with these instructions, as sentences. */
  readonly gaps: readonly string[]
}

function printedFrom(
  instructions: readonly InstructionContent[],
): readonly PrintedInstructionView[] {
  return instructions.map((instruction, index) => ({
    index,
    title: instruction.title,
    withDocument: instruction.withDocument,
    changed: instruction.model?.changed ?? false,
    source: instruction.model?.source ?? null,
  }))
}

/** A title as it may stand in a file name. A document number may well contain a slash. */
function safe(value: string): string {
  return value.replaceAll(/[\\/:*?"<>|]+/g, '-')
}

/**
 * The instructions of one document, #109: which of them go with it, which
 * kind of contract they are filled in for, and each of them as a sheet.
 *
 * Choosing is writing the document, and only a draft can be chosen for; from
 * issuing on, the instructions are the ones in the snapshot, and this route
 * shows those. Under `documents`, which the browser, the service worker and
 * the development proxy already hand to the server.
 */
@Controller('documents/:documentId/instructions')
export class DocumentInstructionsController {
  constructor(
    private readonly database: Database,
    private readonly files: DocumentFiles,
  ) {}

  private async document(tx: TenantTransaction, documentId: string): Promise<DocumentRow> {
    const [document] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId as DocumentId), isNull(documents.deletedAt)))

    if (!document) {
      throw new NotFoundException()
    }

    return document
  }

  private async recipientIsBusiness(tx: TenantTransaction, document: DocumentRow) {
    const [customer] = await tx
      .select({ isBusiness: customers.isBusiness })
      .from(customers)
      .where(eq(customers.id, document.customerId))

    return customer?.isBusiness ?? false
  }

  private async view(
    tx: TenantTransaction,
    document: DocumentRow,
  ): Promise<DocumentInstructionsView> {
    if (document.status === 'issued' || document.status === 'cancelled') {
      const content = await frozenContent(tx, document.id)

      return {
        fixed: true,
        variant: content?.instructions[0]?.variant ?? 'service',
        choices: [],
        printed: content ? printedFrom(content.instructions) : [],
        gaps: [],
      }
    }

    const isBusiness = await this.recipientIsBusiness(tx, document)
    const issuer = await issuerOf(tx, document.tenantId)
    const { contents, gaps } = await instructionsFor(tx, document, issuer, isBusiness)
    const choices = await choicesOf(tx, document.id)
    const facts = { kind: document.kind, recipientIsBusiness: isBusiness }

    return {
      fixed: document.status !== 'draft',
      variant: choices.variant,
      choices:
        document.status === 'draft'
          ? (await instructionsOf(tx)).map((row) => {
              const proposed = proposedFor(row, facts)

              return {
                id: row.id,
                title: row.title,
                template: row.template,
                proposed,
                included: choices.switchedOff.includes(row.id)
                  ? false
                  : choices.switchedOn.includes(row.id) || proposed,
                withDocument: row.withDocument,
                changed: row.template !== null && row.body !== null,
              }
            })
          : [],
      printed: printedFrom(contents),
      gaps: gaps.map((gap) => gap.message),
    }
  }

  @Get()
  @RequiresPermission('document.read')
  show(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
  ): Promise<DocumentInstructionsView> {
    return this.database.forTenant(identity, async (tx) =>
      this.view(tx, await this.document(tx, documentId)),
    )
  }

  /**
   * One choice at a time: the kind of contract, or one instruction switched on
   * or off. A choice that matches the proposal is kept as none, so that the
   * document follows the proposal again when its customer or its kind
   * changes.
   */
  @Put()
  @RequiresPermission('document.write')
  choose(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
    @Body() body: unknown,
  ): Promise<DocumentInstructionsView> {
    const values = pick(body, ['variant', 'instructionId', 'included'] as const)

    if (values.variant === undefined && values.instructionId === undefined) {
      throw new BadRequestException('Die Anfrage enthält keine Änderung.')
    }

    if (
      values.variant !== undefined &&
      !(withdrawalVariants as readonly unknown[]).includes(values.variant)
    ) {
      throw new BadRequestException(
        `variant muss einer von diesen Werten sein: ${withdrawalVariants.join(', ')}`,
      )
    }

    if (
      values.instructionId !== undefined &&
      (typeof values.instructionId !== 'string' || typeof values.included !== 'boolean')
    ) {
      throw new BadRequestException(
        'Eine Belehrung wird mit ihrer Kennung und included, ja oder nein, geschaltet.',
      )
    }

    return this.database.forTenant(identity, async (tx) => {
      const document = await this.document(tx, documentId)

      if (document.status !== 'draft') {
        throw new ConflictException(
          whyFixed(document) ??
            'Die Belehrungen eines Belegs werden gewählt, solange er ein Entwurf ist.',
        )
      }

      const current = await choicesOf(tx, document.id)
      let next: InstructionChoices = {
        ...current,
        variant: (values.variant as WithdrawalVariant | undefined) ?? current.variant,
      }

      if (typeof values.instructionId === 'string') {
        const instruction = (await instructionsOf(tx)).find(
          (row) => row.id === values.instructionId,
        )

        if (!instruction) {
          throw new NotFoundException('Diese Belehrung gibt es in diesem Betrieb nicht.')
        }

        const proposed = proposedFor(instruction, {
          kind: document.kind,
          recipientIsBusiness: await this.recipientIsBusiness(tx, document),
        })
        const included = values.included === true
        const on = current.switchedOn.filter((id) => id !== instruction.id)
        const off = current.switchedOff.filter((id) => id !== instruction.id)

        next = {
          ...next,
          switchedOn: included && !proposed ? [...on, instruction.id] : on,
          switchedOff: !included && proposed ? [...off, instruction.id] : off,
        }
      }

      await tx
        .insert(documentInstructionChoices)
        .values({
          tenantId: identity.tenantId,
          documentId: document.id,
          variant: next.variant,
          switchedOn: [...next.switchedOn],
          switchedOff: [...next.switchedOff],
        })
        .onConflictDoUpdate({
          target: documentInstructionChoices.documentId,
          set: {
            variant: next.variant,
            switchedOn: [...next.switchedOn],
            switchedOff: [...next.switchedOff],
            updatedAt: new Date(),
          },
        })

      return this.view(tx, document)
    })
  }

  /**
   * One instruction as a sheet of its own. For a draft out of the rows, as
   * the draft's PDF is, and marked as a draft; for an issued document out of
   * its snapshot, in the words it went out with.
   */
  @Get(':index/pdf')
  @RequiresPermission('document.read')
  async sheet(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('documentId') documentId: string,
    @Param('index') index: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const position = Number(index)

    const content = await this.database.forTenant(identity, async (tx) => {
      const document = await this.document(tx, documentId)

      if (document.status === 'draft' || document.status === 'signed') {
        try {
          return await contentOf(tx, document, shippedRules)
        } catch (error) {
          if (error instanceof RuleError) {
            throw new UnprocessableEntityException(error.message)
          }

          throw error
        }
      }

      const frozen = await frozenContent(tx, document.id)

      if (frozen === null) {
        throw new ConflictException(
          'Dieser Beleg wurde festgeschrieben, bevor OpenGewerk den Inhalt beim Festschreiben ' +
            'festhielt, und Belehrungen gab es damals noch nicht.',
        )
      }

      return frozen
    })

    const instruction = Number.isInteger(position) ? content.instructions[position] : undefined

    if (!instruction) {
      throw new NotFoundException('Zu diesem Beleg gibt es diese Belehrung nicht.')
    }

    const bytes = await this.files.printSheet(content, position)
    const document = `${documentTitle(content.kind)}${content.number === null ? '' : ` ${content.number}`}`
    const name = safe(`${instruction.title} zu ${document}.pdf`)

    response.setHeader('Cache-Control', 'no-store')

    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: `inline; filename="Belehrung.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      length: bytes.byteLength,
    })
  }
}
