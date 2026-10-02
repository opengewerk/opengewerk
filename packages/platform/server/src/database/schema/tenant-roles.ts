import { sql } from 'drizzle-orm'
import { boolean, check, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { primaryId, timestamps } from './columns.js'
import { readableByTheOwner, tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

/**
 * The roles of a tenant, one row each (ADR 0010).
 *
 * A membership names roles by their key, and what somebody may do is what the
 * rows behind those keys add up to. The roles an application ships are rows
 * like any other, written when a tenant comes into being; roles a tenant
 * makes for itself join them as further rows.
 *
 * The rights stand in the row and are not looked up in the code of the
 * application. That is what puts a change of what a role may do into the log
 * of the tenant, whoever made it, an update of the software included: the
 * audit trigger watches this table like every other, and "who was allowed
 * what, and since when" can be read from the log of this table and of the
 * memberships alone.
 *
 * `leads` and `second_factor` are columns and not rights. What must not be
 * possible to switch off hangs on them: a tenant keeps somebody who leads it,
 * and such a role works only with a second factor. A right is something a
 * role can lose.
 */
export const tenantRoles = pgTable(
  'tenant_roles',
  {
    id: primaryId<'tenant-role'>(),
    ...tenantColumn,
    /** What a membership names. */
    key: text('key').notNull(),
    /** What a screen calls the role. */
    label: text('label').notNull(),
    /**
     * The rights of the role, as the keys of the application's catalogue.
     * Plain strings here: a key the catalogue of the running version does not
     * know gives nothing, and is kept for the version that does.
     */
    rights: text('rights').array().notNull().$type<readonly string[]>(),
    leads: boolean('leads').notNull().default(false),
    secondFactor: boolean('second_factor').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    unique('tenant_roles_key_once').on(table.tenantId, table.key),
    // A key ends up in the roles of a membership and in an address. Held to a
    // plain shape so that neither has to wonder what is in it.
    check('tenant_roles_key_plain', sql`${table.key} ~ '^[a-z0-9][a-z0-9_-]{0,63}$'`),
    check(
      'tenant_roles_label_shaped',
      sql`${table.label} = btrim(${table.label}) and char_length(${table.label}) between 1 and 80`,
    ),
    tenantIsolation(table.tenantId),
    // For the one function that reads the roles of every tenant: who leads
    // which, for whoever runs the instance (`tenants_with_leads`). It hands
    // out names and counts and no row of this table. See `readableByTheOwner`.
    readableByTheOwner(),
  ],
)
