import { foreignKey, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { referenceChecks, referencesOf } from './references.js'

// Two tables that belong to no application: a shelf, and a box on it. The
// mechanism reads the references off the foreign keys, so what it finds must
// not depend on anybody's list of tables.

const shelves = pgTable(
  'probe_shelves',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    label: text('label').notNull(),
  },
  (table) => [unique('probe_shelves_tenant_id_id').on(table.tenantId, table.id)],
)

const boxes = pgTable(
  'probe_boxes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    shelfId: uuid('shelf_id').notNull(),
    lentFromShelfId: uuid('lent_from_shelf_id'),
    // A key of another shape: it names a shelf without the tenant.
    sortedLikeShelfId: uuid('sorted_like_shelf_id'),
  },
  (table) => [
    foreignKey({
      name: 'probe_boxes_shelf',
      columns: [table.tenantId, table.shelfId],
      foreignColumns: [shelves.tenantId, shelves.id],
    }),
    foreignKey({
      name: 'probe_boxes_lent_from',
      columns: [table.tenantId, table.lentFromShelfId],
      foreignColumns: [shelves.tenantId, shelves.id],
    }),
    foreignKey({
      name: 'probe_boxes_sorted_like',
      columns: [table.sortedLikeShelfId],
      foreignColumns: [shelves.id],
    }),
  ],
)

describe('the references of a table', () => {
  it('are the foreign keys that run over the tenant onto tenant and id', () => {
    expect(
      referencesOf(boxes).map(({ field, target, required }) => ({
        field,
        target: target === shelves ? 'shelves' : 'another table',
        required,
      })),
    ).toEqual([
      { field: 'shelfId', target: 'shelves', required: true },
      { field: 'lentFromShelfId', target: 'shelves', required: false },
    ])
  })

  it('are none for a table that points at nothing', () => {
    expect(referencesOf(shelves)).toEqual([])
  })
})

describe('the sentence a missing reference is refused with', () => {
  const { missingReferenceText } = referenceChecks({
    called: { probe_shelves: 'Das Regal' },
    within: 'bei diesem Betreiber',
  })

  it('uses the words of the application: what the record is called, and where it was looked for', () => {
    expect(missingReferenceText({ field: 'shelfId', target: 'probe_shelves' })).toBe(
      'Das Regal aus shelfId gibt es bei diesem Betreiber nicht.',
    )
  })

  it('still says something for a table the application gave no name', () => {
    expect(missingReferenceText({ field: 'boxId', target: 'probe_boxes' })).toBe(
      'Den Datensatz aus boxId gibt es bei diesem Betreiber nicht.',
    )
  })
})
