import { type BuildColumns, type BuildExtraConfigColumns } from 'drizzle-orm'
import {
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
} from 'drizzle-orm/pg-core'

// What the factories of the electrical and the PV structure (ADR 0014) share:
// an application gives every table columns and constraints of its own, the
// key of what the structure hangs on above all, like it does for the contacts
// and the stock.

/** Columns an application adds to a table of a building block; none may take a name the table has. */
export type OwnColumns = Record<string, PgColumnBuilderBase>

/**
 * A table of a building block with the columns of the application.
 *
 * Written out with the names drizzle gives its types, like the contacts:
 * left to itself, the compiler writes the columns of a table with columns of
 * the application's own into the declaration as a type nobody can use.
 */
export type TableWithOwn<
  Name extends string,
  Columns extends Record<string, PgColumnBuilderBase>,
  Own extends OwnColumns = Record<never, never>,
> = PgTableWithColumns<{
  name: Name
  schema: undefined
  columns: BuildColumns<Name, Columns & Own, 'pg'>
  dialect: 'pg'
}>

/** What an application says about a table of a building block: its own columns and their constraints. */
export interface OwnTable<Name extends string, Columns, Own extends OwnColumns> {
  readonly columns?: Own
  readonly constraints?: (
    table: BuildExtraConfigColumns<Name, Columns & Own, 'pg'>,
  ) => PgTableExtraConfigValue[]
}

/** The columns of the application, refused where one takes the name of a column the table has. */
export function ownColumnsOf<Own extends OwnColumns>(
  table: string,
  base: Readonly<Record<string, unknown>>,
  own: Own | undefined,
): Own {
  const columns = own ?? ({} as Own)
  const taken = Object.keys(columns).filter((name) => name in base)

  if (taken.length > 0) {
    throw new Error(`The ${table} have these columns already: ${taken.join(', ')}.`)
  }

  return columns
}
