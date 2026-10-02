import { pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * Credentials of somebody else a tenant hands the instance, sealed: the table
 * and its enum, made by an application for the purposes it has.
 *
 * A password to a mailbox is not the tenant's own data but a key to something
 * outside, and it is kept that way: sealed with AES-256-GCM under a key the
 * instance derives from its session secret (`secrets/key.ts`), so that a copy
 * of the database alone opens nothing. The row carries its tenant, its
 * purpose and, where it has one, its record into the seal as well, and a
 * sealed value moved to another tenant, another use or another record no
 * longer opens.
 *
 * **Which purposes there are is the application's list**, and it stands in
 * the database as an enum under one name in every application. The foundation
 * knows the mechanism and not what is kept: one application seals the login
 * to a mail server and the code of a key safe, another whatever its tenants
 * hand it. So this is a function and not a table. An application calls it in
 * the file drizzle-kit reads its schema from and exports what comes back.
 *
 * The one table of a tenant the audit log does not watch, and on purpose. The
 * log is written once and never touched again, and a sealed value in it would
 * be there for good, readable by anybody who later gets hold of the log and
 * the key together. What the log does get is the moment something was set,
 * from the table that holds the setting.
 *
 * Nothing but the store reads or writes this table (`secrets/store.ts`); a
 * check of the kit holds that for the code of an application.
 */
export function secretsSchema<const Purpose extends string>(
  purposes: readonly [Purpose, ...Purpose[]],
) {
  const secretPurpose = pgEnum('secret_purpose', purposes)

  const secrets = pgTable(
    'secrets',
    {
      id: primaryId<'secret'>(),
      ...tenantColumn,
      purpose: secretPurpose('purpose').notNull(),
      /**
       * The record a secret belongs to, for a purpose with one per record.
       * Empty for a purpose a tenant has one secret of, which the key below
       * keeps once per tenant.
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

  return { secretPurpose, secrets }
}

/** The table of sealed credentials of an application with these purposes. */
export type SecretsTable<Purpose extends string = string> = ReturnType<
  typeof secretsSchema<Purpose>
>['secrets']
