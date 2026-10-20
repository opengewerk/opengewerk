import type { DeadlineKind, DeadlineSetting, TenantId } from '@opengewerk/platform-domain'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { beforeItsEnd } from '../authentication/last-day.js'
import { leadsItsTenant } from '../authentication/roles.js'
import type { TenantTransaction } from '../database/database.js'
import { memberships } from '../database/schema/memberships.js'

/** What of a deadline decides who answers for it. */
export interface ResponsibleFacts {
  readonly responsibleUserId: string | null
  readonly naturalUserId: string | null
}

/** One deadline of many, with the kind and the setting that apply to it. */
export interface ResponsibleQuestion<Key, Row extends ResponsibleFacts = ResponsibleFacts> {
  readonly key: Key
  readonly kind: DeadlineKind
  readonly setting: DeadlineSetting | null
  readonly deadline: Row
}

/**
 * Which of the people that come into question may answer for each of these
 * deadlines, as the application sees it (opengewerk-haustechnik#473). The
 * foundation knows no places; an application that keeps its deadlines in
 * places not everybody sees answers here, so that nobody is reminded of a
 * deadline in a place they do not see, and somebody who sees it is. Asked
 * once for all the deadlines of a question, each with the people in their
 * order; the answer has, at the same position, the ones who may.
 */
export type MayAnswer<Row> = (
  tx: TenantTransaction,
  asked: readonly { readonly deadline: Row; readonly userIds: readonly string[] }[],
) => Promise<readonly ReadonlySet<string>[]>

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
        // Nor past the last day of their access.
        beforeItsEnd(),
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
  return (await leadsInOrder(tx, tenantId, 1))[0] ?? null
}

/**
 * Everybody who leads the tenant and is not blocked, the one longest in it
 * first: the last ones a deadline may wait with, where the application asks
 * whether they may (`MayAnswer`) and the first of them does not see it.
 */
async function leadsInOrder(
  tx: TenantTransaction,
  tenantId: TenantId,
  limit?: number,
): Promise<readonly string[]> {
  const query = tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        isNull(memberships.blockedAt),
        beforeItsEnd(),
        leadsItsTenant(),
      ),
    )
    .orderBy(asc(memberships.createdAt), asc(memberships.userId))
  const leads = await (limit === undefined ? query : query.limit(limit))

  return leads.map((lead) => lead.userId)
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
 * Where the application keeps its deadlines in places not everybody sees, it
 * is asked as well (`mayAnswer`, opengewerk-haustechnik#473): a deadline then
 * waits with the first in the same order who may answer for it, the people
 * who lead included, and with nobody where nobody may.
 *
 * Otherwise null only in a tenant without anybody who leads and can sign in,
 * which the administration does not let happen.
 */
export async function responsibleForAll<Key, Row extends ResponsibleFacts = ResponsibleFacts>(
  tx: TenantTransaction,
  tenantId: TenantId,
  questions: readonly ResponsibleQuestion<Key, Row>[],
  mayAnswer?: MayAnswer<Row>,
): Promise<Map<Key, string | null>> {
  const asked = questions.map((question) => ({
    key: question.key,
    candidates: candidatesOf(question.kind, question.setting, question.deadline),
  }))
  const here = await whoWorksHere(tx, tenantId, [
    ...new Set(asked.flatMap((question) => question.candidates)),
  ])
  const answers = new Map<Key, string | null>()

  if (mayAnswer !== undefined) {
    const leads = await leadsInOrder(tx, tenantId)
    const chains = asked.map((question) => [
      ...new Set([...question.candidates.filter((candidate) => here.has(candidate)), ...leads]),
    ])
    const allowed = await mayAnswer(
      tx,
      questions.map((question, at) => ({ deadline: question.deadline, userIds: chains[at] ?? [] })),
    )

    asked.forEach((question, at) => {
      answers.set(question.key, chains[at]?.find((userId) => allowed[at]?.has(userId)) ?? null)
    })

    return answers
  }

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
export async function responsibleFor<Row extends ResponsibleFacts>(
  tx: TenantTransaction,
  tenantId: TenantId,
  kind: DeadlineKind,
  setting: DeadlineSetting | null,
  deadline: Row,
  mayAnswer?: MayAnswer<Row>,
): Promise<string | null> {
  const answers = await responsibleForAll(
    tx,
    tenantId,
    [{ key: true, kind, setting, deadline }],
    mayAnswer,
  )

  return answers.get(true) ?? null
}
