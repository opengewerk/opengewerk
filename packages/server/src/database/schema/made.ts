import {
  attachmentsSchema,
  contactsSchema,
  deadlinesSchema,
  mailOutboxSchema,
} from '@opengewerk/platform-server'
import {
  attachmentsGuard,
  attachmentVersionsGuard,
  contactsGuard,
  deadlinesGuard,
  type MadeByTheApplication,
  mailOutboxGuard,
  numberRangesGuard,
  pushOptOutsGuard,
  pushOutboxGuard,
  pushSubscriptionsGuard,
  secretsGuard,
  tenantParametersGuard,
} from '@opengewerk/platform-server/migration'

import { mailKinds } from './mail.js'
import { numberRangeKey, numberRanges } from './number-ranges.js'
import { push } from './push.js'
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
 * The deadlines as the foundation makes them, without the columns this
 * application adds for what a deadline hangs on, for the same reason.
 */
const deadlinesOfTheBlocks = deadlinesSchema()

/**
 * The contacts as the foundation makes them, without the columns this
 * application adds for what a contact hangs on, for the same reason: they
 * point at its customers, sites and suppliers.
 */
const contactsOfTheBlocks = contactsSchema()

/**
 * The files of the records and their versions as the foundation makes them,
 * without the columns this application adds for what a file hangs on, for the
 * same reason: they point at its customers, sites, installations and jobs.
 */
const attachmentsOfTheBlocks = attachmentsSchema()

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
    ...push,
    deadlineStatus: deadlinesOfTheBlocks.deadlineStatus,
    deadlines: deadlinesOfTheBlocks.deadlines,
    contacts: contactsOfTheBlocks.contacts,
    attachments: attachmentsOfTheBlocks.attachments,
    attachmentVersions: attachmentsOfTheBlocks.attachmentVersions,
  },
  guards: [
    secretsGuard,
    tenantParametersGuard,
    numberRangesGuard,
    mailOutboxGuard,
    pushSubscriptionsGuard,
    pushOptOutsGuard,
    pushOutboxGuard,
    deadlinesGuard,
    contactsGuard,
    attachmentsGuard,
    attachmentVersionsGuard,
  ],
}
