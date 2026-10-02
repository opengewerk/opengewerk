import type { Id } from '@opengewerk/platform-domain'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import {
  createdBySetupOnly,
  ownTenantOnly,
  ownTenantsOutsideTenant,
  readableByTheOwner,
} from './rls.js'

/**
 * One tenant of the instance: a business in one application, an operator of
 * buildings in another. Several can share a server (ADR 0006). What it is
 * called on a screen is the application's word; here and in the database it
 * is the tenant.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: primaryId<'tenant'>(),
    name: text('name').notNull(),
    ...timestamps,
  },
  // The second one arrived with the authentication: a tenant has to be
  // readable by name from outside any tenant, or nobody could ever pick one
  // after signing in. The last two arrived with the first run setup, which
  // creates the one tenant an empty instance needs, and has to ask first
  // whether there is one, both from a function that runs as the owner of the
  // tables.
  (table) => [
    ownTenantOnly(table.id),
    ownTenantsOutsideTenant(table.id),
    ...createdBySetupOnly(),
    readableByTheOwner(),
  ],
)

/**
 * The tenant every record belongs to. Row level security reads this column,
 * and the policies that do so live next to each table.
 */
export const tenantColumn = {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' })
    .$type<Id<'tenant'>>(),
}
