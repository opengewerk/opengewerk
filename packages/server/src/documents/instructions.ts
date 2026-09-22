import {
  type DocumentKind,
  type InstructionTemplate,
  instructionTemplates,
  type IsoDate,
  latestWording,
  shippedInstructionDefaults,
  type TenantId,
  wordingAt,
} from '@opengewerk/domain'
import { asc, sql } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { instructions } from '../database/schema/index.js'

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
  readonly consumersOnly: boolean
  readonly withDocument: boolean
  readonly position: number
}

export function instructionView(row: InstructionRow, today: IsoDate): InstructionView {
  const model = row.template === null ? null : wordingAt(row.template, today)
  const changed = row.template !== null && row.body !== null
  const latest = changed && row.template !== null ? latestWording(row.template) : null

  return {
    id: row.id,
    template: row.template,
    title: row.title,
    body: row.body ?? model?.text ?? '',
    changed,
    model: model ? { validFrom: model.validFrom, source: model.source, text: model.text } : null,
    newerModel:
      latest && (row.basedOn === null || latest.validFrom > row.basedOn)
        ? { validFrom: latest.validFrom, source: latest.source }
        : null,
    kinds: row.kinds,
    consumersOnly: row.consumersOnly,
    withDocument: row.withDocument,
    position: row.position,
  }
}
