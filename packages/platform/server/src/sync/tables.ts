import {
  jsonText,
  type RecordState,
  type SyncValue,
  toSyncValue,
} from '@opengewerk/platform-domain'
import { getTableColumns, getTableName, is } from 'drizzle-orm'
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

/**
 * Whether a column holds JSON or a list.
 *
 * Such a value travels as its text, the one `jsonText` writes: the server
 * sends it so, a device keeps it and patches it so, and the server takes the
 * value back out of the text on the way into the column (`forColumn`).
 */
export function carriesJson(column: PgColumn): boolean {
  return column.dataType === 'json' || column.dataType === 'array'
}

/** The row as the merge sees it: flat, and in the shape a patch can compare. */
export function toRecordState(table: PgTable, row: Readonly<Record<string, unknown>>): RecordState {
  const columns = getTableColumns(table) as Record<string, PgColumn>

  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => {
      const column = columns[field]

      return [field, column && carriesJson(column) ? asText(value) : toSyncValue(value)]
    }),
  )
}

/**
 * The rows of a pull as a device keeps them: a value of JSON or a list as its
 * text, everything else as it is, which is what JSON makes of it on the way.
 *
 * A device holds what the server sent and builds the `from` of its next patch
 * out of it. Sent as an object, a value of JSON came back as an object in a
 * patch, which no patch carries, and a pending change to it, which is text,
 * lay over an object on the screen.
 */
export function travellingRows(
  table: PgTable,
  rows: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const json = Object.entries(getTableColumns(table) as Record<string, PgColumn>)
    .filter(([, column]) => carriesJson(column))
    .map(([field]) => field)

  if (json.length === 0) {
    return [...rows]
  }

  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      json.filter((field) => field in row).map((field) => [field, asText(row[field])]),
    ),
  }))
}

/**
 * What a patch brings for a column of JSON or a list, in the text `jsonText`
 * writes, or undefined when it is not such a text: a number or a flag, a text
 * that is not JSON, or for a column of a list one that is not a list. Null
 * stays null, and so does the text of null, which is what the column makes of
 * it.
 *
 * Two texts of one value need not be one text: keys in another order, a space.
 * Read back into one form, the merge compares what a value is and not how a
 * device happened to write it.
 */
export function inJsonText(column: PgColumn, value: SyncValue): SyncValue | undefined {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    return undefined
  }

  let read: unknown

  try {
    read = JSON.parse(value) as unknown
  } catch {
    return undefined
  }

  if (column.dataType === 'array' && read !== null && !Array.isArray(read)) {
    return undefined
  }

  return asText(read)
}

/**
 * Back into whatever the column wants. A timestamp travels as text and has to
 * be a date again before it goes in, and a value of JSON or a list is read out
 * of its text; everything else is already what it needs to be.
 */
export function forColumn(column: PgColumn, value: SyncValue): unknown {
  if (value === null) {
    return null
  }

  if (column.dataType === 'date') {
    return new Date(String(value))
  }

  return carriesJson(column) ? (JSON.parse(String(value)) as unknown) : value
}

function asText(value: unknown): SyncValue {
  return value === null || value === undefined ? null : jsonText(value)
}
