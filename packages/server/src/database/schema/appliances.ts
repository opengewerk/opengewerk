import { applianceMobilities, protectionClasses } from '@opengewerk/domain'
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
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core'

import { sites } from './sites.js'

export const applianceProtectionClass = pgEnum('appliance_protection_class', protectionClasses)
export const applianceMobility = pgEnum('appliance_mobility', applianceMobilities)

/**
 * The register of appliances of a site (#303): what hangs on no circuit and is
 * tested after DGUV Vorschrift 3, the drill, the coffee machine, the extension
 * lead. "Gerät" on screen; a device in the code is the phone or tablet of the
 * sync, whose column `device_id` every synced table carries.
 *
 * Field work like an installation: made in the office or on site, without a
 * network, and tested there. A protocol hangs on it through `form_records`
 * (`appliance_id`), and the key over tenant and id is what that key points
 * at, so that a protocol cannot hang on an appliance of another business.
 */
export const appliances = pgTable(
  'appliances',
  {
    id: primaryId<'appliance'>(),
    ...tenantColumn,
    siteId: reference<'site'>('site_id').notNull(),
    inventoryNumber: text('inventory_number'),
    designation: text('designation').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    protectionClass: applianceProtectionClass('protection_class').notNull(),
    mobility: applianceMobility('mobility').notNull().default('portable'),
    location: text('location'),
    cordLengthMilli: integer('cord_length_milli'),
    notes: text('notes'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'appliances_site_in_tenant',
    }).onDelete('restrict'),
    // What `applianceProblems` asks, for every way in.
    check('appliances_designation_named', sql`btrim(${table.designation}) <> ''`),
    check(
      'appliances_cord_length',
      sql`${table.cordLengthMilli} is null or ${table.cordLengthMilli} between 1 and 1000000`,
    ),
    unique('appliances_tenant_id_key').on(table.tenantId, table.id),
    index('appliances_site_idx').on(table.tenantId, table.siteId),
  ],
)
