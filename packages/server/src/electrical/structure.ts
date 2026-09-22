import {
  circuitFigureFields,
  circuitProblems,
  type ConflictReason,
  distributionBoardKinds,
  type Operation,
  type RecordState,
} from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

import type { TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import {
  boardSections,
  circuits,
  distributionBoards,
  installations,
} from '../database/schema/index.js'

/** Why a part of the structure may not land where it says, in the shape of a sync conflict. */
export interface StructureRefusal {
  readonly reason: ConflictReason
  readonly fields: readonly string[]
}

/** The entities of the structure, each with the field that names its parent and where that is kept. */
const parents: Readonly<
  Record<
    string,
    {
      readonly field: string
      readonly table: PgTable
      readonly id: PgColumn
      readonly deletedAt: PgColumn
    }
  >
> = {
  distribution_boards: {
    field: 'installationId',
    table: installations,
    id: installations.id,
    deletedAt: installations.deletedAt,
  },
  board_sections: {
    field: 'distributionBoardId',
    table: distributionBoards,
    id: distributionBoards.id,
    deletedAt: distributionBoards.deletedAt,
  },
  circuits: {
    field: 'distributionBoardId',
    table: distributionBoards,
    id: distributionBoards.id,
    deletedAt: distributionBoards.deletedAt,
  },
  equipment: {
    field: 'circuitId',
    table: circuits,
    id: circuits.id,
    deletedAt: circuits.deletedAt,
  },
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
 * Whether the parent a part names is there, in this business, and not marked
 * as deleted, and for a circuit whether its section belongs to its board.
 *
 * The keys in the database hold all of it as well, and would refuse inside
 * the transaction, taking every other operation of the transmission along: a
 * circuit written in a cellar under a board the office removed in the meantime
 * would hold up the report behind it. Refused here, it is a conflict about
 * this one operation.
 *
 * The parent is looked up under row level security, so a parent of another
 * business is not there, which is the answer it deserves. A parent marked as
 * deleted is not there either: a key would accept it, the row exists, and the
 * circuit would hang on a board nobody sees any more.
 *
 * Asked when a part is created, and when an operation hangs it somewhere else.
 */
export async function structureRefusal(
  tx: TenantTransaction,
  operation: Operation,
  values: Readonly<Record<string, unknown>>,
  current: RecordState | null,
): Promise<StructureRefusal | null> {
  const parent = parents[operation.entity]

  if (!parent || operation.kind === 'delete') {
    return null
  }

  const creating = operation.kind === 'create'

  if (creating || parent.field in values) {
    const reference = after(parent.field, values, current)

    if (!isUuid(reference) || !(await exists(tx, parent, reference))) {
      return { reason: 'record_missing', fields: [parent.field] }
    }
  }

  if (
    operation.entity === 'circuits' &&
    (creating || 'boardSectionId' in values || 'distributionBoardId' in values)
  ) {
    const section = after('boardSectionId', values, current)

    if (section !== null) {
      const [found] = isUuid(section)
        ? await tx
            .select({ board: boardSections.distributionBoardId })
            .from(boardSections)
            .where(and(eq(boardSections.id, section as never), isNull(boardSections.deletedAt)))
        : []

      if (!found || found.board !== after('distributionBoardId', values, current)) {
        return { reason: 'record_missing', fields: ['boardSectionId'] }
      }
    }
  }

  return null
}

async function exists(
  tx: TenantTransaction,
  parent: { readonly table: PgTable; readonly id: PgColumn; readonly deletedAt: PgColumn },
  id: string,
): Promise<boolean> {
  const found = await tx
    .select({ id: parent.id })
    .from(parent.table)
    .where(and(eq(parent.id, id), isNull(parent.deletedAt)))

  return found.length > 0
}
