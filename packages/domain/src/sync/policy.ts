import type { SyncValue } from './operation.js'

/**
 * What a device may do with an entity while it is offline.
 *
 * The rules are per entity and written out, not derived from something
 * generic. ADR 0005 insists on that, and the reason shows up immediately: a
 * customer and a report look identical to a generic mechanism and could not be
 * further apart in what may happen to them without a network.
 */
export interface SyncPolicy {
  /** Whether a device may create one of these without asking. */
  readonly create: boolean
  /**
   * `merge` lets a device change fields nobody else has touched. `never`
   * means changes to an existing record need a connection.
   */
  readonly change: 'never' | 'merge'
  /**
   * A change is only allowed while this field holds one of these values.
   * Leaving that state is what turns a record into something that is no longer
   * edited but corrected.
   */
  readonly onlyWhile?: {
    readonly field: string
    readonly values: readonly SyncValue[]
  }
}

/**
 * Master data. A technician on site adds a customer that is not in the system
 * yet, which happens, and that has to work without a network. Changing one
 * does not: an address corrected on two devices at once is a question for the
 * office, and the office has a connection.
 */
const masterData: SyncPolicy = { create: true, change: 'never' }

/**
 * What the work itself produces. Readings, equipment, the state of an
 * installation: this is the part that is recorded in a basement and merged
 * afterwards.
 */
const fieldWork: SyncPolicy = { create: true, change: 'merge' }

/**
 * The entities a device knows about, and what it may do with them.
 *
 * The keys are table names, the same ones the audit log writes, so that the
 * server can resolve them against its schema instead of keeping a second
 * mapping next to this one.
 *
 * Missing on purpose: the time entry, which ADR 0005 names for this phase.
 * Time recording is in phase 1 and the table does not exist; inventing it here
 * to satisfy a list would be worse than the gap. When it arrives it is
 * `fieldWork`, like everything else a technician fills in.
 */
export const syncPolicies: Readonly<Record<string, SyncPolicy>> = {
  customers: masterData,
  contacts: masterData,
  sites: masterData,
  installations: fieldWork,
  distribution_boards: fieldWork,
  board_sections: fieldWork,
  circuits: fieldWork,
  equipment: fieldWork,
  inverters: fieldWork,
  pv_strings: fieldWork,
  pv_modules: fieldWork,
  jobs: fieldWork,
  /**
   * A document may be written offline while it is a draft, and not one moment
   * longer. Issuing is not in this list at all: it hands out a number and
   * fixes the document, which happens on the server and only there. A device
   * without a network can prepare a document; it cannot turn one into
   * bookkeeping.
   */
  documents: { create: true, change: 'merge', onlyWhile: { field: 'status', values: ['draft'] } },
}

export const syncEntities = Object.keys(syncPolicies)

export function policyFor(entity: string): SyncPolicy | null {
  return syncPolicies[entity] ?? null
}
