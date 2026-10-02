import {
  type MadeByTheApplication,
  numberRangesGuard,
  secretsGuard,
  tenantParametersGuard,
} from '@opengewerk/platform-server/migration'

import { numberRangeKey, numberRanges } from './number-ranges.js'
import { ruleUnit, tenantParameterKey, tenantParameters } from './parameters.js'
import { secretPurpose, secrets } from './secrets.js'

/**
 * The tables of the foundation this application makes with lists of its own
 * (ADR 0010): their columns and rules are the foundation's, the values of
 * their enums are this application's.
 *
 * Described once here, for the comparison of this database with the building
 * blocks of the foundation (`foundation.test.ts`). Not part of what
 * `index.ts` hands to drizzle-kit: this is a description and no table.
 */
export const madeWithLists: MadeByTheApplication = {
  schema: {
    secretPurpose,
    secrets,
    ruleUnit,
    tenantParameterKey,
    tenantParameters,
    numberRangeKey,
    numberRanges,
  },
  guards: [secretsGuard, tenantParametersGuard, numberRangesGuard],
}
