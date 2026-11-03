import { longestOnCallNote } from '@opengewerk/domain'
import { primaryId, syncColumns, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * A time of the on-call plan (#293): who is on call from when until when.
 *
 * Kept in the office at its routes, which ask whether the person works in the
 * business; the key onto the memberships holds that for every other way in.
 * Removed by marking the row deleted, so that every device learns it. A
 * device holds the times of its own person, which is what the sync asks when
 * that person makes a service call on call.
 */
export const onCallShifts = pgTable(
  'on_call_shifts',
  {
    id: primaryId<'on-call-shift'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    note: text('note'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'on_call_shifts_person_works_here',
    }).onDelete('restrict'),
    check('on_call_shifts_ends_after_start', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'on_call_shifts_note_short',
      sql`${table.note} is null or length(${table.note}) <= ${sql.raw(String(longestOnCallNote))}`,
    ),
    index('on_call_shifts_person_idx').on(table.tenantId, table.userId, table.startsAt),
    index('on_call_shifts_starts_idx').on(table.tenantId, table.startsAt),
  ],
)
