import {
  type DocumentId,
  documentInstructions,
  type DocumentKind,
  type InstructionChoices,
  type InstructionContent,
  type InstructionGap,
  type InstructionTemplate,
  instructionTemplates,
  type IsoDate,
  type IssuerContent,
  latestWording,
  noInstructionChoices,
  onlyForGoods,
  requiredFrom,
  requiredKinds,
  shippedInstructionDefaults,
  type TenantId,
  wordingAt,
  wordingIsFixed,
} from '@opengewerk/domain'
import type { TenantTransaction } from '@opengewerk/platform-server'
import { asc, eq, sql } from 'drizzle-orm'

import { documentInstructionChoices, instructions } from '../database/schema/index.js'

export type InstructionRow = typeof instructions.$inferSelect

/**
 * Writes the shipped instructions a business does not have yet, with the
 * settings they start out with.
 *
 * Asked for every time the instructions are read, not once at setup. A
 * business set up before this version has none, and a later version may ship
 * one more; both get theirs the first time anybody looks, and nobody has to
 * remember a step. The unique index turns a second writer at the same moment
 * into a row that is already there, and a row that is already there is left
 * as the business set it.
 */
export async function ensureShippedInstructions(
  tx: TenantTransaction,
  tenantId: TenantId,
): Promise<void> {
  const rows = instructionTemplates.flatMap((template) => {
    const latest = latestWording(template)

    if (!latest) {
      return []
    }

    const defaults = shippedInstructionDefaults[template]

    return [
      {
        tenantId,
        template,
        title: latest.title,
        kinds: [...defaults.kinds],
        consumersOnly: defaults.consumersOnly,
        withDocument: defaults.withDocument,
        position: defaults.position,
      },
    ]
  })

  await tx
    .insert(instructions)
    .values(rows)
    .onConflictDoNothing({
      target: [instructions.tenantId, instructions.template],
      where: sql`${instructions.template} is not null`,
    })
}

/** The instructions of a business, in the order they are listed and printed. */
export async function instructionsOf(tx: TenantTransaction): Promise<readonly InstructionRow[]> {
  return tx
    .select()
    .from(instructions)
    .orderBy(asc(instructions.position), asc(instructions.createdAt), asc(instructions.id))
}

/** A version of a shipped model, as the screen shows it. */
export interface ModelView {
  readonly validFrom: IsoDate
  readonly source: string
}

/** An instruction as the settings screen shows it. */
export interface InstructionView {
  readonly id: string
  readonly template: InstructionTemplate | null
  readonly title: string
  /**
   * The words as they stand today, placeholders and all: the business's own,
   * or for a shipped one nobody changed the model in force today.
   */
  readonly body: string
  /** A shipped instruction whose words the business changed. */
  readonly changed: boolean
  /**
   * The model in force today, with its words, for a shipped instruction.
   * What restoring brings back, and what a changed wording is measured
   * against.
   */
  readonly model: (ModelView & { readonly text: string }) | null
  /**
   * A version of the model newer than the one a changed wording came from.
   * The update that brought it did not touch the business's words, and the
   * screen says so instead.
   */
  readonly newerModel: ModelView | null
  readonly kinds: readonly DocumentKind[]
  /**
   * The kinds it always goes with when the customer is not a business: the
   * quote, for the two models. The screen keeps them ticked.
   */
  readonly requiredWith: readonly DocumentKind[]
  readonly consumersOnly: boolean
  readonly withDocument: boolean
  readonly position: number
  /**
   * The page printed instead of the words, by the name of its file, for the
   * screen to show; null for an instruction printed as text (#431).
   */
  readonly graphic: string | null
  /** Words the law prescribes whole: nothing on the screen changes them. */
  readonly fixedWording: boolean
  /** Only for a contract about goods, "Lieferung von Waren mit Montage" on a document. */
  readonly onlyForGoods: boolean
  /** The day the law asks for it from, where that came after its first documents. */
  readonly requiredFrom: IsoDate | null
}

/**
 * The heading an instruction is shown under: its own for one the business
 * wrote, the one of its model today for a shipped one. The heading in the
 * row of a shipped one is the one it was written with, and a later version
 * of the package may have renamed it; the document prints the package's.
 */
export function shownTitle(row: Pick<InstructionRow, 'template' | 'title'>, today: IsoDate) {
  return row.template === null ? row.title : (wordingAt(row.template, today)?.title ?? row.title)
}

export function instructionView(row: InstructionRow, today: IsoDate): InstructionView {
  // One whose first version is still to come shows that version, so that the
  // screen has something to show before the day it applies from.
  const upcoming = row.template === null ? null : latestWording(row.template)
  const model =
    row.template === null
      ? null
      : (wordingAt(row.template, today) ??
        (upcoming && upcoming.validFrom > today ? upcoming : null))
  const changed = row.template !== null && row.body !== null
  const latest = changed && row.template !== null ? latestWording(row.template) : null

  return {
    id: row.id,
    template: row.template,
    title: shownTitle(row, today),
    body: row.body ?? model?.text ?? '',
    changed,
    model: model ? { validFrom: model.validFrom, source: model.source, text: model.text } : null,
    newerModel:
      latest && (row.basedOn === null || latest.validFrom > row.basedOn)
        ? { validFrom: latest.validFrom, source: latest.source }
        : null,
    kinds: row.kinds,
    requiredWith: requiredKinds(row.template),
    consumersOnly: row.consumersOnly,
    withDocument: row.withDocument,
    position: row.position,
    graphic: model?.graphic ?? null,
    fixedWording: wordingIsFixed(row.template),
    onlyForGoods: row.template !== null && onlyForGoods.includes(row.template),
    requiredFrom: row.template === null ? null : (requiredFrom[row.template] ?? null),
  }
}

/** What the office chose on a document, or the proposal as a contract about work. */
export async function choicesOf(
  tx: TenantTransaction,
  documentId: DocumentId,
): Promise<InstructionChoices> {
  const [row] = await tx
    .select({
      variant: documentInstructionChoices.variant,
      switchedOn: documentInstructionChoices.switchedOn,
      switchedOff: documentInstructionChoices.switchedOff,
    })
    .from(documentInstructionChoices)
    .where(eq(documentInstructionChoices.documentId, documentId))

  return row ?? noInstructionChoices
}

/**
 * The instructions of a document the way it goes out, and what is missing for
 * them: the business's instructions, the choices on the document and the
 * letterhead, put together by `documentInstructions` in `domain`.
 *
 * Writes the shipped instructions first when the business has none yet, so
 * that its first quote to a consumer gets the instruction on withdrawal
 * whether or not anybody opened the settings before.
 */
export async function instructionsFor(
  tx: TenantTransaction,
  document: {
    readonly id: DocumentId
    readonly tenantId: TenantId
    readonly kind: DocumentKind
    readonly documentDate: IsoDate
  },
  issuer: IssuerContent,
  recipientIsBusiness: boolean,
): Promise<{
  readonly contents: readonly InstructionContent[]
  readonly gaps: readonly InstructionGap[]
}> {
  await ensureShippedInstructions(tx, document.tenantId)

  return documentInstructions(
    await instructionsOf(tx),
    await choicesOf(tx, document.id),
    { kind: document.kind, documentDate: document.documentDate, recipientIsBusiness },
    issuer,
  )
}
