import { mailOutboxSchema } from '@opengewerk/platform-server'
import {
  type MadeByTheApplication,
  mailOutboxGuard,
  numberRangesGuard,
  secretsGuard,
  tenantParametersGuard,
} from '@opengewerk/platform-server/migration'

import { mailKinds } from './mail.js'
import { numberRangeKey, numberRanges } from './number-ranges.js'
import { ruleUnit, tenantParameterKey, tenantParameters } from './parameters.js'
import { secretPurpose, secrets } from './secrets.js'

/**
 * The outbox as the foundation makes it with the kinds of this application,
 * without the columns this application adds for what its messages are about:
 * those point at its tasks, documents and deadlines, which a database of the
 * building blocks does not have. `foundation.test.ts` names them as its own.
 */
const outboxOfTheBlocks = mailOutboxSchema({ kinds: mailKinds })

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
    mailKind: outboxOfTheBlocks.mailKind,
    mailStatus: outboxOfTheBlocks.mailStatus,
    mailOutbox: outboxOfTheBlocks.mailOutbox,
  },
  guards: [secretsGuard, tenantParametersGuard, numberRangesGuard, mailOutboxGuard],
}
