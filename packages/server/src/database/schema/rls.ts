import { sql } from 'drizzle-orm'
import { type PgColumn, pgPolicy, pgRole } from 'drizzle-orm/pg-core'

/**
 * The role the application connects as. It owns nothing and is not a
 * superuser, because both of those walk straight past row level security: a
 * superuser always, an owner unless the table forces it.
 *
 * Declared as existing because drizzle-kit does not create roles. It is
 * created in the migration that turns the isolation on.
 */
export const applicationRole = pgRole('opengewerk_app').existing()

/**
 * The only thing a row has to prove: it belongs to the tenant of this
 * transaction. `SET LOCAL app.tenant_id` puts that value there, and when
 * nobody has, `current_setting` returns nothing and the comparison is null,
 * so not a single row comes back. That is the direction a mistake has to fail
 * in.
 *
 * `nullif` catches the empty string. Without it an empty setting would blow up
 * in the cast instead of quietly matching nothing, which is still safe but a
 * good deal harder to read in a log at two in the morning.
 */
function sessionTenant() {
  return sql`nullif(current_setting('app.tenant_id', true), '')::uuid`
}

/** The policy for every table that carries a tenant. */
export function tenantIsolation(tenantId: PgColumn) {
  const belongsToSession = sql`${tenantId} = ${sessionTenant()}`

  return pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: applicationRole,
    using: belongsToSession,
    withCheck: belongsToSession,
  })
}

/**
 * The tenants table itself. A tenant sees its own row and no other. Creating a
 * tenant is not something the application role does; that belongs to whoever
 * sets up the instance.
 */
export function ownTenantOnly(id: PgColumn) {
  const isSession = sql`${id} = ${sessionTenant()}`

  return pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: applicationRole,
    using: isSession,
    withCheck: isSession,
  })
}

/**
 * The pair of policies both audit tables carry.
 *
 * The trigger that writes them runs as its definer, and it has to work on
 * every path, including a change somebody makes at a psql prompt, where no
 * session tenant exists and there is nothing to compare a row against. It also
 * has to read: the chain head comes from the table and goes back into it. So
 * the first policy is open, and it has to be.
 *
 * The second one closes it again around the application, and it is restrictive
 * rather than permissive. Permissive policies combine with OR, restrictive
 * ones with AND, so no other policy can widen this: whatever else permits, the
 * application role stays inside its own tenant and writes nothing. Without it,
 * the open policy above would let one company count another company's changes.
 *
 * The grant is the third gate. The application role has SELECT and nothing
 * else on either table, so a forged entry never even reaches a policy.
 */
export function writtenByTriggerOnly(tenantId: PgColumn) {
  return [
    pgPolicy('written_by_trigger', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: sql`true`,
      withCheck: sql`true`,
    }),
    pgPolicy('tenant_isolation', {
      as: 'restrictive',
      for: 'all',
      to: applicationRole,
      using: sql`${tenantId} = ${sessionTenant()}`,
      withCheck: sql`false`,
    }),
  ]
}
