import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import type { OperatorView } from '@opengewerk/platform-domain'
import { asc, eq, sql } from 'drizzle-orm'

import { normalise } from '../authentication/administration.js'
import type { Database } from '../database/database.js'
import { authUsers, instanceOperators } from '../schema.js'
import type { InstanceSentences } from './sentences.js'

/**
 * The accounts that run the instance (#188), and the only ones that reach its
 * area. The account of the first run setup is the first; further ones are
 * named in the area or on the command line.
 *
 * Whether somebody is one is asked in `access.ts`, on every request.
 */

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
 * Two of them taking each other out at the same moment would leave the
 * instance with nobody to run it. Every change to the list waits for the one
 * before it.
 */
const operatorsLock = sql`select pg_advisory_xact_lock(hashtext('opengewerk.instance_operators'))`

/** Names an account that already exists on the instance to run it. */
export async function appointOperator(
  database: Database,
  sentences: Pick<InstanceSentences, 'alreadyOperator'>,
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
        throw new ConflictException(sentences.alreadyOperator)
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

/** Takes the instance away from an account. Not from oneself, and never from the last one. */
export async function removeOperator(
  database: Database,
  sentences: Pick<InstanceSentences, 'notOneself' | 'notAnOperator' | 'lastOperator'>,
  byUser: string,
  userId: string,
): Promise<void> {
  if (userId === byUser) {
    throw new ConflictException(sentences.notOneself)
  }

  await database.forInstance(
    async (tx) => {
      await tx.execute(operatorsLock)

      const all = await tx.select({ userId: instanceOperators.userId }).from(instanceOperators)

      if (!all.some((operator) => operator.userId === userId)) {
        throw new NotFoundException(sentences.notAnOperator)
      }

      if (all.length <= 1) {
        throw new ConflictException(sentences.lastOperator)
      }

      await tx.delete(instanceOperators).where(eq(instanceOperators.userId, userId))
    },
    byUser,
    'operator.remove',
  )
}
