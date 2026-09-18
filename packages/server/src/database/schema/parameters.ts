import { ruleUnits, tenantParameterKeys } from '@opengewerk/domain'
import { date, integer, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

export const ruleUnit = pgEnum('rule_unit', ruleUnits)
export const tenantParameterKey = pgEnum('tenant_parameter_key', tenantParameterKeys)

/**
 * What a business sets for itself.
 *
 * Deliberately not the same table as the rules, and the rules are not a table
 * at all: they ship as data packages in the repository. A business writing a
 * row here can never reach a legal threshold, because the key is an enum of
 * settings and no legal parameter is in it.
 *
 * The period of validity is the whole point. A parameter is not edited, it is
 * superseded from a date, so that an invoice from before that date keeps being
 * read the way it was written.
 *
 * No sync columns: a device does not change a company's settings in a
 * basement. It reads what it was given and sends work back.
 */
export const tenantParameters = pgTable(
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
    // Two settings of the same kind starting on the same day is not a question
    // with an answer. The overlap that matters more, one period reaching into
    // the next, is caught where the value is read.
    uniqueIndex('tenant_parameters_start').on(table.tenantId, table.key, table.validFrom),
  ],
)
