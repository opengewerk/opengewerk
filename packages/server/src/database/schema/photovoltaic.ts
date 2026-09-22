import { foreignKey, index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'
import { installations } from './installations.js'

/** The structure below a PV system: inverter, string, module. */
export const inverters = pgTable(
  'inverters',
  {
    id: primaryId<'inverter'>(),
    ...tenantColumn,
    installationId: reference<'installation'>('installation_id').notNull(),
    designation: text('designation').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('inverters_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.installationId],
      foreignColumns: [installations.tenantId, installations.id],
      name: 'inverters_installation_in_tenant',
    }).onDelete('cascade'),
    index('inverters_installation_idx').on(table.installationId),
  ],
)

export const pvStrings = pgTable(
  'pv_strings',
  {
    id: primaryId<'pv-string'>(),
    ...tenantColumn,
    inverterId: reference<'inverter'>('inverter_id').notNull(),
    designation: text('designation').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('pv_strings_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.inverterId],
      foreignColumns: [inverters.tenantId, inverters.id],
      name: 'pv_strings_inverter_in_tenant',
    }).onDelete('cascade'),
    index('pv_strings_inverter_idx').on(table.inverterId),
  ],
)

export const pvModules = pgTable(
  'pv_modules',
  {
    id: primaryId<'pv-module'>(),
    ...tenantColumn,
    pvStringId: reference<'pv-string'>('pv_string_id').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.pvStringId],
      foreignColumns: [pvStrings.tenantId, pvStrings.id],
      name: 'pv_modules_string_in_tenant',
    }).onDelete('cascade'),
    index('pv_modules_string_idx').on(table.pvStringId),
  ],
)
