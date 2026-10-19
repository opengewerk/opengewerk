import type { Operation, RecordState } from '@opengewerk/domain'
import {
  isUuid,
  type StructureRefusal,
  type TenantTransaction,
  valueAfter,
} from '@opengewerk/platform-server'
import { and, eq, isNull } from 'drizzle-orm'

import { installations, inverters } from '../database/schema/index.js'

// The checks of the structure itself, its figures and the section of a
// circuit, are the foundation's (`structureProblem`, `sectionRefusal`, ADR
// 0014). What stays is the link of an installation to its PV system, which
// the foundation knows nothing of.

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
  const system = valueAfter('pvSystemId', values, current)

  if (system === null) {
    return null
  }

  const [found] = isUuid(system)
    ? await tx
        .select({ kind: installations.kind, siteId: installations.siteId })
        .from(installations)
        .where(and(eq(installations.id, system as never), isNull(installations.deletedAt)))
    : []

  if (
    !found ||
    found.kind !== 'pv_system' ||
    found.siteId !== valueAfter('siteId', values, current)
  ) {
    return 'pvSystemId'
  }

  const inverter = valueAfter('inverterId', values, current)

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
