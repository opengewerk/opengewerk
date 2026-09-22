import { installationKinds } from '@opengewerk/domain'
import { date, foreignKey, index, pgEnum, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'
import { sites } from './sites.js'

export const installationKind = pgEnum('installation_kind', installationKinds)

/**
 * A system in a building. Carries its warranty, and later its test records and
 * maintenance contract. The trade specific structure branches out below it.
 *
 * The unique key over tenant and id is what the boards below point at, so
 * that a board can only hang on an installation of its own business; see
 * `distributionBoards` for why a key on the id alone does not see to that.
 */
export const installations = pgTable(
  'installations',
  {
    id: primaryId<'installation'>(),
    ...tenantColumn,
    siteId: reference<'site'>('site_id').notNull(),
    kind: installationKind('kind').notNull(),
    designation: text('designation').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    commissionedOn: date('commissioned_on'),
    warrantyEndsOn: date('warranty_ends_on'),
    notes: text('notes'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'installations_site_in_tenant',
    }).onDelete('restrict'),
    unique('installations_tenant_id_key').on(table.tenantId, table.id),
    index('installations_site_idx').on(table.tenantId, table.siteId),
  ],
)
