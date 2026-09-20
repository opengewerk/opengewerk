import { lineUnits, quantityFactor, vatRates } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import { check, index, integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { documents } from './documents.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

export const lineUnit = pgEnum('line_unit', lineUnits)
export const vatRate = pgEnum('vat_rate', vatRates)

/**
 * One position on a document.
 *
 * Three things about this table are the reason issue #54 existed at all, and
 * all three are about keeping a figure in one place.
 *
 * **The amounts live here and not on the document.** A total on the head would
 * be a second place for the same number, and two places drift. What the head
 * shows is worked out from these rows by `totalsFor`, with the document date,
 * so an invoice from 2020 is still an invoice at sixteen percent.
 *
 * **`net_cents` is stored and held by a check constraint.** Stored, because
 * quantity times price has to be rounded and the rounded figure is what the
 * customer was shown; held, because a stored figure that nothing checks is a
 * figure that goes wrong once and stays wrong. The constraint runs the same
 * arithmetic as `lineNetCents`, and a test measures the two against each other
 * rather than trusting that they agree.
 *
 * **The whole row is frozen with its document.** The trigger from 0002 covers
 * the head; without the one added in 0010 a line could still be changed after
 * the invoice was issued, which would hollow out the entire numbering.
 */
export const documentLines = pgTable(
  'document_lines',
  {
    id: primaryId<'document-line'>(),
    ...tenantColumn,
    documentId: reference<'document'>('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /**
     * Where the line stands, counted from one. Not unique, and on purpose: a
     * unique index would refuse the ordinary reordering of a list, which moves
     * several rows through positions another row still holds. What keeps the
     * order sane is that the whole list is written at once.
     */
    position: integer('position').notNull(),
    designation: text('designation').notNull(),
    description: text('description'),
    /** In thousandths, see `quantityFactor` in the domain. */
    quantityMilli: integer('quantity_milli').notNull(),
    unit: lineUnit('unit').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    vatRate: vatRate('vat_rate').notNull().default('standard'),
    netCents: integer('net_cents').notNull(),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('document_lines_document_idx').on(table.tenantId, table.documentId, table.position),
    check('document_lines_position_positive', sql`${table.position} >= 1`),
    /**
     * The same arithmetic as `lineNetCents`, in the one other place that can
     * enforce it.
     *
     * `numeric` and not the integers: PostgreSQL rounds a `numeric` half away
     * from zero and a `double precision` half to even, and only the first
     * matches what a merchant does and what the domain computes. The cast is
     * the whole difference between a constraint that agrees with the
     * application and one that disagrees with it on every second half cent.
     */
    check(
      'document_lines_net_matches_quantity',
      sql`${table.netCents} = sign(${table.quantityMilli}::numeric * ${table.unitPriceCents})
        * round(abs(${table.quantityMilli}::numeric * ${table.unitPriceCents}) / ${sql.raw(String(quantityFactor))})`,
    ),
  ],
)
