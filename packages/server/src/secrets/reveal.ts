import {
  type ConflictReason,
  type Identity,
  isAllowed,
  type SiteAccessId,
} from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'

import type { TenantTransaction } from '../database/database.js'
import { isUuid } from '../database/identifier.js'
import { siteAccessDeliveries } from '../database/schema/index.js'

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
 * only if a pull handed it to them, and every such pull left a row in
 * `site_access_deliveries`. That row is the measure, and not the job as it
 * is now: a showing in a cellar arrives after the job was closed, closed for
 * longer than a device keeps it, or moved to another site, and it happened
 * all the same (Greptile on #445). A showing of a value never handed to the
 * person would put in the record that somebody saw a code they never had,
 * and is a conflict about this one operation.
 */
export async function revealRefusal(
  tx: TenantTransaction,
  sender: Identity,
  values: Readonly<Record<string, unknown>>,
): Promise<RevealRefusal | null> {
  const accessId = values['siteAccessId']

  if (!isUuid(accessId)) {
    return { reason: 'record_missing', fields: ['siteAccessId'] }
  }

  if (isAllowed(sender, 'site.access')) {
    return null
  }

  const [delivered] = await tx
    .select({ id: siteAccessDeliveries.id })
    .from(siteAccessDeliveries)
    .where(
      and(
        eq(siteAccessDeliveries.siteAccessId, accessId as SiteAccessId),
        eq(siteAccessDeliveries.userId, sender.userId),
      ),
    )
    .limit(1)

  return delivered ? null : { reason: 'record_missing', fields: ['siteAccessId'] }
}
