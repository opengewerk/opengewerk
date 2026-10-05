import { type BuildColumns, type BuildExtraConfigColumns } from 'drizzle-orm'
import {
  type PgColumnBuilderBase,
  pgTable,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
  text,
} from 'drizzle-orm/pg-core'

import { primaryId, syncColumns, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/** The columns every table of contacts has, whatever its application hangs a contact on. */
function contactParts() {
  return {
    id: primaryId<'contact'>(),
    ...tenantColumn,
    givenName: text('given_name'),
    familyName: text('family_name').notNull(),
    // Free text, such as what somebody is at the place a contact hangs on.
    role: text('role'),
    email: text('email'),
    phone: text('phone'),
    ...timestamps,
    ...syncColumns,
  }
}

/** The columns every table of contacts has. */
export type ContactColumns = ReturnType<typeof contactParts>

/**
 * Columns an application adds to its contacts: the keys of what a contact
 * hangs on, and what follows from them. None may take the name of one the
 * table has; the schema refuses that when it is made.
 */
export type OwnContactColumns = Record<string, PgColumnBuilderBase>

/**
 * The contacts of an application with these columns of its own.
 *
 * Written out with the names drizzle gives its types, like the outbox and the
 * deadlines: left to itself, the compiler writes the columns of a table with
 * columns of the application's own into the declaration as a type nobody can
 * use.
 */
export type ContactsTable<Own extends OwnContactColumns = Record<never, never>> =
  PgTableWithColumns<{
    name: 'contacts'
    schema: undefined
    columns: BuildColumns<'contacts', ContactColumns & Own, 'pg'>
    dialect: 'pg'
  }>

/** The contacts, as an application exports them from its schema. */
export interface ContactsSchema<Own extends OwnContactColumns> {
  readonly contacts: ContactsTable<Own>
}

/** What an application says about its contacts. */
export interface ContactsOptions<Own extends OwnContactColumns> {
  /** Columns of the application, for what a contact hangs on. */
  readonly columns?: Own
  /** The keys, checks, indexes and policies of those columns. */
  readonly constraints?: (
    table: BuildExtraConfigColumns<'contacts', ContactColumns & Own, 'pg'>,
  ) => PgTableExtraConfigValue[]
}

/**
 * The people to talk to (opengewerk-haustechnik#85): the table, made by an
 * application with the columns for what a contact of its own hangs on.
 *
 * A contact is a name, what somebody is there, and how to reach them. It
 * travels to devices, so it carries the sync columns and is marked as deleted
 * and never removed: a row that is gone is a row a device that was offline
 * never hears about.
 *
 * **What a contact hangs on is the application's**: one keeps the people of
 * the records it works for, another those of the places it looks after. Each
 * such column is the application's, under a key over the tenant, so that a
 * contact cannot point into another tenant, and the application says in a
 * check that a contact hangs on exactly one of them (`contactRules` holds the
 * same rule in front of it, for a form, a route and the sync). So this is a
 * function and not a table, like the outbox and the deadlines.
 *
 * Called without columns it is the table as the building blocks of the
 * foundation know it, which is what an application holds its database
 * against.
 */
export function contactsSchema<Own extends OwnContactColumns = Record<never, never>>(
  options: ContactsOptions<Own> = {},
): ContactsSchema<Own> {
  const base = contactParts()
  const own = options.columns ?? ({} as Own)
  const taken = Object.keys(own).filter((name) => name in base)

  if (taken.length > 0) {
    throw new Error(`The contacts have these columns already: ${taken.join(', ')}.`)
  }

  const contacts = pgTable('contacts', { ...base, ...own } as ContactColumns & Own, (table) => [
    tenantIsolation(table.tenantId),
    ...(options.constraints?.(table) ?? []),
  ])

  return { contacts }
}

/** A contact as every table of contacts has it, whatever else its application keeps beside. */
export type ContactRow = ContactsTable['$inferSelect']
