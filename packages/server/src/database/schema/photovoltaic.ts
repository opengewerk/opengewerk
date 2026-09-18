import { index, integer, pgTable, text } from 'drizzle-orm/pg-core'

import { primaryId, reference, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'
import { installations } from './installations.js'

/** The structure below a PV system: inverter, string, module. */
export const inverters = pgTable(
  'inverters',
  {
    id: primaryId<'inverter'>(),
    ...tenantColumn,
    installationId: reference<'installation'>('installation_id')
      .notNull()
      .references(() => installations.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('inverters_installation_idx').on(table.installationId),
  ],
)

export const pvStrings = pgTable(
  'pv_strings',
  {
    id: primaryId<'pv-string'>(),
    ...tenantColumn,
    inverterId: reference<'inverter'>('inverter_id')
      .notNull()
      .references(() => inverters.id, { onDelete: 'cascade' }),
    designation: text('designation').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('pv_strings_inverter_idx').on(table.inverterId),
  ],
)

export const pvModules = pgTable(
  'pv_modules',
  {
    id: primaryId<'pv-module'>(),
    ...tenantColumn,
    pvStringId: reference<'pv-string'>('pv_string_id')
      .notNull()
      .references(() => pvStrings.id, { onDelete: 'cascade' }),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (table) => [tenantIsolation(table.tenantId), index('pv_modules_string_idx').on(table.pvStringId)],
)
