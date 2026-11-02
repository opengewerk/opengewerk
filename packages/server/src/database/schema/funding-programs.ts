import { type FundingEvidence, fundingKinds, fundingProgramLimits } from '@opengewerk/domain'
import { primaryId, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, jsonb, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * The funding programmes of the business as templates (#307): what each asks
 * for as proof, in its order and its words, the kinds of installation it is
 * for and the text of the declaration of the business. At an installation
 * the papers of a programme are put together out of it when asked for.
 *
 * No sync columns: the office keeps them at a desk, and they go to no device.
 * Deleted for real, not marked, like a text snippet: no row names a
 * programme, the papers made from it are not kept, and the audit log keeps
 * the deletion.
 */
export const fundingPrograms = pgTable(
  'funding_programs',
  {
    id: primaryId<'funding-program'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    sponsor: text('sponsor'),
    url: text('url'),
    kinds: text('kinds').array().notNull(),
    evidence: jsonb('evidence').$type<readonly FundingEvidence[]>().notNull(),
    declaration: text('declaration'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    check(
      'funding_programs_texts_fit',
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(fundingProgramLimits.name))}
        and char_length(coalesce(${table.sponsor}, '')) <= ${sql.raw(String(fundingProgramLimits.sponsor))}
        and char_length(coalesce(${table.url}, '')) <= ${sql.raw(String(fundingProgramLimits.url))}
        and char_length(coalesce(${table.declaration}, '')) <= ${sql.raw(String(fundingProgramLimits.declaration))}`,
    ),
    check(
      'funding_programs_kinds',
      sql`cardinality(${table.kinds}) between 1 and ${sql.raw(String(fundingKinds.length))}
        and ${table.kinds} <@ array[${sql.raw(fundingKinds.map((kind) => `'${kind}'`).join(', '))}]::text[]`,
    ),
    check(
      'funding_programs_evidence',
      sql`jsonb_typeof(${table.evidence}) = 'array'
        and jsonb_array_length(${table.evidence}) between 1 and ${sql.raw(String(fundingProgramLimits.evidence))}`,
    ),
  ],
)
