import { sql } from 'drizzle-orm'
import { check, index, pgTable, text } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'
import { customers } from './customers.js'
import { sites } from './sites.js'

/**
 * A person to talk to. Hangs off a customer or off a single site, and the
 * check makes sure it is exactly one: a contact that belongs to nothing is
 * unreachable, one that belongs to both is ambiguous when a site changes hands.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: primaryId<'contact'>(),
    ...tenantColumn,
    customerId: reference<'customer'>('customer_id').references(() => customers.id, {
      onDelete: 'cascade',
    }),
    siteId: reference<'site'>('site_id').references(() => sites.id, { onDelete: 'cascade' }),
    givenName: text('given_name'),
    familyName: text('family_name').notNull(),
    role: text('role'),
    email: text('email'),
    phone: text('phone'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    check(
      'contacts_belong_to_customer_or_site',
      sql`(${table.customerId} is null) <> (${table.siteId} is null)`,
    ),
    index('contacts_customer_idx').on(table.tenantId, table.customerId),
    index('contacts_site_idx').on(table.tenantId, table.siteId),
  ],
)
