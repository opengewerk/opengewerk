import { installationKinds } from '@opengewerk/domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  unique,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core'

import { inverters } from './photovoltaic.js'
import { sites } from './sites.js'

export const installationKind = pgEnum('installation_kind', installationKinds)

/**
 * A system in a building. Carries its warranty, and later its test records and
 * maintenance contract. The trade specific structure branches out below it.
 *
 * The unique key over tenant and id is what the boards below point at, so
 * that a board can only hang on an installation of its own business; see
 * `distributionBoards` for why a key on the id alone does not see to that.
 *
 * A battery, meter or wallbox says which PV system it belongs to and at which
 * of its inverters it hangs (#300). That the system is one at the same site
 * and the inverter one of that system, the keys cannot say; the sync and the
 * routes ask it first (`pvLinkRefusal`), and a trigger holds it for every
 * other way in.
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
    pvSystemId: reference<'installation'>('pv_system_id'),
    inverterId: reference<'inverter'>('inverter_id'),
    ...timestamps,
    ...syncColumns,
  },
  // Typed by hand: the inverters point back here, and TypeScript would infer
  // each table from the other.
  (table): PgTableExtraConfigValue[] => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.pvSystemId],
      foreignColumns: [table.tenantId, table.id],
      name: 'installations_pv_system_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.inverterId],
      foreignColumns: [inverters.tenantId, inverters.id],
      name: 'installations_inverter_in_tenant',
    }).onDelete('restrict'),
    // At an inverter only as part of its system, and never part of itself.
    check(
      'installations_inverter_with_system',
      sql`${table.inverterId} is null or ${table.pvSystemId} is not null`,
    ),
    check(
      'installations_not_own_system',
      sql`${table.pvSystemId} is null or ${table.pvSystemId} <> ${table.id}`,
    ),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'installations_site_in_tenant',
    }).onDelete('restrict'),
    unique('installations_tenant_id_key').on(table.tenantId, table.id),
    index('installations_site_idx').on(table.tenantId, table.siteId),
  ],
)
