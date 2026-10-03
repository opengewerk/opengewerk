import { type RecordState, type SyncValue, toSyncValue } from '@opengewerk/platform-domain'
import { getTableName, is } from 'drizzle-orm'
import { type PgColumn, PgTable } from 'drizzle-orm/pg-core'

/**
 * The tables of a schema module by name, the names a device talks about.
 *
 * Asked of the schema module rather than kept as a map beside it. A map would
 * be one more place to remember on the next table, and forgetting it would
 * look exactly like an entity nobody wanted to sync. Whether a table travels
 * at all is said elsewhere: by the policies of the application for what a
 * device may send, and by the sync columns for what it is sent.
 */
export function syncTables(
  schema: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, PgTable> {
  return new Map(
    (Object.values(schema) as unknown[])
      .filter((candidate): candidate is PgTable => is(candidate, PgTable))
      .map((table) => [getTableName(table), table] as const),
  )
}

/** The row as the merge sees it: flat, and in the shape a patch can compare. */
export function toRecordState(row: Readonly<Record<string, unknown>>): RecordState {
  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => [field, toSyncValue(value)]),
  )
}

/**
 * Back into whatever the column wants. A timestamp travels as text and has to
 * be a date again before it goes in; everything else is already what it needs
 * to be.
 */
export function forColumn(column: PgColumn, value: SyncValue): unknown {
  if (value === null) {
    return null
  }

  return column.dataType === 'date' ? new Date(String(value)) : value
}
