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
  type DocumentKind,
  documentKinds,
  type InstructionId,
  instructionPlaceholders,
  latestWording,
  longestInstructionBody,
  longestInstructionTitle,
  normalizedWording,
  requiredKinds,
  unknownInstructionPlaceholders,
  wordingAt,
} from '@opengewerk/domain'
import { eq, max } from 'drizzle-orm'

import { Database, type TenantTransaction } from '../database/database.js'
import { instructions } from '../database/schema/index.js'
import {
  ensureShippedInstructions,
  type InstructionRow,
  instructionsOf,
  type InstructionView,
  instructionView,
  shownTitle,
} from '../documents/instructions.js'
import { RequiresPermission } from './authorization.js'
import { pick, requireFields, requireSomething } from './body.js'
import { CurrentIdentity, type RequestIdentity } from './identity.js'
import { todayInGermany } from './today.js'

const writableFields = ['title', 'body', 'kinds', 'consumersOnly', 'withDocument'] as const

type InstructionValues = Partial<Record<(typeof writableFields)[number], unknown>>

/** The heading, checked. Only an instruction the business wrote has one to set. */
function checkedTitle(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException('Eine Belehrung braucht eine Überschrift.')
  }

  if (value.trim().length > longestInstructionTitle) {
    throw new BadRequestException(
      `Die Überschrift einer Belehrung hat höchstens ${String(longestInstructionTitle)} Zeichen.`,
    )
  }

  return value.trim()
}

/**
 * The words, checked and in the form they are kept in. An unknown
 * placeholder is refused here, where it can still be corrected, and the
 * sentence lists the ones there are.
 */
function checkedBody(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Der Text einer Belehrung ist Text.')
  }

  const words = normalizedWording(value)

  if (words === '') {
    throw new BadRequestException(
      'Eine Belehrung braucht einen Text. Wer eine nicht mehr verwenden möchte, schlägt sie zu ' +
        'keinem Beleg mehr vor.',
    )
  }

  if (words.length > longestInstructionBody) {
    throw new BadRequestException(
      `Eine Belehrung hat höchstens ${String(longestInstructionBody)} Zeichen.`,
    )
  }

  const unknown = unknownInstructionPlaceholders(words)

  if (unknown.length > 0) {
    throw new BadRequestException(
      `${unknown.length === 1 ? 'Diesen Platzhalter' : 'Diese Platzhalter'} kennt OpenGewerk ` +
        `nicht: ${unknown.join(', ')}. Möglich sind ` +
        `${Object.keys(instructionPlaceholders).join(', ')}.`,
    )
  }

  return words
}

function checkedKinds(value: unknown): DocumentKind[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('Die Belegarten werden als Liste übergeben.')
  }

  const unknown = value.filter((kind) => !(documentKinds as readonly unknown[]).includes(kind))

  if (unknown.length > 0) {
    throw new BadRequestException(`Unbekannte Belegart: ${unknown.map(String).join(', ')}`)
  }

  // In the order of the list of kinds, each once, so that the same choice is
  // always the same row.
  return documentKinds.filter((kind) => value.includes(kind))
}

