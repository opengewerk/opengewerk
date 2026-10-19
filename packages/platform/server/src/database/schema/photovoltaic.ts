import { pvLimits } from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { type OwnColumns, ownColumnsOf, type OwnTable, type TableWithOwn } from './own-columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

// The structure below a PV system as a building block (#300, ADR 0014):
// inverter, string, module. Made like the electrical structure beside it,
// under the names the tables had before they moved here; what an inverter
// hangs on is a column of the application's own, with its key.
//
// The figures are whole numbers: power in watts, directions and tilts in
// degrees, and the checks say what `inverterProblems`, `pvStringProblems` and
// `pvModuleProblems` in `platform-domain` say, which the forms and the sync
// ask first.

function inverterParts() {
  return {
    id: primaryId<'inverter'>(),
    ...tenantColumn,
    designation: text('designation').notNull(),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serialNumber: text('serial_number'),
    ratedPowerW: integer('rated_power_w'),
    mppInputs: integer('mpp_inputs'),
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  }
}

function stringParts() {
  return {
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
  }
}

function moduleParts() {
  return {
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
  }
}

/** The columns every table of inverters has, whatever an application hangs an inverter on. */
export type InverterColumns = ReturnType<typeof inverterParts>
export type PvStringColumns = ReturnType<typeof stringParts>
export type PvModuleColumns = ReturnType<typeof moduleParts>

/** The tables of the PV structure of an application. */
export interface PhotovoltaicTables<
  OwnInverter extends OwnColumns = Record<never, never>,
  OwnString extends OwnColumns = Record<never, never>,
  OwnModule extends OwnColumns = Record<never, never>,
> {
  readonly inverters: TableWithOwn<'inverters', InverterColumns, OwnInverter>
  readonly pvStrings: TableWithOwn<'pv_strings', PvStringColumns, OwnString>
  readonly pvModules: TableWithOwn<'pv_modules', PvModuleColumns, OwnModule>
}

/**
 * What an application says about its PV structure: at every table columns
 * and constraints of its own, at the inverters what they hang on.
 */
export interface PhotovoltaicOptions<
  OwnInverter extends OwnColumns,
  OwnString extends OwnColumns,
  OwnModule extends OwnColumns,
> {
  readonly inverters?: OwnTable<'inverters', InverterColumns, OwnInverter>
  readonly strings?: OwnTable<'pv_strings', PvStringColumns, OwnString>
  readonly modules?: OwnTable<'pv_modules', PvModuleColumns, OwnModule>
}

/**
 * The PV structure of an application (ADR 0014): three tables with the
 * columns of the application's own. Every part hangs on its parent through
 * the tenant as well as the id, for the reason `electricalSchema` gives.
 */
export function photovoltaicSchema<
  OwnInverter extends OwnColumns = Record<never, never>,
  OwnString extends OwnColumns = Record<never, never>,
  OwnModule extends OwnColumns = Record<never, never>,
>(
  options: PhotovoltaicOptions<OwnInverter, OwnString, OwnModule> = {},
): PhotovoltaicTables<OwnInverter, OwnString, OwnModule> {
  const inverterBase = inverterParts()
  const ownInverter = ownColumnsOf('inverters', inverterBase, options.inverters?.columns)
  const inverters = pgTable(
    'inverters',
    { ...inverterBase, ...ownInverter } as InverterColumns & OwnInverter,
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
      ...(options.inverters?.constraints?.(table) ?? []),
    ],
  )

  const stringBase = stringParts()
  const ownString = ownColumnsOf('PV strings', stringBase, options.strings?.columns)
  const pvStrings = pgTable(
    'pv_strings',
    { ...stringBase, ...ownString } as PvStringColumns & OwnString,
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
      ...(options.strings?.constraints?.(table) ?? []),
    ],
  )

  const moduleBase = moduleParts()
  const ownModule = ownColumnsOf('PV modules', moduleBase, options.modules?.columns)
  const pvModules = pgTable(
    'pv_modules',
    { ...moduleBase, ...ownModule } as PvModuleColumns & OwnModule,
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
      ...(options.modules?.constraints?.(table) ?? []),
    ],
  )

  return { inverters, pvStrings, pvModules } as PhotovoltaicTables<
    OwnInverter,
    OwnString,
    OwnModule
  >
}
