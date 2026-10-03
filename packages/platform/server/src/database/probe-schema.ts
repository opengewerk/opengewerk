import { index, text } from 'drizzle-orm/pg-core'

import {
  type MadeByTheApplication,
  mailOutboxGuard,
  numberRangesGuard,
  pushOptOutsGuard,
  pushOutboxGuard,
  pushSubscriptionsGuard,
  secretsGuard,
  tenantParametersGuard,
} from '../migration/guards.js'
import { mailOutboxSchema } from './schema/mail-outbox.js'
import { numberRangesSchema } from './schema/number-ranges.js'
import { pushSchema } from './schema/push.js'
import { tenantParametersSchema } from './schema/parameters.js'
import { secretsSchema } from './schema/secrets.js'

// The tables the application of the tests makes with lists of its own, the
// way an application does it in the file drizzle-kit reads its schema from.
// The lists are nobody's: a test that passed with a purpose of a real
// application here would pass just as well with that purpose written into the
// foundation.

/** What the tenants of the probe application seal: the login to a mailbox, and the code of a locker, one per locker. */
export const { secretPurpose: probeSecretPurpose, secrets: probeSecrets } = secretsSchema([
  'mailbox',
  'locker',
])

/**
 * What a tenant of the probe application sets for itself: how many days a
 * note is kept, and whether guests are let in at all. Counted in two units,
 * neither of which is a unit of a real application's rules.
 */
export const {
  ruleUnit: probeUnit,
  tenantParameterKey: probeParameterKey,
  tenantParameters: probeParameters,
} = tenantParametersSchema({
  keys: ['notes.kept_days', 'guests.admitted'],
  units: ['nights', 'yes_no'],
})

/**
 * What the probe application numbers: the parcels it takes in and the visits
 * it receives. Two sequences, so that a test can tell one from the other, and
 * neither is a sequence of a real application.
 */
export const { numberRangeKey: probeNumberRangeKey, numberRanges: probeNumberRanges } =
  numberRangesSchema(['parcel', 'visit'])

/**
 * What the probe application tells people by mail: that a parcel waits at the
 * desk, that a visit is announced, and that somebody is invited in. Its
 * messages about a parcel carry the number of the parcel in a column of the
 * application's own, the way an application keeps what its messages are
 * about.
 */
export const {
  mailKind: probeMailKind,
  mailStatus: probeMailStatus,
  mailOutbox: probeMailOutbox,
} = mailOutboxSchema({
  kinds: ['parcel_waiting', 'visit_announced', 'guest_invited'],
  columns: { parcelNumber: text('parcel_number') },
  constraints: (table) => [index('mail_outbox_parcel_idx').on(table.tenantId, table.parcelNumber)],
})

/**
 * Push in the probe application: a device works at the front desk or in the
 * back office, and a person can switch off the two occasions it tells about.
 */
export const probePush = pushSchema({
  entries: ['front', 'back'],
  occasions: ['parcel_waiting', 'visit_announced'],
})

/** The same tables as the kit is told about them. */
export const probeMade: MadeByTheApplication = {
  schema: {
    secretPurpose: probeSecretPurpose,
    secrets: probeSecrets,
    ruleUnit: probeUnit,
    tenantParameterKey: probeParameterKey,
    tenantParameters: probeParameters,
    numberRangeKey: probeNumberRangeKey,
    numberRanges: probeNumberRanges,
    mailKind: probeMailKind,
    mailStatus: probeMailStatus,
    mailOutbox: probeMailOutbox,
    ...probePush,
  },
  guards: [
    secretsGuard,
    tenantParametersGuard,
    numberRangesGuard,
    mailOutboxGuard,
    pushSubscriptionsGuard,
    pushOptOutsGuard,
    pushOutboxGuard,
  ],
}
