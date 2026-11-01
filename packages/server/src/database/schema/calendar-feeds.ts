import {
  primaryId,
  readableByTheOwner,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, foreignKey, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * The calendar of a person (#291, Feature-Gliederung 4.3): the address their
 * own calendar subscribes to, read only.
 *
 * What stays behind is the SHA-256 of the token in the address, like the link
 * of an invitation: the address is shown once, right after it was made, and a
 * backup of this table opens no calendar. A new address ends the one before
 * it, and ending one sets `ended_at`; nothing is removed. One open at a time
 * for each person in a business, and only for somebody who works there, as
 * the key onto the memberships holds.
 *
 * It does not travel to the devices: a device has no use for the hash, and the
 * address comes from the route that makes it.
 */
export const calendarFeeds = pgTable(
  'calendar_feeds',
  {
    id: primaryId<'calendar-feed'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    // For `calendar_feed_for`, which runs as the owner: under FORCE it would
    // find no address at all.
    readableByTheOwner(),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'calendar_feeds_work_here',
    }).onDelete('restrict'),
    check('calendar_feeds_token_shaped', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    // Across every business: the address alone names the calendar.
    uniqueIndex('calendar_feeds_token').on(table.tokenHash),
    uniqueIndex('calendar_feeds_one_open')
      .on(table.tenantId, table.userId)
      .where(sql`${table.endedAt} is null`),
  ],
)
