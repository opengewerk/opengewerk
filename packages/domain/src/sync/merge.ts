import type { Operation, SyncValue } from './operation.js'
import { sameValue } from './operation.js'
import { policyFor } from './policy.js'

/** The record as it stands on the server, field by field, already flattened. */
export type RecordState = Readonly<Record<string, SyncValue>>

export const conflictReasons = [
  /** Somebody changed one of these fields while the device was away. */
  'changed_elsewhere',
  /** The record left the state in which offline changes are allowed. */
  'record_is_fixed',
  /** This kind of record is only changed with a connection. */
  'online_only',
  /** The record is not there, or not any more. */
  'record_missing',
  /** Nothing on this instance knows this entity. */
  'unknown_entity',
  /** A field only the server writes, such as the number on a document. */
  'set_by_server',
] as const

export type ConflictReason = (typeof conflictReasons)[number]

export type MergeResult =
  | { readonly outcome: 'apply'; readonly values: RecordState }
  | {
      readonly outcome: 'conflict'
      readonly reason: ConflictReason
      /** The fields it hangs on, empty when the whole record is the reason. */
      readonly fields: readonly string[]
    }
  | { readonly outcome: 'skip'; readonly reason: 'already_there' | 'nothing_to_do' }

function wanted(operation: Operation): RecordState {
  return Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to]))
}

/**
 * What the server does with one operation, given what it currently holds.
 *
 * All of it is decided here rather than in the server, and the reason is the
 * same one that keeps the model in this package: the device has to be able to
 * work out the same answer before it sends anything, so that it can show a
 * conflict rather than discover one. A rule that lives in the server can only
 * be asked over a network, which is the one thing that is missing.
 *
 * An operation applies whole or not at all. Two devices that edited different
 * fields of the same record both go through, which is the merge on field level
 * ADR 0005 asks for. As soon as one field really collides, nothing of that
 * operation lands and the whole intended change goes into the conflict, where
 * a person can see it side by side. Applying half of it would leave a record
 * that neither device ever meant.
 */
export function decideMerge(
  operation: Operation,
  current: RecordState | null,
  /**
   * The record this one hangs on, when the policy has a `gateFrom`. Null when
   * there is no parent to be found, which for a line means the document is
   * gone and the line has nothing left to belong to.
   */
  parent: RecordState | null = null,
): MergeResult {
  const policy = policyFor(operation.entity)

  if (!policy) {
    return { outcome: 'conflict', reason: 'unknown_entity', fields: [] }
  }

  const inherited = policy.gateFrom

  if (inherited) {
    // Before everything else, including creating. A line arriving for an
    // invoice that was issued in the meantime is refused whether it is new or
    // a change, because in both cases it would add something to bookkeeping
    // that is already closed.
    if (!parent) {
      return { outcome: 'conflict', reason: 'record_missing', fields: [inherited.reference] }
    }

    if (!inherited.values.some((value) => sameValue(parent[inherited.field], value))) {
      return { outcome: 'conflict', reason: 'record_is_fixed', fields: [inherited.field] }
    }
  }

  // Before everything else, and deliberately before the branch for creating.
  // A field the server reserves is refused whether the record already exists
  // or is arriving for the first time; the first time is the easier way in.
  //
  // A conflict and not an error, unlike the columns the server keeps
  // everywhere: a device that sets a document's status wanted something
  // sensible and may not have it. That belongs in front of a person, with
  // what the device intended still attached, and it has to be an answer the
  // device could have worked out itself before sending.
  const reserved = operation.patches
    .filter((patch) => policy.reserved?.includes(patch.field))
    .map((patch) => patch.field)

  if (reserved.length > 0) {
    return { outcome: 'conflict', reason: 'set_by_server', fields: reserved }
  }

  if (operation.kind === 'create') {
    // An entity a device only reads, such as the sources of a collective
    // invoice (#135): what the server makes, a device cannot make as well.
    if (!policy.create) {
      return { outcome: 'conflict', reason: 'online_only', fields: [] }
    }

    // The id came from the device before there was a network, so a record that
    // is already there under that id is this very operation, arriving twice.
    // The recorded operation ids catch the ordinary repeat; this catches the
    // half finished one, where the row landed and the receipt did not.
    return current
      ? { outcome: 'skip', reason: 'already_there' }
      : { outcome: 'apply', values: wanted(operation) }
  }

  if (!current) {
    return { outcome: 'conflict', reason: 'record_missing', fields: [] }
  }

  // Deleted counts as not there, and this is the half of `record_missing` that
  // could never be reached: nothing is ever removed for real, so a row is found
  // whatever state it is in. Without this, a change to a deleted record is
  // answered with "applied" and lands on a row no list will ever show again.
  //
  // It sits after the branch for creating on purpose. Creating has to keep
  // finding the deleted row, because that is what makes a repeated create a
  // `skip` instead of a primary key collision.
  if (!sameValue(current['deletedAt'], null)) {
    // Deleting something that is already deleted is not a disagreement, it is
    // a queue arriving twice. A conflict here would put an entry in front of a
    // person for every repeat of a transmission that did exactly what it said.
    return operation.kind === 'delete'
      ? { outcome: 'skip', reason: 'nothing_to_do' }
      : { outcome: 'conflict', reason: 'record_missing', fields: [] }
  }

  if (policy.change === 'never') {
    return { outcome: 'conflict', reason: 'online_only', fields: [] }
  }

  const gate = policy.onlyWhile

  if (gate && !gate.values.some((value) => sameValue(current[gate.field], value))) {
    return { outcome: 'conflict', reason: 'record_is_fixed', fields: [gate.field] }
  }

  if (operation.kind === 'delete') {
    // A delete carries no patches, so the field by field comparison below has
    // nothing to work on and the version is the only thing left to ask. It is
    // also the right question: deleting touches every field at once, so it
    // collides with any change somebody made in the meantime, and that is a
    // decision for a person and not for whoever sent last.
    //
    // Without a base version the device made no claim about the state it saw,
    // so there is nothing to contradict and the delete stands.
    if (operation.baseVersion !== null && !sameValue(operation.baseVersion, current['version'])) {
      return { outcome: 'conflict', reason: 'changed_elsewhere', fields: [] }
    }

    return { outcome: 'apply', values: {} }
  }

  // The shortcut. Nothing has happened to the record since the device read it,
  // so there is nothing to compare field by field.
  if (operation.baseVersion !== null && operation.baseVersion === current['version']) {
    return { outcome: 'apply', values: wanted(operation) }
  }

  const collided = operation.patches
    .filter((patch) => !sameValue(current[patch.field], patch.from))
    .map((patch) => patch.field)

  if (collided.length > 0) {
    return { outcome: 'conflict', reason: 'changed_elsewhere', fields: collided }
  }

  const changing = operation.patches.filter((patch) => !sameValue(patch.from, patch.to))

  if (changing.length === 0) {
    return { outcome: 'skip', reason: 'nothing_to_do' }
  }

  return { outcome: 'apply', values: wanted(operation) }
}
