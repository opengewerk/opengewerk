import { type ConflictReason, isAllowed, type SiteAccessId } from '@opengewerk/domain'
import { and, eq } from 'drizzle-orm'

import type { FoundIdentity } from '../api/identity.js'
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
 * only if a pull handed it to that very device, and every such pull left a
 * row in `site_access_deliveries` with the person, the device of the session
 * and when the value was set. A showing names the value it showed the same
 * way, and is taken only when that row is there. Not the job as it is now,
 * since a showing in a cellar arrives after the job was closed, closed for
 * longer than a device keeps it, or moved to another site, and it happened
 * all the same; and not the person alone, since a person handed one code
 * once did not see the next on a device that never held it (Greptile on
 * #445). Any other showing would put in the record that somebody saw a code
 * they never had, and is a conflict about this one operation.
 */
export async function revealRefusal(
  tx: TenantTransaction,
  sender: FoundIdentity,
  values: Readonly<Record<string, unknown>>,
): Promise<RevealRefusal | null> {
  const accessId = values['siteAccessId']

  if (!isUuid(accessId)) {
    return { reason: 'record_missing', fields: ['siteAccessId'] }
  }

  if (isAllowed(sender, 'site.access')) {
    return null
  }

  // As the sync hands it over for a timestamp column: a date, or the text a
  // caller outside the sync may pass.
  const shown = values['valueSetAt']
  const at = shown instanceof Date ? shown : typeof shown === 'string' ? new Date(shown) : null

  if (sender.deviceId === undefined || at === null || Number.isNaN(at.getTime())) {
    return { reason: 'record_missing', fields: ['siteAccessId', 'valueSetAt'] }
  }

  const [delivered] = await tx
    .select({ id: siteAccessDeliveries.id })
    .from(siteAccessDeliveries)
    .where(
      and(
        eq(siteAccessDeliveries.siteAccessId, accessId as SiteAccessId),
        eq(siteAccessDeliveries.userId, sender.userId),
        eq(siteAccessDeliveries.deviceId, sender.deviceId),
        eq(siteAccessDeliveries.valueSetAt, at),
      ),
    )
    .limit(1)

  return delivered ? null : { reason: 'record_missing', fields: ['siteAccessId', 'valueSetAt'] }
}
