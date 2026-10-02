import { integer, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * The counters of the numbers that run without holes: the table and its enum,
 * made by an application for the sequences it has.
 *
 * One row per tenant and sequence, and the counter lives in that row rather
 * than in a PostgreSQL sequence, which is the whole point: a sequence hands
 * out its next value outside the transaction and keeps it even when the
 * transaction rolls back. That is exactly right for a surrogate key and
 * exactly wrong here, where a hole in the numbering is the thing nobody can
 * explain afterwards.
 *
 * **Which sequences there are is the application's list.** It stands in the
 * database as an enum under one name in every application, so a row can never
 * count for a sequence the application does not have.
 *
 * No sync columns: a counter never leaves the server. A device that drew a
 * number in a basement would draw the one somebody else drew upstairs.
 */
export function numberRangesSchema<const Key extends string>(keys: readonly [Key, ...Key[]]) {
  const numberRangeKey = pgEnum('number_range_key', keys)

  const numberRanges = pgTable(
    'number_ranges',
    {
      id: primaryId<'number-range'>(),
      ...tenantColumn,
      key: numberRangeKey('key').notNull(),
      /** For example `NR-{year}-{number:4}`. */
      pattern: text('pattern').notNull(),
      /** The counter the next number gets. Starts at 1 and only ever grows. */
      nextValue: integer('next_value').notNull().default(1),
      ...timestamps,
    },
    (table) => [
      tenantIsolation(table.tenantId),
      unique('number_ranges_tenant_key').on(table.tenantId, table.key),
    ],
  )

  return { numberRangeKey, numberRanges }
}

/** The table of counters of an application with these sequences. */
export type NumberRangesTable<Key extends string = string> = ReturnType<
  typeof numberRangesSchema<Key>
>['numberRanges']
