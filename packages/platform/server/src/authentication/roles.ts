import type { RoleDefinition, TenantId } from '@opengewerk/platform-domain'
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm'

import type { Database, TenantTransaction } from '../database/database.js'
import { everyTenant } from '../database/every-tenant.js'
import { memberships, tenantRoles } from '../schema.js'
import type { AccessRules } from './access.js'

/**
 * The roles of a tenant as rows, read and written (ADR 0010).
 *
 * What somebody may do is read from here on every request and nowhere else:
 * the membership names keys, these are the rows behind them, and the
 * catalogue of the application adds them up. The list an application ships
 * is what a tenant starts with, and from then on it is the tenant's rows that
 * count.
 */

const definition = {
  key: tenantRoles.key,
  label: tenantRoles.label,
  rights: tenantRoles.rights,
  leads: tenantRoles.leads,
  secondFactor: tenantRoles.secondFactor,
}

/**
 * The roles of this tenant, in the order they were made.
 *
 * By the identifier, which is a UUIDv7 and therefore the order of writing:
 * the roles a tenant started with come first, in the order the application
 * lists them.
 */
export async function rolesOfTenant(
  tx: TenantTransaction,
  tenantId: TenantId,
): Promise<RoleDefinition[]> {
  return tx
    .select(definition)
    .from(tenantRoles)
    .where(eq(tenantRoles.tenantId, tenantId))
    .orderBy(asc(tenantRoles.id))
}

/**
 * The rows behind the keys a membership names. A key without a row gives
 * nothing: a role that is gone takes its rights with it.
 */
export async function rolesHeld(
  tx: TenantTransaction,
  tenantId: TenantId,
  keys: readonly string[],
): Promise<RoleDefinition[]> {
  if (keys.length === 0) {
    return []
  }

  return tx
    .select(definition)
    .from(tenantRoles)
    .where(and(eq(tenantRoles.tenantId, tenantId), inArray(tenantRoles.key, [...keys])))
}

/**
 * Whether a membership names a role that leads its tenant, as a condition for
 * a query over the memberships.
 *
 * The one way of asking who leads: of the flag in the rows and not of the
 * name of a role. A tenant can come to have more than one role that leads,
 * and a question asked of a name would miss whoever holds the other.
 */
export function leadsItsTenant(): SQL {
  return sql`exists (
    select 1 from ${tenantRoles}
     where ${tenantRoles.tenantId} = ${memberships.tenantId}
       and ${tenantRoles.leads}
       and ${tenantRoles.key} = any(${memberships.roles})
  )`
}

/**
 * Writes the roles a tenant starts with, inside that tenant.
 *
 * Whoever brings a tenant into being calls this in the same transaction, so
 * that there is no tenant without its roles: without them nobody in it holds
 * a single right, which is the direction a mistake has to fail in, and it is
 * a failure all the same. The rows land in the log of the tenant like every
 * other.
 *
 * A key that is already there is left as it is. This writes what a tenant
 * starts with and never corrects what it has become.
 */
export async function writeRoles(
  tx: TenantTransaction,
  tenantId: TenantId,
  definitions: readonly RoleDefinition[],
): Promise<void> {
  if (definitions.length === 0) {
    return
  }

  await tx
    .insert(tenantRoles)
    .values(
      definitions.map((role) => ({
        tenantId,
        key: role.key,
        label: role.label,
        rights: role.rights,
        leads: role.leads,
        secondFactor: role.secondFactor,
      })),
    )
    .onConflictDoNothing({ target: [tenantRoles.tenantId, tenantRoles.key] })
}

/** What the log of a tenant says about roles written when the instance started. */
export const completingRoles = 'roles.complete'

/**
 * Gives every tenant that has no role at all the roles a tenant starts with,
 * and says which tenants those were.
 *
 * Asked when an instance starts, before its first request. Nothing in here
 * leaves a tenant without roles: whoever brings one into being writes them in
 * the same transaction. A tenant without any was therefore made by something
 * else, and one such thing comes with an update: the version from before the
 * roles were rows goes on running between the migration and the start of this
 * one, and a tenant it creates in that moment has none. Nobody in such a
 * tenant holds a right and nobody can be given a role, from the command line
 * either, and the way out would be a prompt on the database.
 *
 * Only a tenant with no role at all. One that has roles has what it made of
 * them, and a shipped role that is missing there is missing on purpose.
 */
export async function completeRoles(
  database: Database,
  access: Pick<AccessRules, 'shippedRoles'>,
): Promise<readonly TenantId[]> {
  const completed: TenantId[] = []

  for (const tenantId of await everyTenant(database)) {
    const written = await database.forTenant({ tenantId, reason: completingRoles }, async (tx) => {
      const [held] = await tx
        .select({ id: tenantRoles.id })
        .from(tenantRoles)
        .where(eq(tenantRoles.tenantId, tenantId))
        .limit(1)

      if (held) {
        return false
      }

      await writeRoles(tx, tenantId, access.shippedRoles)

      return true
    })

    if (written) {
      completed.push(tenantId)
    }
  }

  return completed
}

/**
 * The role the first account of a tenant gets: the first of the shipped ones
 * that leads, and nothing else, because it is the role that hands out the
 * others. An application without one is put together wrongly and says so the
 * first time anybody asks.
 */
export function firstRoleOf(access: Pick<AccessRules, 'shippedRoles'>): RoleDefinition {
  const leading = access.shippedRoles.find((role) => role.leads)

  if (!leading) {
    throw new Error('None of the roles this application ships leads a tenant.')
  }

  return leading
}
