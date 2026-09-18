import type { Id } from '@opengewerk/domain'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { ownTenantOnly } from './rls.js'

/** One company on the instance. Several can share a server (ADR 0006). */
export const tenants = pgTable(
  'tenants',
  {
    id: primaryId<'tenant'>(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (table) => [ownTenantOnly(table.id)],
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
