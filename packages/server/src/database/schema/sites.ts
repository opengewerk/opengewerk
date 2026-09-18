import { index, pgTable, text } from 'drizzle-orm/pg-core'

import { primaryId, reference, timestamps } from './columns.js'
import { tenantColumn } from './tenants.js'
import { customers } from './customers.js'

/**
 * A building. One customer can have many, which is the case the model is cut
 * for: a property management company with forty of them, each with its own
 * systems and its own history.
 */
export const sites = pgTable(
  'sites',
  {
    id: primaryId<'site'>(),
    ...tenantColumn,
    customerId: reference<'customer'>('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    designation: text('designation').notNull(),

    street: text('street'),
    houseNumber: text('house_number'),
    postalCode: text('postal_code'),
    city: text('city'),
    country: text('country').notNull().default('DE'),

    notes: text('notes'),
    ...timestamps,
  },
  (table) => [index('sites_customer_idx').on(table.tenantId, table.customerId)],
)
