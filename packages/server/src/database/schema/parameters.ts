import { ruleUnits, tenantParameterKeys } from '@opengewerk/domain'
import { tenantParametersSchema } from '@opengewerk/platform-server'

/**
 * What a business sets for itself, with the day it applies from. The table
 * and what keeps it are the foundation's (`tenantParametersSchema`, ADR
 * 0010); which settings there are and which units their values are counted in
 * are this application's lists, from `domain`.
 *
 * Deliberately not the same table as the rules, and the rules are not a table
 * at all: they ship as data packages in the repository. A business writing a
 * row here can never reach a legal threshold, because the key is an enum of
 * settings and no legal parameter is in it.
 */
export const { ruleUnit, tenantParameterKey, tenantParameters } = tenantParametersSchema({
  keys: tenantParameterKeys,
  units: ruleUnits,
})