function checkedFlag(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${field} ist ja oder nein.`)
  }

  return value
}

/** The settings every instruction has, read where they were sent. */
function checkedSettings(values: InstructionValues) {
  return {
    ...(values.kinds === undefined ? {} : { kinds: checkedKinds(values.kinds) }),
    ...(values.consumersOnly === undefined
      ? {}
      : { consumersOnly: checkedFlag(values.consumersOnly, 'consumersOnly') }),
    ...(values.withDocument === undefined
      ? {}
      : { withDocument: checkedFlag(values.withDocument, 'withDocument') }),
  }
}

/**
 * The words of a shipped instruction the way they are kept: nothing when
 * they are the model in force today, because then the package speaks for
 * them and a later version reaches them too; else the business's words, with
 * the newest version of the model it had in front of it.
 */
function shippedWords(
  row: InstructionRow,
  body: string,
  today: string,
): Pick<InstructionRow, 'body' | 'basedOn'> {
  if (row.template === null) {
    return { body, basedOn: null }
  }

  const model = wordingAt(row.template, today)

  if (model && body === normalizedWording(model.text)) {
    return { body: null, basedOn: null }
  }

  return { body, basedOn: latestWording(row.template)?.validFrom ?? model?.validFrom ?? null }
}

/**
 * The instructions a business hands its customers with a document, #109.
 *
 * Under the settings rights, like the letterhead: the office reads them,
 * because it writes the documents they go out with, and the owner changes
 * them, because an instruction on withdrawal that is wrong costs the business
 * the right to be paid for work it did.
 *
 * Reading writes what is missing. The shipped instructions come into being
 * for a business the first time anybody asks, see
 * `ensureShippedInstructions`, which is also why a change of the law needs
 * no step on any installation.
 */
@Controller('settings/instructions')
export class InstructionsController {
  constructor(private readonly database: Database) {}

  private async existing(tx: TenantTransaction, id: string): Promise<InstructionRow> {
    const [row] = await tx
      .select()
      .from(instructions)
      .where(eq(instructions.id, id as InstructionId))

    if (!row) {
      throw new NotFoundException()
    }

    return row
  }

  @Get()
  @RequiresPermission('settings.read')
  list(@CurrentIdentity() identity: RequestIdentity): Promise<readonly InstructionView[]> {
    const today = todayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      await ensureShippedInstructions(tx, identity.tenantId)

      return (await instructionsOf(tx)).map((row) => instructionView(row, today))
    })
  }

  /** One the business writes itself, listed after everything it has. */
  @Post()
  @RequiresPermission('settings.write')
  create(
    @CurrentIdentity() identity: RequestIdentity,
    @Body() body: unknown,
  ): Promise<InstructionView> {
    const values = pick(body, writableFields)
    requireFields(values, ['title', 'body'])

    const title = checkedTitle(values.title)
    const words = checkedBody(values.body)
    const settings = checkedSettings(values)

    return this.database.forTenant(identity, async (tx) => {
      await ensureShippedInstructions(tx, identity.tenantId)

      const [last] = await tx.select({ position: max(instructions.position) }).from(instructions)

      const [created] = await tx
        .insert(instructions)
        .values({
          tenantId: identity.tenantId,
          template: null,
          title,
          body: words,
          ...settings,
          position: (last?.position ?? 0) + 1,
        })
        .returning()

      if (!created) {
        throw new Error('The instruction was written and is not readable afterwards.')
      }

      return instructionView(created, todayInGermany())
    })
  }

  /**
   * Changes an instruction. The heading only of one the business wrote: a
   * shipped instruction is printed under the heading of its model, which is
   * part of what the customer has to recognise. Its words may change, and a
   * changed model is marked as changed, which the screen explains before it
   * saves.
   */
  @Patch(':id')
  @RequiresPermission('settings.write')
  update(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<InstructionView> {
    const values = pick(body, writableFields)
    requireSomething(values)

    const settings = checkedSettings(values)
    const words = values.body === undefined ? undefined : checkedBody(values.body)
    const today = todayInGermany()

    return this.database.forTenant(identity, async (tx) => {
      const row = await this.existing(tx, id)

      if (values.title !== undefined && row.template !== null) {
        throw new BadRequestException(
          'Eine mitgelieferte Belehrung trägt die Überschrift ihres Musters. Wer eine andere ' +
            'möchte, legt eine eigene Belehrung an.',
        )
      }

      // The two models a quote to a consumer has to carry keep that quote, and
      // they go out with it: a sheet the office may forget to print is not an
      // instruction the customer got.
      const required = requiredKinds(row.template)
      const kinds = settings.kinds

      if (kinds && required.some((kind) => !kinds.includes(kind))) {
        throw new BadRequestException(
          `Die Belehrung „${shownTitle(row, today)}“ gehört zu jedem Angebot an einen ` +
            'Verbraucher, deshalb lässt sich das Angebot hier nicht abwählen.',
        )
      }

      if (settings.withDocument === false && required.length > 0) {
        throw new BadRequestException(
          `Die Belehrung „${shownTitle(row, today)}“ geht zwingend mit dem Angebot hinaus, ` +
            'im PDF und damit in der E-Mail.',
        )
      }

      const [updated] = await tx
        .update(instructions)
        .set({
          ...(values.title === undefined ? {} : { title: checkedTitle(values.title) }),
          ...(words === undefined ? {} : shippedWords(row, words, today)),
          ...settings,
          updatedAt: new Date(),
        })
        .where(eq(instructions.id, row.id))
        .returning()

      if (!updated) {
        throw new NotFoundException()
      }

      return instructionView(updated, today)
    })
  }

  /** Brings a shipped instruction back to the model, in whatever version applies. */
  @Post(':id/restore')
  @RequiresPermission('settings.write')
  restore(
    @CurrentIdentity() identity: RequestIdentity,
    @Param('id') id: string,
  ): Promise<InstructionView> {
    return this.database.forTenant(identity, async (tx) => {
      const row = await this.existing(tx, id)

      if (row.template === null) {
        throw new ConflictException(
          'Eine eigene Belehrung hat kein Original, auf das sie zurückgesetzt werden könnte.',
        )
      }

      const [restored] = await tx
        .update(instructions)
        .set({ body: null, basedOn: null, updatedAt: new Date() })
        .where(eq(instructions.id, row.id))
        .returning()

      if (!restored) {
        throw new NotFoundException()
      }

      return instructionView(restored, todayInGermany())
    })
  }

  /**
   * Gone for real, when the business wrote it. Every document that carried it
   * keeps its words in its snapshot. A shipped one stays; proposed for no
   * kind, it is not used.
   */
  @Delete(':id')
  @RequiresPermission('settings.write')
  async remove(@CurrentIdentity() identity: RequestIdentity, @Param('id') id: string) {
    return this.database.forTenant(identity, async (tx) => {
      const row = await this.existing(tx, id)

      if (row.template !== null) {
        throw new ConflictException(
          'Eine mitgelieferte Belehrung lässt sich nicht entfernen. Wer sie nicht mehr verwenden ' +
            'möchte, schlägt sie zu keinem Beleg mehr vor.',
        )
      }

      await tx.delete(instructions).where(eq(instructions.id, row.id))

      return { removed: row.id }
    })
  }
}
