import {
  closedJobsStayDays,
  type ConflictReason,
  type Identity,
  isAllowed,
} from '@opengewerk/domain'
import { sql } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'

/** Why a showing from a device may not land, in the shape of a sync conflict. */
export interface RevealRefusal {
  readonly reason: ConflictReason
  readonly fields: readonly string[]
}

/**
 * Whether a device can have shown the value its showing names (#286).
 *
 * Whoever keeps the ways in may see every value at the route, so a trace of
 * theirs is always one that could have happened. Anybody else held a value
 * only on the device, and only for a site of a job they were on: the job
 * open, or closed less than `closedJobsStayDays` ago, since a showing in a
 * cellar can arrive after the job was closed. A showing of any other access
 * would put in the record that somebody saw a code they never had (Greptile
 * on #445), and is a conflict about this one operation.
 *
 * An assignment or job that was deleted since still counts: it says the
 * device held the site then, which is what the trace is about.
 */
export async function revealRefusal(
  tx: TenantTransaction,
  sender: Identity,
  values: Readonly<Record<string, unknown>>,
  now: Date = new Date(),
): Promise<RevealRefusal | null> {
  const accessId = values['siteAccessId']

  if (!isUuid(accessId)) {
    return { reason: 'record_missing', fields: ['siteAccessId'] }
  }

  if (isAllowed(sender, 'site.access')) {
    return null
  }

  const since = new Date(now.getTime() - closedJobsStayDays * 24 * 60 * 60 * 1000)
  const { rows } = await tx.execute(sql`
    select 1
      from site_accesses sa
      join jobs j on j.site_id = sa.site_id and j.tenant_id = sa.tenant_id
      join job_assignments a on a.job_id = j.id and a.tenant_id = j.tenant_id
     where sa.id = ${accessId}
       and a.user_id = ${sender.userId}
       and (j.status in ('draft', 'active') or j.closed_at >= ${since.toISOString()})
     limit 1`)

  return rows.length > 0 ? null : { reason: 'record_missing', fields: ['siteAccessId'] }
}
