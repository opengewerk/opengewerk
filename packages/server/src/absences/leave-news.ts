import type { AbsenceId } from '@opengewerk/domain'
import { stillWorks, type TenantTransaction } from '@opengewerk/platform-server'
import { memberships, tenantRoles } from '@opengewerk/platform-server/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { absences, people } from '../database/schema/index.js'

/**
 * Who hears of leave (#806, Feature-Gliederung 4.9): a request goes to
 * everybody who keeps absences, the decision about it to whoever asked.
 *
 * Asked when the message is written, which is right after the route wrote
 * the change, and asked of the business as it is then: a request withdrawn or
 * decided in the meantime is no longer news, nor is a decision taken back,
 * and somebody blocked or gone hears nothing. Only people of the business the
 * request is in, which the policies of every table read here hold.
 */

/** The days of a request, as the message names them. */
export interface LeaveNews {
  readonly firstDay: string
  readonly lastDay: string
  readonly startsAtNoon: boolean
  readonly endsAtNoon: boolean
}

/** The right whose holders decide about leave. */
const keepsAbsences = 'absence.write'

async function requestOf(tx: TenantTransaction, absenceId: string) {
  const [row] = await tx
    .select({
      state: absences.state,
      kind: absences.kind,
      firstDay: absences.firstDay,
      lastDay: absences.lastDay,
      startsAtNoon: absences.startsAtNoon,
      endsAtNoon: absences.endsAtNoon,
      userId: people.userId,
    })
    .from(absences)
    .innerJoin(people, eq(people.id, absences.personId))
    .where(and(eq(absences.id, absenceId as AbsenceId), isNull(absences.deletedAt)))

  return row ?? null
}

function newsOf(row: NonNullable<Awaited<ReturnType<typeof requestOf>>>): LeaveNews {
  return {
    firstDay: row.firstDay,
    lastDay: row.lastDay,
    startsAtNoon: row.startsAtNoon,
    endsAtNoon: row.endsAtNoon,
  }
}

/**
 * A request still waiting for a decision, and everybody to tell: whoever
 * holds the right to keep absences and still works here, except whoever
 * asked. Null where it is not a waiting request for leave any more.
 */
export async function openRequest(
  tx: TenantTransaction,
  absenceId: string,
  now: Date,
): Promise<{ readonly news: LeaveNews; readonly recipients: readonly string[] } | null> {
  const row = await requestOf(tx, absenceId)

  if (!row || row.state !== 'requested' || row.kind !== 'vacation') {
    return null
  }

  const keepers = await tx
    .select({
      userId: memberships.userId,
      blockedAt: memberships.blockedAt,
      lastDay: memberships.lastDay,
    })
    .from(memberships)
    .where(
      sql`exists (
        select 1 from ${tenantRoles}
         where ${tenantRoles.tenantId} = ${memberships.tenantId}
           and ${tenantRoles.key} = any(${memberships.roles})
           and ${keepsAbsences} = any(${tenantRoles.rights})
      )`,
    )

  const recipients = keepers
    .filter((member) => stillWorks(member, now) && member.userId !== row.userId)
    .map((member) => member.userId)

  return { news: newsOf(row), recipients }
}

/**
 * A decision that still stands, and whoever asked, if they still work here
 * and have an access. Null where the request is gone, undecided or decided the
 * other way by now.
 */
export async function decisionNews(
  tx: TenantTransaction,
  absenceId: string,
  decision: 'approved' | 'rejected',
  now: Date,
): Promise<{ readonly news: LeaveNews; readonly userId: string } | null> {
  const row = await requestOf(tx, absenceId)

  if (!row || row.state !== decision || row.userId === null) {
    return null
  }

  const [member] = await tx
    .select({ blockedAt: memberships.blockedAt, lastDay: memberships.lastDay })
    .from(memberships)
    .where(eq(memberships.userId, row.userId))

  if (!member || !stillWorks(member, now)) {
    return null
  }

  return { news: newsOf(row), userId: row.userId }
}
