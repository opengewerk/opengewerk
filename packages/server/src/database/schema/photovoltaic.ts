import { pvLimits } from '@opengewerk/domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { installations } from './installations.js'

/**
 * The structure below a PV system: inverter, string, module (#300).
 *
 * The figures are whole numbers: power in watts, directions and tilts in
 * degrees, and the checks below say what `inverterProblems`,
 * `pvStringProblems` and `pvModuleProblems` in `domain` say, which the forms
 * and the sync ask first.
 */
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
    ratedPowerW: integer('rated_power_w'),
    mppInputs: integer('mpp_inputs'),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('inverters_tenant_id_key').on(table.tenantId, table.id),
    check(
      'inverters_rated_power',
      sql`${table.ratedPowerW} is null or ${table.ratedPowerW} between 1 and ${sql.raw(String(pvLimits.inverterRatedPowerW))}`,
    ),
    check(
      'inverters_mpp_inputs',
      sql`${table.mppInputs} is null or ${table.mppInputs} between 1 and ${sql.raw(String(pvLimits.mppInputs))}`,
    ),
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
    mppInput: integer('mpp_input'),
    azimuthDeg: integer('azimuth_deg'),
    tiltDeg: integer('tilt_deg'),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('pv_strings_tenant_id_key').on(table.tenantId, table.id),
    check(
      'pv_strings_mpp_input',
      sql`${table.mppInput} is null or ${table.mppInput} between 1 and ${sql.raw(String(pvLimits.mppInputs))}`,
    ),
    check(
      'pv_strings_azimuth',
      sql`${table.azimuthDeg} is null or ${table.azimuthDeg} between 0 and 359`,
    ),
    check('pv_strings_tilt', sql`${table.tiltDeg} is null or ${table.tiltDeg} between 0 and 90`),
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
    ratedPowerW: integer('rated_power_w'),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    check(
      'pv_modules_rated_power',
      sql`${table.ratedPowerW} is null or ${table.ratedPowerW} between 1 and ${sql.raw(String(pvLimits.moduleRatedPowerW))}`,
    ),
    foreignKey({
      columns: [table.tenantId, table.pvStringId],
      foreignColumns: [pvStrings.tenantId, pvStrings.id],
      name: 'pv_modules_string_in_tenant',
    }).onDelete('cascade'),
    index('pv_modules_string_idx').on(table.pvStringId),
  ],
)
