import {
  tenantParameterNames,
  tenantParameterProblem,
  tenantParameterUnits,
} from '@opengewerk/domain'
import { tenantParameterStore } from '@opengewerk/platform-server'

import { tenantParameters } from './schema/index.js'

/**
 * What a business has set for itself, read for a day and written from a day
 * on. How that is done is the foundation's (`tenantParameterStore`, ADR 0010);
 * this binds it to the settings of this application: what each is called in a
 * sentence, the unit its value is counted in and what its value has to be,
 * all three from `domain`.
 */
export const { parameterAt, setParameter, parameterHistory } = tenantParameterStore(
  tenantParameters,
  {
    names: tenantParameterNames,
    units: tenantParameterUnits,
    problemOf: tenantParameterProblem,
  },
)
