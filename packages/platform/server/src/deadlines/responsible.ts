import type { DeadlineKind, DeadlineSetting, TenantId } from '@opengewerk/platform-domain'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { leadsItsTenant } from '../authentication/roles.js'
import type { TenantTransaction } from '../database/database.js'
import { memberships } from '../database/schema/memberships.js'

/** What of a deadline decides who answers for it. */
export interface ResponsibleFacts {
  readonly responsibleUserId: string | null
  readonly naturalUserId: string | null
}

/** One deadline of many, with the kind and the setting that apply to it. */
export interface ResponsibleQuestion<Key> {
  readonly key: Key
  readonly kind: DeadlineKind
  readonly setting: DeadlineSetting | null
  readonly deadline: ResponsibleFacts
}

/**
 * Who of the people named still works for this tenant and may be given
 * something to do, in one query for all of them. A blocked member keeps the
 * membership and would pass the key, but a deadline with somebody who can no
 * longer sign in waits with nobody.
 */
async function whoWorksHere(
  tx: TenantTransaction,
  tenantId: TenantId,
  userIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (userIds.length === 0) {
    return new Set()
  }

  const members = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        inArray(memberships.userId, [...userIds]),
        isNull(memberships.blockedAt),
      ),
    )

  return new Set(members.map((member) => member.userId))
}

/**
 * Whoever leads the tenant, the one longest in it when there are several, and
 * not blocked.
 *
 * Asked of the flag in the row of a role and never of its name, the way the
 * administration counts the last one who leads: a tenant can come to have a
 * second role that leads, and a question asked of a name would miss it.
 */
export async function firstLead(tx: TenantTransaction, tenantId: TenantId): Promise<string | null> {
  const [lead] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), isNull(memberships.blockedAt), leadsItsTenant()))
    .orderBy(asc(memberships.createdAt), asc(memberships.userId))
    .limit(1)

  return lead?.userId ?? null
}

/**
 * The people a deadline may wait with, in the order of the settings: the
 * person the deadline has of its own, then the one the tenant named for the
 * kind, then the one the source names when the kind asks for that.
 */
function candidatesOf(
  kind: DeadlineKind,
  setting: DeadlineSetting | null,
  deadline: ResponsibleFacts,
): readonly string[] {
  return [
    deadline.responsibleUserId,
    setting?.responsibleUserId ?? null,
    kind.responsible === 'source' ? deadline.naturalUserId : null,
  ].filter((candidate): candidate is string => candidate !== null)
}

/**
 * Who answers for each of many deadlines, with the queries of one
 * (opengewerk-haustechnik#31): everybody the deadlines, the settings and the
 * sources name is looked up together, and whoever leads is asked for once,
 * when a deadline gets as far as that. A list that asked one deadline at a
 * time went to the database up to four times a row.
 *
 * The order is the one of the settings: the person the deadline has of its
 * own, then the one the tenant named for the kind, then the one the source
 * names when the kind asks for that, and in the end whoever leads. Somebody
 * blocked in the meantime is passed over, so a deadline never waits with a
 * person who cannot sign in.
 *
 * Null only in a tenant without anybody who leads and can sign in, which the
 * administration does not let happen.
 */
export async function responsibleForAll<Key>(
  tx: TenantTransaction,
  tenantId: TenantId,
  questions: readonly ResponsibleQuestion<Key>[],
): Promise<Map<Key, string | null>> {
  const asked = questions.map((question) => ({
    key: question.key,
    candidates: candidatesOf(question.kind, question.setting, question.deadline),
  }))
  const here = await whoWorksHere(tx, tenantId, [
    ...new Set(asked.flatMap((question) => question.candidates)),
  ])
  const answers = new Map<Key, string | null>()
  let lead: string | null | undefined

  for (const question of asked) {
    const found = question.candidates.find((candidate) => here.has(candidate))

    if (found === undefined && lead === undefined) {
      lead = await firstLead(tx, tenantId)
    }

    answers.set(question.key, found ?? lead ?? null)
  }

  return answers
}

/** Who answers for one deadline, by the same order. */
export async function responsibleFor(
  tx: TenantTransaction,
  tenantId: TenantId,
  kind: DeadlineKind,
  setting: DeadlineSetting | null,
  deadline: ResponsibleFacts,
): Promise<string | null> {
  const answers = await responsibleForAll(tx, tenantId, [{ key: true, kind, setting, deadline }])

  return answers.get(true) ?? null
}
