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
} from '@opengewerk/domain'
import { and, eq, isNull } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import { boardSections, installations, inverters } from '../database/schema/index.js'

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
      : 'Diese Art von Verteiler kennt OpenGewerk nicht.'
  }

  const pv = pvFigures[entity]

  if (pv) {
    return Object.values(pv(values))[0] ?? null
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

/** Where an installation's link to a PV system does not hold, the field to name. */
export type PvLinkMisfit = 'pvSystemId' | 'inverterId'

/**
 * Whether the PV system an installation names is one, at the installation's
 * own site, and the inverter it names one of that system (#300), judged on
 * the installation as it would stand afterwards.
 *
 * Whether both are there at all, in this business and not marked as deleted,
 * `missingReference` asks for every reference. This is what the PV structure
 * adds, and what the trigger in the database holds as well; which kinds may
 * name a system at all is a rule over the record's own fields and asked with
 * the others (`record-rules.ts`).
 */
export async function pvLinkMisfit(
  tx: TenantTransaction,
  values: Readonly<Record<string, unknown>>,
  current: RecordState | null,
): Promise<PvLinkMisfit | null> {
  const system = after('pvSystemId', values, current)

  if (system === null) {
    return null
  }

  const [found] = isUuid(system)
    ? await tx
        .select({ kind: installations.kind, siteId: installations.siteId })
        .from(installations)
        .where(and(eq(installations.id, system as never), isNull(installations.deletedAt)))
    : []

  if (!found || found.kind !== 'pv_system' || found.siteId !== after('siteId', values, current)) {
    return 'pvSystemId'
  }

  const inverter = after('inverterId', values, current)

  if (inverter === null) {
    return null
  }

  const [hanging] = isUuid(inverter)
    ? await tx
        .select({ installationId: inverters.installationId })
        .from(inverters)
        .where(and(eq(inverters.id, inverter as never), isNull(inverters.deletedAt)))
    : []

  return hanging?.installationId === system ? null : 'inverterId'
}

/**
 * The same question in the shape of a sync conflict, about this one
 * installation: a battery linked on one device to a system that another
 * turned into something else, or moved to another site meanwhile. Left to the
 * trigger, it would take every other operation of the transmission along.
 *
 * Asked when an installation is created, and whenever an operation changes
 * one of the fields the link depends on: the link itself, the site, the kind.
 */
export async function pvLinkRefusal(
  tx: TenantTransaction,
  operation: Operation,
  values: Readonly<Record<string, unknown>>,
  current: RecordState | null,
): Promise<StructureRefusal | null> {
  if (
    operation.entity !== 'installations' ||
    operation.kind === 'delete' ||
    (operation.kind !== 'create' &&
      !['pvSystemId', 'inverterId', 'siteId', 'kind'].some((field) => field in values))
  ) {
    return null
  }

  const misfit = await pvLinkMisfit(tx, values, current)

  return misfit === null ? null : { reason: 'record_missing', fields: [misfit] }
}
