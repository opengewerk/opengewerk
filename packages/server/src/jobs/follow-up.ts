import { type ConflictReason, followUpProblem, type JobStatus } from '@opengewerk/domain'
import { and, eq, isNull, ne } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { jobs } from '../database/schema/index.js'

/**
 * Why a job may not stand as it would after a write (#170), in the two kinds
 * the sync tells apart: a mistake only the client can make, and one that
 * somebody else's change caused while the device was away.
 */
export type FollowUpRefusal =
  | { readonly kind: 'client'; readonly message: string }
  | {
      readonly kind: 'conflict'
      readonly reason: ConflictReason
      readonly fields: readonly string[]
      readonly message: string
    }

const fixed = 'Der Vorgänger eines Folgeauftrags steht mit dem Anlegen fest.'
const followed = 'Auf diesen Auftrag folgen Aufträge für seinen Kunden, er bleibt bei ihm.'

/**
 * Whether a write to a job leaves its place among follow-ups intact.
 *
 * A follow-up names a finished job of the same customer, `followUpProblem` in
 * `domain`, and which job that is is fixed when it is created. A job that has
 * follow-ups keeps its customer. The trigger of migration 0040 holds all of
 * that too, but inside the transaction, where it takes a whole transmission
 * down; asked here first, the sync makes it a conflict about one operation
 * and a route a sentence.
 *
 * Which kind a refusal is: a job that names itself, or a predecessor changed
 * after the fact, is something the form never sends, and the answer is the
 * sentence. A predecessor that is no longer finished or no longer the
 * customer's, and a customer that no longer fits, is what happens when
 * somebody else changed the other job meanwhile: the device could not know.
 *
 * `id` is the job's, null for one the server is about to make, which has none
 * yet; `current` is the row as it stands, null when the job is being created.
 * A predecessor that is missing is not this function's question; the check of
 * the references answers it first, for this field like for every other.
 */
export async function followUpRefusal(
  tx: TenantTransaction,
  id: string | null,
  values: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>> | null,
): Promise<FollowUpRefusal | null> {
  if (
    current !== null &&
    'predecessorJobId' in values &&
    (values['predecessorJobId'] ?? null) !== (current['predecessorJobId'] ?? null)
  ) {
    return { kind: 'client', message: fixed }
  }

  const standing = (field: string) => (field in values ? values[field] : current?.[field])
  const customerId = standing('customerId')
  const predecessorId = standing('predecessorJobId')
  const customerChanges =
    current !== null && 'customerId' in values && values['customerId'] !== current['customerId']

  if (typeof predecessorId === 'string' && (current === null || customerChanges)) {
    const [before] = await tx
      .select({ id: jobs.id, customerId: jobs.customerId, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, predecessorId as never))

    if (before) {
      const problem = followUpProblem(
        { id: id ?? '', customerId: String(customerId) },
        {
          id: before.id,
          customerId: before.customerId,
          // Only when the follow-up is made: a finished job taken up again
          // later keeps the follow-ups it had.
          status: current === null ? (before.status as JobStatus) : 'completed',
        },
      )

      if (problem !== null) {
        return before.id === id
          ? { kind: 'client', message: problem }
          : {
              kind: 'conflict',
              reason: 'changed_elsewhere',
              fields: [customerChanges ? 'customerId' : 'predecessorJobId'],
              message: problem,
            }
      }
    }
  }

  if (customerChanges && id !== null) {
    const [follower] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.predecessorJobId, id as never),
          ne(jobs.customerId, String(customerId) as never),
          isNull(jobs.deletedAt),
        ),
      )
      .limit(1)

    if (follower) {
      return {
        kind: 'conflict',
        reason: 'changed_elsewhere',
        fields: ['customerId'],
        message: followed,
      }
    }
  }

  return null
}
