import { numberRangeKeys } from '@opengewerk/domain'
import { integer, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

export const numberRangeKey = pgEnum('number_range_key', numberRangeKeys)

/**
 * The counters. One row per tenant and sequence, and the counter lives in that
 * row rather than in a PostgreSQL sequence, which is the whole point: a
 * sequence hands out its next value outside the transaction and keeps it even
 * when the transaction rolls back. That is exactly right for a surrogate key
 * and exactly wrong here, where a hole in the numbering is the thing the law
 * asks us not to produce.
 */
export const numberRanges = pgTable(
  'number_ranges',
  {
    id: primaryId<'number-range'>(),
    ...tenantColumn,
    key: numberRangeKey('key').notNull(),
    pattern: text('pattern').notNull(),
    nextValue: integer('next_value').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('number_ranges_tenant_key').on(table.tenantId, table.key),
  ],
)
