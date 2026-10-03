import { syncRules } from '@opengewerk/platform-domain'
import { probePolicies } from '@opengewerk/platform-domain/testing'
import { sql } from 'drizzle-orm'
import { boolean, foreignKey, integer, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from '../database/schema/columns.js'
import { tenantIsolation } from '../database/schema/rls.js'
import { tenantColumn } from '../database/schema/tenants.js'
import { probeMade } from '../database/probe-schema.js'
import type { MadeByTheApplication, TableGuard } from '../migration/guards.js'

// Records of the probe application that travel to devices, for the tests of
// the sync on the server. Named the way the probe policies name them, which is
// how a table is found for an entity, and kept by no application of the
// organisation: a test that passed with the tables of a real one would not show
// that the mechanism knows none of them.

/** Master data: made on a device, corrected only with a connection. A shelf can be closed for new notes. */
export const shelves = pgTable(
  'shelves',
  {
    id: primaryId<'shelf'>(),
    ...tenantColumn,
    label: text('label').notNull(),
    closed: boolean('closed').notNull().default(false),
    ...syncColumns,
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('shelves_tenant_id_id').on(table.tenantId, table.id),
  ],
)

/** What work produces: made and changed on a device, field by field. */
export const notes = pgTable(
  'notes',
  {
    id: primaryId<'note'>(),
    ...tenantColumn,
    shelfId: reference<'shelf'>('shelf_id'),
    text: text('text').notNull(),
    ...syncColumns,
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      name: 'notes_shelf',
      columns: [table.tenantId, table.shelfId],
      foreignColumns: [shelves.tenantId, shelves.id],
    }),
  ],
)

/** Written while a draft and not after; the state is the server's. */
export const letters = pgTable(
  'letters',
  {
    id: primaryId<'letter'>(),
    ...tenantColumn,
    subject: text('subject').notNull(),
    status: text('status').notNull().default('draft'),
    ...syncColumns,
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('letters_tenant_id_id').on(table.tenantId, table.id),
  ],
)

/** Lines of a letter: the gate sits on the letter, and the total is the server's. */
export const letterLines = pgTable(
  'letter_lines',
  {
    id: primaryId<'letter-line'>(),
    ...tenantColumn,
    letterId: reference<'letter'>('letter_id').notNull(),
    quantity: integer('quantity').notNull().default(1),
    price: integer('price').notNull().default(0),
    total: integer('total').notNull().default(0),
    ...syncColumns,
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      name: 'letter_lines_letter',
      columns: [table.tenantId, table.letterId],
      foreignColumns: [letters.tenantId, letters.id],
    }),
  ],
)

/** The rules of the probe application, as an application makes them. */
export const probeSyncRules = syncRules(probePolicies)

const travelling = (table: string): TableGuard => ({
  table,
  // Marked as deleted, never removed: no `delete`.
  grants: ['select', 'insert', 'update'],
  audited: true,
  synced: true,
})

/** The tables above, with what the probe application already makes. */
export const probeSyncMade: MadeByTheApplication = {
  schema: { ...probeMade.schema, shelves, notes, letters, letterLines },
  guards: [
    ...probeMade.guards,
    travelling('shelves'),
    travelling('notes'),
    travelling('letters'),
    travelling('letter_lines'),
  ],
}

/** A condition no row meets, for a device that may hold none of an entity. */
export const nothing = sql`false`
