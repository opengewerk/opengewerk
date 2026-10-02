import { and, eq, getTableColumns, getTableName, isNull, type SQL } from 'drizzle-orm'
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core'

import type { TenantTransaction } from './database.js'
import { isUuid } from './identifier.js'

/**
 * One field of a table that names a record of the same tenant: the field, and
 * the table the record is kept in.
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
 * own tenant. A list kept by hand would agree with the schema until the next
 * table, and forgetting it there would look exactly like a reference nobody
 * needed to check.
 *
 * A key of another shape falls outside on purpose: one that points at a
 * member by user and not by id, one that pairs two parents and carries no
 * tenant, one that names a file by its hash. Whoever builds such a key asks
 * the question that goes with it in a check of its own.
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

/** A reference that names nothing this tenant may hang a record on. */
export interface MissingReference {
  readonly field: string
  /** The table it points into, by its name in the database. */
  readonly target: string
}

/**
 * What an application says about its own tables: the two lists the check
 * cannot read off a schema, and the words of the sentence it refuses with.
 */
export interface ReferenceWords {
  /**
   * The references that may name a record marked as deleted, per table and by
   * field. For a trace of what happened: it has to arrive even when the
   * record it is about was deleted before the next exchange. The key holds,
   * since a deleted row stays.
   */
  readonly mayNameDeleted?: Readonly<Record<string, readonly string[]>>
  /** What a record of each table is called in a sentence, with its article. */
  readonly called: Readonly<Record<string, string>>
  /** How the sentence names the tenant it did not find the record in. */
  readonly within: string
}

/** The check and its sentence, bound to the words of one application. */
export interface ReferenceChecks {
  /**
   * The first reference among these values that names no record of this
   * tenant, or null when every one of them does.
   *
   * Only the references the values set: a change that leaves a parent alone
   * is not held to a parent somebody else deleted in the meantime. An empty
   * one passes where the column may be empty. A new record that leaves out a
   * parent it must have is missing that parent, which in the sync is a
   * conflict about one operation and not a column refused for the whole
   * transmission.
   *
   * Asked under row level security, so a record of another tenant is not
   * there, which is the answer it deserves. A record marked as deleted is not
   * there either: the key would take it, the row exists, and the new record
   * would hang on something no list shows any more. Only a trace of what
   * happened may, in `mayNameDeleted`.
   */
  missingReference(
    tx: TenantTransaction,
    table: PgTable,
    values: Readonly<Record<string, unknown>>,
    creating: boolean,
  ): Promise<MissingReference | null>
  /** The sentence a route refuses a missing reference with. */
  missingReferenceText(missing: MissingReference): string
}

export function referenceChecks(words: ReferenceWords): ReferenceChecks {
  const mayNameDeleted = words.mayNameDeleted ?? {}

  return {
    async missingReference(tx, table, values, creating) {
      const deletedToo = mayNameDeleted[getTableName(table)] ?? []

      for (const { field, target, required } of referencesOf(table)) {
        const value = values[field]

        if (value === null || value === undefined) {
          if (creating && required) {
            return { field, target: getTableName(target) }
          }

          continue
        }

        if (!isUuid(value) || !(await exists(tx, target, value, deletedToo.includes(field)))) {
          return { field, target: getTableName(target) }
        }
      }

      return null
    },

    missingReferenceText(missing) {
      const record = words.called[missing.target] ?? 'Den Datensatz'

      return `${record} aus ${missing.field} gibt es ${words.within} nicht.`
    },
  }
}

async function exists(
  tx: TenantTransaction,
  target: PgTable,
  id: string,
  deletedToo: boolean,
): Promise<boolean> {
  const columns = getTableColumns(target) as Record<string, PgColumn>
  const key = columns['id']
  const deletedAt = columns['deletedAt']

  if (!key) {
    throw new Error(`The table ${getTableName(target)} has no id to find a record by`)
  }

  const condition: SQL | undefined =
    deletedAt && !deletedToo ? and(eq(key, id), isNull(deletedAt)) : eq(key, id)
  const found = await tx.select({ id: key }).from(target).where(condition)

  return found.length > 0
}
