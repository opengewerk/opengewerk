import type { Id } from '@opengewerk/domain'
import { pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'

/** One company on the instance. Several can share a server (ADR 0006). */
export const tenants = pgTable('tenants', {
  id: primaryId<'tenant'>(),
  name: text('name').notNull(),
  ...timestamps,
})

/**
 * The tenant every record belongs to. Row level security reads this column and
 * arrives with its own issue; the column itself is part of the model, because
 * a record that does not know its tenant is wrong no matter how it is secured.
 */
export const tenantColumn = {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' })
    .$type<Id<'tenant'>>(),
}
