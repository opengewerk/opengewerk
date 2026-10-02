import { date, integer, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * What a tenant sets for itself, with the day it applies from: the table and
 * its enums, made by an application for the settings it has.
 *
 * The period of validity is the whole point. A setting is not edited, it is
 * superseded from a day on, so that whatever was judged by it before that day
 * keeps being read the way it was written.
 *
 * **Which settings there are is the application's list**, and so is the list
 * of units a value is counted in. Both stand in the database as enums under
 * one name in every application. Deliberately not the same table as the rules
 * an application ships, and the rules are not a table at all: a tenant writing
 * a row here can never reach a threshold a law sets, because the key is an
 * enum of settings and no such threshold is in it.
 *
 * Whole numbers, and a flag is a zero or a one. A column that takes any shape
 * of value is a column nobody can add up, compare or check.
 *
 * No sync columns: a device does not change the settings of a tenant in a
 * basement. It reads what it was given and sends work back.
 */
export function tenantParametersSchema<const Key extends string, const Unit extends string>(lists: {
  /** The settings a tenant of this application has. */
  readonly keys: readonly [Key, ...Key[]]
  /** The units the values of this application are counted in. */
  readonly units: readonly [Unit, ...Unit[]]
}) {
  const ruleUnit = pgEnum('rule_unit', lists.units)
  const tenantParameterKey = pgEnum('tenant_parameter_key', lists.keys)

  const tenantParameters = pgTable(
    'tenant_parameters',
    {
      id: primaryId<'tenant-parameter'>(),
      ...tenantColumn,
      key: tenantParameterKey('key').notNull(),
      validFrom: date('valid_from').notNull(),
      validUntil: date('valid_until'),
      unit: ruleUnit('unit').notNull(),
      value: integer('value').notNull(),
      note: text('note'),
      ...timestamps,
    },
    (table) => [
      tenantIsolation(table.tenantId),
      // Two settings of the same kind starting on the same day is not a
      // question with an answer. The overlap that matters more, one period
      // reaching into the next, is caught where the value is written.
      uniqueIndex('tenant_parameters_start').on(table.tenantId, table.key, table.validFrom),
    ],
  )

  return { ruleUnit, tenantParameterKey, tenantParameters }
}

/** The table of settings of an application with these keys and units. */
export type TenantParametersTable<
  Key extends string = string,
  Unit extends string = string,
> = ReturnType<typeof tenantParametersSchema<Key, Unit>>['tenantParameters']
