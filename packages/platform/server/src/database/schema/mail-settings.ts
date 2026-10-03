import { smtpSecurities } from '@opengewerk/platform-domain'
import { integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/** How the connection to a mail server is secured: STARTTLS, TLS from the first byte, or not at all. */
export const mailSecurity = pgEnum('mail_security', smtpSecurities)

/**
 * The mail server a tenant sends through, and the signature under what it
 * sends. One row per tenant, which the unique index holds, and none for a
 * tenant that sends no mail: then nothing is written for it and nothing sent,
 * as if the feature were not there.
 *
 * Per tenant and not per instance. A message goes out from the tenant's own
 * mailbox, with its own login, so that whoever gets it sees an address they
 * know and the provider of that mailbox vouches for it. On an instance with
 * several tenants each one brings its own.
 *
 * The password is not here. It is sealed in the table of sealed credentials,
 * which the audit log does not watch; this table carries the moment it was
 * set, and the log sees that change like any other, with the person who made
 * it.
 *
 * No sync columns: a device does not send mail and never sees this row.
 */
export const mailSettings = pgTable(
  'mail_settings',
  {
    id: primaryId<'mail_settings'>(),
    ...tenantColumn,
    host: text('host').notNull(),
    port: integer('port').notNull(),
    security: mailSecurity('security').notNull(),
    /** The login to the mailbox. Null for a relay that takes mail without one. */
    username: text('username'),
    /** The address every message of this tenant leaves from. */
    fromAddress: text('from_address').notNull(),
    /** The signature with its placeholders, as written. Null for the one the application gives. */
    signature: text('signature'),
    /** When the password was last set, null while there is none. */
    passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    uniqueIndex('mail_settings_tenant').on(table.tenantId),
  ],
)
