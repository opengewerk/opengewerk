import { hasSecondFactor, type InstanceAccess, type OperatorView } from '@opengewerk/domain'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { and, asc, eq, sql } from 'drizzle-orm'

import { normalise } from '../authentication/administration.js'
import type { Database } from '../database/database.js'
import { authSessions, authUsers, instanceOperators } from '../database/schema/index.js'

/**
 * The operators of the instance (#188): the accounts that run it, and the
 * only ones that reach its area. The account of the first run setup is the
 * first; further ones are named in the area or on the command line.
 */

/**
 * Whether somebody is an operator, and whether this session carries the
 * second factor the area needs: the app set up, or a sign in with a passkey
 * confirmed on the device (#167), as for the role of an owner.
 */
export async function operatorAccess(
  database: Database,
  userId: string,
  sessionId: string,
): Promise<InstanceAccess> {
  const [row] = await database.forInstance(
    (tx) =>
      tx
        .select({
          operator: instanceOperators.id,
          twoFactorEnabled: authUsers.twoFactorEnabled,
          signInMethod: authSessions.signInMethod,
        })
        .from(authUsers)
        .leftJoin(instanceOperators, eq(instanceOperators.userId, authUsers.id))
        .leftJoin(
          authSessions,
          and(eq(authSessions.id, sessionId), eq(authSessions.userId, authUsers.id)),
        )
        .where(eq(authUsers.id, userId)),
    userId,
  )

  return {
    operator: Boolean(row?.operator),
    secondFactor: hasSecondFactor({
      twoFactorEnabled: row?.twoFactorEnabled,
      signInMethod: row?.signInMethod,
    }),
  }
}

/**
 * Whether an account has a second factor to sign in with: the app, or a
 * passkey, which only signs in when confirmed on the device (#167).
 */
export const secondFactorSetUp = sql<boolean>`(${authUsers.twoFactorEnabled} is true or exists (
  select 1 from auth_passkeys where auth_passkeys.user_id = ${authUsers.id}))`

export async function listOperators(database: Database, asUser: string): Promise<OperatorView[]> {
  const rows = await database.forInstance(
    (tx) =>
      tx
        .select({
          userId: authUsers.id,
          name: authUsers.name,
          email: authUsers.email,
          since: instanceOperators.createdAt,
          secondFactor: secondFactorSetUp,
        })
        .from(instanceOperators)
        .innerJoin(authUsers, eq(authUsers.id, instanceOperators.userId))
        .orderBy(asc(instanceOperators.createdAt)),
    asUser,
  )

  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    since: row.since.toISOString(),
    secondFactor: row.secondFactor === true,
  }))
}

/**
 * Two operators taking each other out at the same moment would leave the
 * instance with none. Every change to the list waits for the one before it.
 */
const operatorsLock = sql`select pg_advisory_xact_lock(hashtext('opengewerk.instance_operators'))`

/** Names an account that already exists on the instance as an operator. */
export async function appointOperator(
  database: Database,
  byUser: string,
  email: string,
  reason = 'operator.appoint',
): Promise<OperatorView> {
  const wanted = normalise(email)

  if (!wanted.includes('@')) {
    throw new BadRequestException('Die E-Mail-Adresse sieht nicht wie eine aus.')
  }

  const appointed = await database.forInstance(
    async (tx) => {
      await tx.execute(operatorsLock)

      const [account] = await tx
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(sql`lower(${authUsers.email})`, wanted))

      if (!account) {
        throw new NotFoundException(
          'Ein Konto mit dieser Adresse gibt es auf dieser Instanz nicht.',
        )
      }

      const inserted = await tx
        .insert(instanceOperators)
        .values({ userId: account.id })
        .onConflictDoNothing()
        .returning({ id: instanceOperators.id })

      if (inserted.length === 0) {
        throw new ConflictException('Dieses Konto ist schon Betreiber.')
      }

      return account.id
    },
    byUser,
    reason,
  )

  const operators = await listOperators(database, byUser)
  const found = operators.find((operator) => operator.userId === appointed)

  if (!found) {
    throw new Error('An operator vanished between its appointment and the list.')
  }

  return found
}

/** Takes the role away. Not from oneself, and never from the last one. */
export async function removeOperator(
  database: Database,
  byUser: string,
  userId: string,
): Promise<void> {
  if (userId === byUser) {
    throw new ConflictException('Sich selbst entfernt kein Betreiber; das macht ein anderer.')
  }

  await database.forInstance(
    async (tx) => {
      await tx.execute(operatorsLock)

      const all = await tx.select({ userId: instanceOperators.userId }).from(instanceOperators)

      if (!all.some((operator) => operator.userId === userId)) {
        throw new NotFoundException('Dieses Konto ist kein Betreiber.')
      }

      if (all.length <= 1) {
        throw new ConflictException('Der letzte Betreiber bleibt.')
      }

      await tx.delete(instanceOperators).where(eq(instanceOperators.userId, userId))
    },
    byUser,
    'operator.remove',
  )
}
