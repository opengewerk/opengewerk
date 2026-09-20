import type { Id } from '@opengewerk/domain'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import {
  createdBySetupOnly,
  ownTenantOnly,
  ownTenantsOutsideTenant,
  readableByTheOwner,
} from './rls.js'

/** One company on the instance. Several can share a server (ADR 0006). */
export const tenants = pgTable(
  'tenants',
  {
    id: primaryId<'tenant'>(),
    name: text('name').notNull(),
    ...timestamps,
  },
  // The second one arrived with the authentication: a company has to be
  // readable by name from outside any company, or nobody could ever pick one
  // after signing in. The last two arrived with the first run setup, which
  // creates the one business an empty instance needs, and has to ask first
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
