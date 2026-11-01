import {
  articleLimits,
  durabilityLimits,
  lineUnits,
  storeLimits,
  supplierLimits,
} from '@opengewerk/domain'
import { reference, stockSchema } from '@opengewerk/platform-server'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  type PgTableExtraConfigValue,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { articleImports } from './article-imports.js'
import { documentLines } from './document-lines.js'
import { jobs } from './jobs.js'

/**
 * Articles, suppliers and the stores of the business, made with the factory
 * of the foundation (ADR 0011, #298), so that the stock and its screens are
 * one model for every application. What only this application knows comes in
 * as columns of its own:
 *
 * - an article's group of goods, whether every device holds it (#296) and
 *   the import that brought it (#297), and the units of a position (4.2), an
 *   hour and a lump sum among them, which a store never keeps;
 * - a supplier's short code, which an import appends to a number the
 *   business already uses (#297);
 * - whether a store is a service vehicle, and then its number plate
 *   (Feature-Gliederung 4.5); the fleet (4.6) hangs on the same row later;
 * - at a booking the job it was for and the line of the report it books,
 *   once, when the report is signed (decided on 31.10.2026).
 */
export const { articles, suppliers, stores, storeArticles, stockMovements } = stockSchema({
  units: lineUnits,
  articles: {
    columns: {
      groupOfGoods: text('group_of_goods'),
      frequent: boolean('frequent').notNull().default(false),
      importId: reference<'article-import'>('import_id'),
      // The guarantee of durability of the producer (#433), all three or none.
      durabilityHalfYears: integer('durability_half_years'),
      durabilityProducer: text('durability_producer'),
      durabilityModel: text('durability_model'),
    },
    constraints: (table): PgTableExtraConfigValue[] => [
      foreignKey({
        columns: [table.tenantId, table.importId],
        foreignColumns: [articleImports.tenantId, articleImports.id],
        name: 'articles_import_in_tenant',
      }),
      index('articles_group_idx').on(table.tenantId, table.groupOfGoods),
      // The list in its two orders (#461), page by page from the index alone:
      // the column itself at the end, so that PostgreSQL need not visit the
      // table for each row the offset passes over. The last page of 700,000
      // articles took 1.6 s by name and 0.3 s by number, and takes 0.08 s.
      index('articles_number_order')
        .on(table.tenantId, sql`lower(${table.number})`, table.id, table.number)
        .where(sql`${table.deletedAt} is null`),
      index('articles_designation_order')
        .on(table.tenantId, sql`lower(${table.designation})`, table.id, table.designation)
        .where(sql`${table.deletedAt} is null`),
      check(
        'articles_group_fits',
        sql`char_length(${table.groupOfGoods}) <= ${sql.raw(String(articleLimits.groupOfGoods))}`,
      ),
      check(
        'articles_durability_whole',
        sql`(${table.durabilityHalfYears} is null) = (${table.durabilityProducer} is null)
          and (${table.durabilityHalfYears} is null) = (${table.durabilityModel} is null)`,
      ),
      check(
        'articles_durability_fits',
        sql`${table.durabilityHalfYears} between ${sql.raw(String(durabilityLimits.halfYearsMin))} and ${sql.raw(String(durabilityLimits.halfYearsMax))}
          and char_length(${table.durabilityProducer}) <= ${sql.raw(String(durabilityLimits.text))}
          and char_length(${table.durabilityModel}) <= ${sql.raw(String(durabilityLimits.text))}`,
      ),
    ],
  },
  suppliers: {
    columns: {
      /** A few capitals an import appends to a number the business already uses (#297). */
      shortCode: text('short_code'),
    },
    constraints: (table): PgTableExtraConfigValue[] => [
      check(
        'suppliers_short_code_shaped',
        sql`${table.shortCode} ~ ${sql.raw(`'^[A-ZÄÖÜ0-9]{1,${String(supplierLimits.shortCode)}}$'`)}`,
      ),
    ],
  },
  stores: {
    columns: {
      vehicle: boolean('vehicle').notNull().default(false),
      plate: text('plate'),
    },
    constraints: (table): PgTableExtraConfigValue[] => [
      check(
        'stores_plate_fits',
        sql`${table.plate} is null or char_length(${table.plate}) between 1 and ${sql.raw(String(storeLimits.plate))}`,
      ),
      // A number plate is a vehicle's.
      check('stores_plate_of_a_vehicle', sql`${table.plate} is null or ${table.vehicle}`),
    ],
  },
  movements: {
    columns: {
      jobId: reference<'job'>('job_id'),
      documentLineId: reference<'document-line'>('document_line_id'),
    },
    constraints: (table): PgTableExtraConfigValue[] => [
      foreignKey({
        columns: [table.tenantId, table.jobId],
        foreignColumns: [jobs.tenantId, jobs.id],
        name: 'stock_movements_at_a_job_here',
      }),
      foreignKey({
        columns: [table.tenantId, table.documentLineId],
        foreignColumns: [documentLines.tenantId, documentLines.id],
        name: 'stock_movements_of_a_line_here',
      }),
      // A line of a report is booked once, when the report is signed.
      uniqueIndex('stock_movements_book_a_line_once')
        .on(table.tenantId, table.documentLineId)
        .where(sql`${table.documentLineId} is not null`),
      index('stock_movements_at_a_job_idx')
        .on(table.tenantId, table.jobId)
        .where(sql`${table.jobId} is not null`),
      // Goods come in for a job or go out to one; a transfer or a count is
      // the store's own.
      check(
        'stock_movements_job_at_a_receipt_or_withdrawal',
        sql`${table.jobId} is null or ${table.kind} in ('receipt', 'withdrawal')`,
      ),
      check(
        'stock_movements_line_at_a_withdrawal_for_its_job',
        sql`${table.documentLineId} is null or (${table.kind} = 'withdrawal' and ${table.jobId} is not null)`,
      ),
    ],
  },
})
