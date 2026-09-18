import { installationKinds } from '@opengewerk/domain'
import { date, index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'

import { primaryId, reference, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'
import { sites } from './sites.js'

export const installationKind = pgEnum('installation_kind', installationKinds)

/**
 * A system in a building. Carries its warranty, and later its test records and
 * maintenance contract. The trade specific structure branches out below it.
 */
export const installations = pgTable(
  'installations',
  {
    id: primaryId<'installation'>(),
    ...tenantColumn,
    siteId: reference<'site'>('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'restrict' }),
    kind: installationKind('kind').notNull(),
    designation: text('designation').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    commissionedOn: date('commissioned_on'),
    warrantyEndsOn: date('warranty_ends_on'),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('installations_site_idx').on(table.tenantId, table.siteId),
  ],
)
