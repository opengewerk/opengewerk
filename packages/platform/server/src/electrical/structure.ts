import {
  circuitFigureFields,
  circuitProblems,
  type ConflictReason,
  distributionBoardKinds,
  inverterProblems,
  type Operation,
  pvModuleProblems,
  pvStringProblems,
  type RecordState,
} from '@opengewerk/platform-domain'
import { and, eq, isNull } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'

import type { TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'

// What the sync of an application asks about the electrical and the PV
// structure before it writes a part (ADR 0014): the figures, and whether a
// circuit names a section of its own board.

/** The sections of an application (`electricalSchema`), as far as a check reads them. */
type Sections = PgTable & {
  readonly id: PgColumn
  readonly distributionBoardId: PgColumn
  readonly deletedAt: PgColumn
}

/** Why a part of the structure may not land where it says, in the shape of a sync conflict. */
export interface StructureRefusal {
  readonly reason: ConflictReason
  readonly fields: readonly string[]
}

/** The value a field has once the operation is through: what it sets, or what the row holds. */
export function valueAfter(
  field: string,
  values: Readonly<Record<string, unknown>>,
  current: RecordState | null,
): unknown {
  return field in values ? values[field] : (current?.[field] ?? null)
}

/**
 * The figures of the PV structure (#300), each a range of its own: the ones an
 * operation sets are the ones to judge, and one it leaves alone stands as the
 * database holds it.
 */
const pvFigures: Readonly<
  Record<string, (record: Readonly<Record<string, unknown>>) => Readonly<Record<string, string>>>
> = {
  inverters: inverterProblems,
  pv_strings: pvStringProblems,
  pv_modules: pvModuleProblems,
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
      : 'Diese Art von Verteiler ist unbekannt.'
  }

  const pv = pvFigures[entity]

  if (pv) {
    return Object.values(pv(values))[0] ?? null
  }

  if (entity !== 'circuits' || !circuitFigureFields.some((field) => field in values)) {
    return null
  }

  const standing = Object.fromEntries(
    circuitFigureFields.map((field) => [field, valueAfter(field, values, current)]),
  )

  return Object.values(circuitProblems(standing))[0] ?? null
}

/**
 * Whether the section a circuit names belongs to the board it hangs on.
 *
 * Whether the board and the section are there at all, in this tenant and not
 * marked as deleted, is the question every reference of every entity gets. This is the one the structure adds: a section of the
 * right business can still be a section of another board. The key over
 * section and board refuses that too, but inside the transaction, where it
 * would take every other operation of the transmission along; refused here,
 * it is a conflict about this one circuit. The sections are the table of the
 * application, made with `electricalSchema`.
 *
 * Asked when a circuit is created, and whenever an operation moves it to
 * another section or another board, since the pair is what has to fit.
 */
export async function sectionRefusal(
  sections: Sections,
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

  const section = valueAfter('boardSectionId', values, current)

  if (section === null) {
    return null
  }

  const [found] = isUuid(section)
    ? await tx
        .select({ board: sections.distributionBoardId })
        .from(sections)
        .where(and(eq(sections.id, section as never), isNull(sections.deletedAt)))
    : []

  return found && found.board === valueAfter('distributionBoardId', values, current)
    ? null
    : { reason: 'record_missing', fields: ['boardSectionId'] }
}
