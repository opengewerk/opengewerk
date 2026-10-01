import { primaryId, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { tenantColumn } from './tenants.js'

/**
 * What a secret opens: the login to the mail server of a business, once per
 * business, and the value of a way into a site (#286), once per access.
 */
export const secretPurpose = pgEnum('secret_purpose', ['smtp_password', 'site_access'])

/**
 * Credentials of somebody else a business hands the instance, sealed.
 *
 * A password to a mailbox is not the business's own data but a key to
 * something outside, and it is kept that way: sealed with AES-256-GCM under a
 * key the instance derives from `SESSION_SECRET` (see `secrets/key.ts`), so
 * that a copy of the database alone opens nothing. The row carries its tenant
 * and its purpose into the seal as well, and a sealed value moved to another
 * business or another use no longer opens.
 *
 * The one table of a business the audit log does not watch, and on purpose.
 * The log is written once and never touched again, and a sealed password in
 * it would be there for good, readable by anybody who later gets hold of the
 * log and the key together. What the log does get is the moment a password
 * was set, from `mail_settings`, which it watches like every other table.
 *
 * Nothing but `secrets/` reads or writes this table; a test holds that.
 */
export const secrets = pgTable(
  'secrets',
  {
    id: primaryId<'secret'>(),
    ...tenantColumn,
    purpose: secretPurpose('purpose').notNull(),
    /**
     * The record a secret belongs to, for a purpose with one per record: the
     * access to a site (#286). Empty for the one secret of a business, the
     * mail password, which the key below keeps once per business.
     */
    recordId: uuid('record_id'),
    /** `v1:<iv>:<tag>:<ciphertext>`, each part base64url. Never the value itself. */
    sealed: text('sealed').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('secrets_one_per_record')
      .on(table.tenantId, table.purpose, table.recordId)
      .nullsNotDistinct(),
  ],
)
