import { type PriceBase, priceBases, quantityFactor } from '@opengewerk/domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, pgTable, text } from 'drizzle-orm/pg-core'

import { articles } from './articles.js'
import { documents } from './documents.js'
import { lineKind, lineUnit, vatRate } from './line-enums.js'

export { lineKind, lineUnit, vatRate } from './line-enums.js'

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
    documentId: reference<'document'>('document_id').notNull(),
    /** A position, or the title of the section after it. Titles carry no amount. */
    kind: lineKind('kind').notNull().default('item'),
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
    /** The price of `price_base` units. */
    unitPriceCents: integer('unit_price_cents').notNull(),
    /**
     * How many units the price is for (#456): one, ten, a hundred or a
     * thousand, as a wholesaler prices cable ties per 100 pieces. One for every
     * line written before, and what a device that does not know the column
     * leaves.
     */
    priceBase: integer('price_base').$type<PriceBase>().notNull().default(1),
    vatRate: vatRate('vat_rate').notNull().default('standard'),
    netCents: integer('net_cents').notNull(),
    /**
     * The article the line was taken from (#296), or null when it was typed.
     * A pointer and nothing more: text, unit and price are the line's own.
     */
    articleId: reference<'article'>('article_id'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'document_lines_document_in_tenant',
    }).onDelete('cascade'),
    index('document_lines_document_idx').on(table.tenantId, table.documentId, table.position),
    // An article is only marked as deleted, never removed, so nothing ever
    // has to happen to a line when its article goes.
    foreignKey({
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
      name: 'document_lines_article_in_tenant',
    }),
    index('document_lines_article_idx').on(table.tenantId, table.articleId),
    // The articles used lately (`articlesOnDevices`) are asked for at every
    // pull of every device. This keeps the question to the lines of the last
    // 90 days, not every line that ever took an article in the life of the
    // business.
    index('document_lines_recent_articles_idx')
      .on(table.tenantId, table.createdAt)
      .where(sql`${table.articleId} is not null and ${table.deletedAt} is null`),
    check('document_lines_position_positive', sql`${table.position} >= 1`),
    // A title is a heading and nothing else. With an amount on it, a total
    // would contain a figure nobody sees as a position.
    check(
      'document_lines_title_has_no_amount',
      sql`${table.kind} = 'item' or (${table.quantityMilli} = 0 and ${table.unitPriceCents} = 0)`,
    ),
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
        * round(abs(${table.quantityMilli}::numeric * ${table.unitPriceCents})
          / (${sql.raw(String(quantityFactor))} * ${table.priceBase}))`,
    ),
    // The four steps of `priceBases`, which the forms and the routes ask first.
    check(
      'document_lines_price_base_known',
      sql`${table.priceBase} in (${sql.raw(priceBases.join(', '))})`,
    ),
    // A lump sum is one of itself; "je 100 psch." would say nothing.
    check(
      'document_lines_lump_sum_per_one',
      sql`${table.unit} <> 'flat_rate' or ${table.priceBase} = 1`,
    ),
  ],
)
