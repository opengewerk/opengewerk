import {
  circuitFigureFields,
  circuitProblems,
  type ConflictReason,
  distributionBoardKinds,
  type Operation,
  type RecordState,
} from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import { boardSections } from '../database/schema/index.js'

/** Why a part of the structure may not land where it says, in the shape of a sync conflict. */
export interface StructureRefusal {
  readonly reason: ConflictReason
  readonly fields: readonly string[]
}

/** The value a field has once the operation is through: what it sets, or what the row holds. */
function after(
  field: string,
  values: Readonly<Record<string, unknown>>,
  current: RecordState | null,
): unknown {
  return field in values ? values[field] : (current?.[field] ?? null)
}

/**
 * What a device may not send at all, as the sentence its form shows for it,
 * or null when nothing is wrong.
 *
 * A mistake in the client and not a disagreement between two people, like a
 * payment term out of range: the forms ask the same function before anything
 * is queued. Asked here, the answer names the field; left to the database,
 * the check or the enum would refuse the whole transmission with a sentence
 * nobody on site could act on.
 *
 * The circuit is judged as it would stand afterwards, since whether a curve
 * goes with a device depends on both and a patch may carry only one. Only
 * when the operation sets one of its figures: a circuit that is only renamed
 * is not held to a figure nobody touched.
 */
export function structureProblem(
  entity: string,
  values: Readonly<Record<string, unknown>>,
  current: RecordState | null,
): string | null {
  if (entity === 'distribution_boards' && 'kind' in values) {
    return (distributionBoardKinds as readonly unknown[]).includes(values['kind'])
      ? null
      : 'Diese Art von Verteiler kennt OpenGewerk nicht.'
  }

  if (entity !== 'circuits' || !circuitFigureFields.some((field) => field in values)) {
    return null
  }

  const standing = Object.fromEntries(
    circuitFigureFields.map((field) => [field, after(field, values, current)]),
  )

  return Object.values(circuitProblems(standing))[0] ?? null
}

/**
 * Whether the section a circuit names belongs to the board it hangs on.
 *
 * Whether the board and the section are there at all, in this business and not
 * marked as deleted, is the question every reference of every entity gets, in
 * `missingReference`. This is the one the structure adds: a section of the
 * right business can still be a section of another board. The key over
 * section and board refuses that too, but inside the transaction, where it
 * would take every other operation of the transmission along; refused here,
 * it is a conflict about this one circuit.
 *
 * Asked when a circuit is created, and whenever an operation moves it to
 * another section or another board, since the pair is what has to fit.
 */
export async function sectionRefusal(
  tx: TenantTransaction,
  operation: Operation,
  values: Readonly<Record<string, unknown>>,
  current: RecordState | null,
): Promise<StructureRefusal | null> {
  if (
    operation.entity !== 'circuits' ||
    operation.kind === 'delete' ||
    (operation.kind !== 'create' &&
      !('boardSectionId' in values) &&
      !('distributionBoardId' in values))
  ) {
    return null
  }

  const section = after('boardSectionId', values, current)

  if (section === null) {
    return null
  }

  const [found] = isUuid(section)
    ? await tx
        .select({ board: boardSections.distributionBoardId })
        .from(boardSections)
        .where(and(eq(boardSections.id, section as never), isNull(boardSections.deletedAt)))
    : []

  return found && found.board === after('distributionBoardId', values, current)
    ? null
    : { reason: 'record_missing', fields: ['boardSectionId'] }
}
