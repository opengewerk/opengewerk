import { and, eq, getTableColumns, getTableName, isNull, type SQL } from 'drizzle-orm'
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core'

import type { TenantTransaction } from './database.js'
import { isUuid } from './identifier.js'

/**
 * One field of a table that names a record of the same business: the field,
 * and the table the record is kept in.
 */
export interface Reference {
  readonly field: string
  readonly target: PgTable
  /** Whether the column may be empty. A record that must have a parent and names none has none. */
  readonly required: boolean
}

const known = new Map<PgTable, readonly Reference[]>()

/**
 * The references of a table, read off its foreign keys rather than listed
 * beside them.
 *
 * Only the keys that run over the tenant and one more column, onto tenant and
 * id of another table: exactly the ones that tie a record to a parent of its
 * own business, since 0030 and 0031 every one of them. A list kept by hand
 * would agree with the schema until the next table, and forgetting it there
 * would look exactly like a reference nobody needed to check.
 *
 * Two keys fall outside on purpose. The person of a task points at the
 * membership by user and not by id, and `assigneeRefusal` asks the question
 * that goes with it, whether that person may still be given work. The key
 * from a circuit to its section pairs the section with the board and carries
 * no tenant; the board's own key holds the business, and the section's check
 * lives with the structure.
 */
export function referencesOf(table: PgTable): readonly Reference[] {
  const cached = known.get(table)

  if (cached) {
    return cached
  }

  const fields = new Map(
    Object.entries(getTableColumns(table) as Record<string, PgColumn>).map(([field, column]) => [
      column.name,
      field,
    ]),
  )
  const references: Reference[] = []

  for (const key of getTableConfig(table).foreignKeys) {
    const { columns, foreignColumns, foreignTable } = key.reference()
    const [tenant, pointer] = columns
    const [foreignTenant, foreignId] = foreignColumns
    const field = pointer ? fields.get(pointer.name) : undefined

    if (
      columns.length === 2 &&
      tenant?.name === 'tenant_id' &&
      foreignTenant?.name === 'tenant_id' &&
      foreignId?.name === 'id' &&
      pointer &&
      field !== undefined
    ) {
      references.push({ field, target: foreignTable, required: pointer.notNull })
    }
  }

  known.set(table, references)

  return references
}

/** A reference that names nothing this business may hang a record on. */
export interface MissingReference {
  readonly field: string
  /** The table it points into, `customers`, `sites`. */
  readonly target: string
}

/**
 * The first reference among these values that names no record of this
 * business, or null when every one of them does.
 *
 * Only the references the values set: a change that leaves a customer alone
 * is not held to a customer somebody else deleted in the meantime. An empty
 * one passes where the column may be empty. A new record that leaves out a
 * parent it must have is missing that parent, which in the sync is a conflict
 * about one operation and not a column refused for the whole transmission.
 *
 * Asked under row level security, so a record of another business is not
 * there, which is the answer it deserves. A record marked as deleted is not
 * there either: the key would take it, the row exists, and the new record
 * would hang on something no list shows any more.
 */
export async function missingReference(
  tx: TenantTransaction,
  table: PgTable,
  values: Readonly<Record<string, unknown>>,
  creating: boolean,
): Promise<MissingReference | null> {
  for (const { field, target, required } of referencesOf(table)) {
    const value = values[field]

    if (value === null || value === undefined) {
      if (creating && required) {
        return { field, target: getTableName(target) }
      }

      continue
    }

    if (!isUuid(value) || !(await exists(tx, target, value))) {
      return { field, target: getTableName(target) }
    }
  }

  return null
}

async function exists(tx: TenantTransaction, target: PgTable, id: string): Promise<boolean> {
  const columns = getTableColumns(target) as Record<string, PgColumn>
  const key = columns['id']
  const deletedAt = columns['deletedAt']

  if (!key) {
    throw new Error(`The table ${getTableName(target)} has no id to find a record by`)
  }

  const condition: SQL | undefined = deletedAt ? and(eq(key, id), isNull(deletedAt)) : eq(key, id)
  const found = await tx.select({ id: key }).from(target).where(condition)

  return found.length > 0
}

/** What a record of each table is called in a sentence, with its article. */
const called: Readonly<Record<string, string>> = {
  customers: 'Den Kunden',
  sites: 'Das Objekt',
  installations: 'Die Anlage',
  jobs: 'Den Auftrag',
  documents: 'Den Beleg',
  files: 'Die Datei',
  invitations: 'Die Einladung',
  tasks: 'Die Aufgabe',
  inverters: 'Den Wechselrichter',
  pv_strings: 'Den String',
  distribution_boards: 'Den Verteiler',
  board_sections: 'Das Feld',
  circuits: 'Den Stromkreis',
}

/** The sentence a route refuses a missing reference with: "Den Kunden aus customerId gibt es in diesem Betrieb nicht." */
export function missingReferenceText(missing: MissingReference): string {
  return `${called[missing.target] ?? 'Den Datensatz'} aus ${missing.field} gibt es in diesem Betrieb nicht.`
}
