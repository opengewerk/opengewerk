import type { SyncValue } from './operation.js'

/**
 * What a device may do with an entity while it is offline.
 *
 * The rules are per entity and written out, not derived from something
 * generic. ADR 0005 insists on that, and the reason shows up immediately:
 * master data and what a day's work produces look identical to a generic
 * mechanism and could not be further apart in what may happen to them without
 * a network.
 *
 * Which entities there are and which of these rules each one has is the
 * application's list (ADR 0010). The foundation knows what a rule means.
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
  /**
   * Fields only the server ever writes, whatever a device sends.
   *
   * Different from the columns the server keeps everywhere (id, version and
   * the like): those are bookkeeping a device has no opinion about. These are
   * fields a device very much has an opinion about and still may not set,
   * because setting them is an act that needs a connection, a right and a
   * counter.
   *
   * Listed per entity, because the same field name means different things on
   * different tables, and because a generic rule would either be too wide or
   * would have to be widened at the wrong moment.
   */
  readonly reserved?: readonly string[]
  /**
   * What a new record holds in its reserved fields before anything else
   * happens to it: the state every record of this kind starts in.
   *
   * The server has it from the column default and needs nothing here. A
   * device does. Until the server has answered, a record made on the device
   * exists only as its create operation, which by definition carries none of
   * the reserved fields, and a gate asking one of them finds nothing and
   * refuses. A record written in a cellar then turned down its own first
   * line as already fixed, and every change to its text with it.
   *
   * Written down here so that both ends read the same start. `syncRules`
   * refuses a list in which a gate on a reserved field has none, or in which
   * the start lies outside the gate.
   */
  readonly createdAs?: Readonly<Record<string, SyncValue>>
  /**
   * A gate that sits on another record, not on this one.
   *
   * A line of something that gets fixed is the case it exists for. Whether it
   * may be changed does not follow from anything on the line, it follows from
   * the state of the record the line belongs to: what has been fixed freezes
   * its lines with it, or fixing it is worth nothing.
   *
   * `onlyWhile` cannot say that, because it looks at the record's own fields.
   * Copying the parent's state onto the line would let it answer, and would
   * put the same fact in two places, where the copy is stale exactly at the
   * moment somebody fixes the parent.
   *
   * The server resolves the parent through `reference` and hands its state to
   * `decideMerge`. A device works out the same answer from the parent it
   * already holds, which is the point of the rule living here.
   */
  readonly gateFrom?: {
    /** The field on this record that names the parent. */
    readonly reference: string
    /** The parent's entity, so the server knows where to look. */
    readonly entity: string
    readonly field: string
    readonly values: readonly SyncValue[]
  }
}

/**
 * Columns a device never sets, whatever it sends.
 *
 * The first two say where a record belongs and are decided by the identity of
 * the request, never by its body. The rest are kept by a trigger, and a device
 * that wrote its own version number could make any change look like the newest
 * one there is.
 *
 * `deletedAt` is in the list although the server writes it from an operation
 * and not from a trigger. Deleting has its own kind of operation and a rule of
 * its own to pass; a device that sets the column as an ordinary field would
 * walk around that rule, and one that sets it back to null would undelete
 * something nobody restored.
 *
 * It sits here rather than in the server because both ends need it. The server
 * refuses a patch that names one of these; a device has to leave them out in
 * the first place, and it can only do that if it knows which they are. Two
 * copies of the list would agree until the day a column is added to one.
 */
export const keptByTheServer: readonly string[] = [
  'id',
  'tenantId',
  'createdAt',
  'updatedAt',
  'updatedBy',
  // Written by the same trigger as `updatedBy`, from the device of the
  // transaction; a value in a patch was overwritten anyway.
  'deviceId',
  'version',
  'changeSequence',
  'deletedAt',
]
