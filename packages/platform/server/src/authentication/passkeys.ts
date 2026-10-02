import { getAuthenticatorName } from '@better-auth/passkey'
import type { PasskeyEntry, TenantId } from '@opengewerk/platform-domain'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

import type { Database } from '../database/database.js'
import { authPasskeys, memberPasskeys, memberships } from '../schema.js'

/**
 * The passkeys of an account (#167, #248): the list under "Konto", renaming
 * and deleting one, and the record of each in the tenants the account
 * works in.
 *
 * Adding one is not here. That is better-auth's passkey plugin, behind the
 * confirmation in `reconfirmation.ts`; what happens around it is in
 * `authentication.ts`, which calls `recordAdded` below.
 */

/** A passkey as it is recorded, by its key on the instance and its name. */
interface Recorded {
  readonly id: string
  readonly name: string
}

/**
 * Every tenant the account works in, blocked or not. A passkey opens none
 * of the blocked ones, but it is the person's all the same, and a tenant
 * that blocked somebody may want to know what keys they hold.
 */
async function tenantsOf(database: Database, userId: string): Promise<readonly TenantId[]> {
  const rows = await database.forInstance(
    (tx) =>
      tx
        .select({ tenantId: memberships.tenantId })
        .from(memberships)
        .where(eq(memberships.userId, userId))
        .orderBy(asc(memberships.createdAt)),
    userId,
  )

  return rows.map((row) => row.tenantId as TenantId)
}

/**
 * Writes the new passkey into every tenant of the account, where the audit
 * trigger puts it in the log. One transaction per tenant, because each is
 * one: a failure in the third leaves the first two with a passkey that then
 * does not exist, which says too much rather than too little, and the caller
 * takes the passkey back (`authentication.ts`).
 */
export async function recordAdded(
  database: Database,
  userId: string,
  passkey: Recorded,
): Promise<void> {
  for (const tenantId of await tenantsOf(database, userId)) {
    await database.forTenant({ tenantId, userId, reason: 'passkey.add' }, (tx) =>
      tx
        .insert(memberPasskeys)
        .values({ tenantId, userId, passkeyId: passkey.id, name: passkey.name })
        .onConflictDoNothing({ target: [memberPasskeys.tenantId, memberPasskeys.passkeyId] }),
    )
  }
}

/**
 * Writes a change into every tenant, as an update of the row where there
 * is one and a new row where there is not: a tenant the person joined after
 * the passkey was added learns of it from here on.
 */
async function recordChange(
  database: Database,
  userId: string,
  passkey: Recorded,
  reason: string,
  removedAt: Date | null,
): Promise<void> {
  for (const tenantId of await tenantsOf(database, userId)) {
    await database.forTenant({ tenantId, userId, reason }, (tx) =>
      tx
        .insert(memberPasskeys)
        .values({ tenantId, userId, passkeyId: passkey.id, name: passkey.name, removedAt })
        .onConflictDoUpdate({
          target: [memberPasskeys.tenantId, memberPasskeys.passkeyId],
          set: {
            name: passkey.name,
            ...(removedAt === null ? {} : { removedAt }),
            updatedAt: sql`now()`,
          },
        }),
    )
  }
}

/** The passkeys of an account, the newest first, as "Konto" lists them. */
export async function passkeysOf(database: Database, userId: string): Promise<PasskeyEntry[]> {
  const rows = await database.forInstance(
    (tx) =>
      tx
        .select({
          id: authPasskeys.id,
          name: authPasskeys.name,
          createdAt: authPasskeys.createdAt,
          lastUsedAt: authPasskeys.lastUsedAt,
          aaguid: authPasskeys.aaguid,
        })
        .from(authPasskeys)
        .where(eq(authPasskeys.userId, userId))
        .orderBy(desc(authPasskeys.createdAt)),
    userId,
  )

  return rows.map((row) => ({
    id: row.id,
    // Every passkey added here has a name; one without would only come from
    // a table filled by hand, and it still needs a line in the list.
    name: row.name ?? 'Passkey',
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    provider: getAuthenticatorName(row.aaguid ?? undefined) ?? null,
  }))
}

/**
 * Renames one of the account's own passkeys. Null when there is none by that
 * key for this account, which is one answer for "not yours" and "not there".
 * Should the record in a tenant fail, the same request again brings every
 * tenant to the new name.
 */
export async function renamePasskey(
  database: Database,
  userId: string,
  passkeyId: string,
  name: string,
): Promise<Recorded | null> {
  const [renamed] = await database.forInstance(
    (tx) =>
      tx
        .update(authPasskeys)
        .set({ name })
        .where(and(eq(authPasskeys.id, passkeyId), eq(authPasskeys.userId, userId)))
        .returning({ id: authPasskeys.id }),
    userId,
  )

  if (!renamed) {
    return null
  }

  const passkey = { id: renamed.id, name }

  await recordChange(database, userId, passkey, 'passkey.rename', null)

  return passkey
}

/**
 * Marks a passkey removed in every tenant that has it on record and not as
 * removed yet, and says how many did. Only rows that are there: a tenant
 * that never learnt of the passkey does not learn of it by its removal.
 */
export async function recordWithdrawn(
  database: Database,
  userId: string,
  passkeyId: string,
): Promise<number> {
  let closed = 0

  for (const tenantId of await tenantsOf(database, userId)) {
    const rows = await database.forTenant({ tenantId, userId, reason: 'passkey.remove' }, (tx) =>
      tx
        .update(memberPasskeys)
        .set({ removedAt: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(memberPasskeys.tenantId, tenantId),
            eq(memberPasskeys.userId, userId),
            eq(memberPasskeys.passkeyId, passkeyId),
            isNull(memberPasskeys.removedAt),
          ),
        )
        .returning({ id: memberPasskeys.id }),
    )

    closed += rows.length
  }

  return closed
}

/**
 * Deletes one of the account's own passkeys, after which it signs nobody in.
 * The password is untouched: whoever deletes the last passkey signs in with
 * it as before (#248). Null as for renaming.
 *
 * The key goes first, because a key that is meant to be gone must stop
 * working whatever happens next. Should the record in a tenant then fail,
 * the route answers with an error and the same request again finishes it:
 * the key is gone, but tenants still holding it as present are closed, and
 * only when there is nothing left to close is the answer "not there".
 */
export async function removePasskey(
  database: Database,
  userId: string,
  passkeyId: string,
): Promise<{ readonly id: string } | null> {
  const [removed] = await database.forInstance(
    (tx) =>
      tx
        .delete(authPasskeys)
        .where(and(eq(authPasskeys.id, passkeyId), eq(authPasskeys.userId, userId)))
        .returning({ id: authPasskeys.id, name: authPasskeys.name }),
    userId,
  )

  if (removed) {
    await recordChange(
      database,
      userId,
      { id: removed.id, name: removed.name ?? 'Passkey' },
      'passkey.remove',
      new Date(),
    )

    return { id: removed.id }
  }

  return (await recordWithdrawn(database, userId, passkeyId)) > 0 ? { id: passkeyId } : null
}

/** Notes that a passkey has just signed somebody in, for the list. */
export async function markUsed(database: Database, credentialId: string): Promise<void> {
  await database.forInstance((tx) =>
    tx
      .update(authPasskeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(authPasskeys.credentialID, credentialId)),
  )
}
