/**
 * Why an operation from a device could not be applied.
 *
 * The words of the mechanism, not of an application: which records travel and
 * under what rules is the application's list, what can go wrong with one of
 * them is the same everywhere. They are stored with every conflict, so the
 * list is also the enum of the database, and a new reason is a migration in
 * every application that carries the tables.
 */
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
  /** A field only the server writes, such as a number it hands out. */
  'set_by_server',
] as const

export type ConflictReason = (typeof conflictReasons)[number]
