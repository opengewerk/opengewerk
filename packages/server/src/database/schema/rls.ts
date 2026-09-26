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
 * The tenants table itself. A tenant sees its own row and no other.
 *
 * The same policy as above, and it stays its own name because the column it
 * gets is a different thing: everywhere else the tenant is a foreign key, here
 * it is the primary key. Two identical bodies were worse than one call, though.
 * Whoever changes the comparison has to change it once, not notice that there
 * are two.
 *
 * Reading, and since 0047 changing the name (#276), is all the application
 * role does here. Creating and deleting a tenant belong to whoever sets up the
 * instance, and since 0007 that is not merely the intention but the grant.
 */
export function ownTenantOnly(id: PgColumn) {
  return tenantIsolation(id)
}

/**
 * The second policy on `tenants`, and the one that makes the chooser after a
 * sign in possible at all.
 *
 * Without it, a person who belongs to two companies is asked to pick one and
 * shown nothing: `ownTenantOnly` compares the row against the tenant of the
 * transaction, and at that moment there is none, which is the whole point of
 * the moment. So the name of a company has to be readable from outside one,
 * and exactly as far as the membership reaches.
 *
 * The `exists` is written out rather than joined against the table object,
 * because `memberships` already imports this module through `tenants`, and a
 * circle here breaks drizzle-kit as it loads the schema. Row level security
 * still applies to the subquery, so what it can see is the caller's own
 * memberships and no more: the two policies compose instead of one undoing
 * the other.
 *
 * Reading only. Creating a company belongs to whoever sets up the instance,
 * and since 0007 that is a grant and not merely an intention. Renaming its
 * own is the one change the application role may make, and only under the
 * policy above, inside the company (#276).
 */
export function ownTenantsOutsideTenant(id: PgColumn) {
  return pgPolicy('own_tenants_outside_tenant', {
    as: 'permissive',
    for: 'select',
    to: applicationRole,
    using: sql`nullif(current_setting('app.tenant_id', true), '') is null
      and exists (
        select 1 from memberships m
         where m.tenant_id = ${id}
           and m.user_id = nullif(current_setting('app.user_id', true), '')
      )`,
  })
}

/**
 * The policy the authentication tables carry, and it is the usual one turned
 * around: a row is in reach only while **no** tenant is set.
 *
 * A user belongs to the instance and not to a business, so there is no tenant
 * column to compare against and the ordinary policy has nothing to say. Left
 * open instead, these tables would be the one place where a request working
 * inside one company could read the names and addresses of everybody on the
 * server, including the staff of the company next door on the same instance.
 *
 * Turning the comparison around closes that without a rule anybody has to
 * remember. `Database.forTenant` always sets a tenant and `forInstance` never
 * does, so the two reach disjoint halves of the schema: business data only
 * from inside a business, accounts only from outside one. A controller that
 * tried to join a customer against the user table would not leak, it would
 * come back empty, and the test that puts a row on each side says so.
 */
export function outsideAnyTenant() {
  const noTenantInThisTransaction = sql`nullif(current_setting('app.tenant_id', true), '') is null`

  return pgPolicy('outside_any_tenant', {
    as: 'permissive',
    for: 'all',
    to: applicationRole,
    using: noTenantInThisTransaction,
    withCheck: noTenantInThisTransaction,
  })
}

/**
 * What a membership needs, and why it takes two policies rather than one.
 *
 * A membership is read from two directions. Inside a business it answers "what
 * may this person do here", which is the ordinary tenant question. Outside one
 * it answers "which businesses may I enter", the list somebody picks from
 * after signing in, and there is no tenant yet at that moment.
 *
 * The second direction is deliberately **read only**. Written as one policy
 * with two arms it would also let somebody delete their own membership from
 * outside any business, and a policy that is almost right about who may change
 * rights is not worth having. Granting a role stays where it belongs: inside
 * the business, behind `membership.write`, and in that tenant's audit log.
 */
export function membershipVisibility(tenantId: PgColumn, userId: PgColumn) {
  return [
    // The ordinary one, unchanged, so that a reader of the catalogue finds the
    // same `tenant_isolation` here as on every other table.
    tenantIsolation(tenantId),
    pgPolicy('own_membership_outside_tenant', {
      as: 'permissive',
      for: 'select',
      to: applicationRole,
      using: sql`nullif(current_setting('app.tenant_id', true), '') is null
        and ${userId} = nullif(current_setting('app.user_id', true), '')`,
    }),
  ]
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

/**
 * Lets the role that owns the tables read this one.
 *
 * `FORCE ROW LEVEL SECURITY` makes the policies apply to the owner as well,
 * and every policy in this file names the application role, so for the owner
 * there is no policy at all and no policy means no row. Usually that is
 * exactly right. It stops being right for the two tables the first run setup
 * has to ask about: `instance_is_empty` runs as the owner, and without this it
 * would find an empty instance on a server full of companies and offer the
 * setup screen again.
 *
 * Reading only, and only where it is needed. What the owner could do with it
 * that it could not do anyway is nothing: it owns the tables and can take
 * `FORCE` off in one statement. The protection `FORCE` actually buys is
 * against the application being pointed at the owner by mistake, and that is
 * refused at startup in `configuration.ts`, one layer before this one.
 *
 * `current_user` rather than the name of the role, because the name belongs to
 * whoever set the instance up. PostgreSQL resolves it when the policy is
 * created, which is while the migration runs, which is as the owner.
 */
export function readableByTheOwner() {
  return pgPolicy('readable_by_the_owner', {
    as: 'permissive',
    for: 'select',
    to: 'current_user',
    using: sql`true`,
  })
}

/**
 * The two policies that let the first run setup create the one business an
 * empty instance needs, and keep the application from creating any.
 *
 * The same shape as `writtenByTriggerOnly` and for the same reason: the insert
 * happens inside a function that runs as the owner of the tables, and `FORCE
 * ROW LEVEL SECURITY` applies to the owner as well. Every policy on `tenants`
 * names the application role, so none of them matches the owner, and with row
 * level security on and nothing matching, the row is refused. So there has to
 * be a policy the function can pass, and it has to be open, exactly as the
 * audit trigger's is.
 *
 * What keeps that from being a hole is the same three gates as there: the
 * application role has no INSERT grant since 0007, the restrictive policy
 * below shuts the door a second time whatever else permits, and the function
 * itself refuses unless the instance is empty.
 *
 * Insert only. Deleting a business stays where 0007 put it, with whoever set
 * the instance up; renaming it is the owner's since 0047 (#276).
 */
export function createdBySetupOnly() {
  return [
    pgPolicy('created_by_setup', {
      as: 'permissive',
      for: 'insert',
      to: 'public',
      withCheck: sql`true`,
    }),
    pgPolicy('no_application_insert', {
      as: 'restrictive',
      for: 'insert',
      to: applicationRole,
      withCheck: sql`false`,
    }),
  ]
}
