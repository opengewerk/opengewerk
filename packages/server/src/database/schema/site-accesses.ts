import { accessDesignationMaxLength, accessHintMaxLength } from '@opengewerk/domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

import { sites } from './sites.js'

/**
 * The ways into a site (#286): the key safe, the code of the alarm, the
 * remote of the garage. What each opens and a hint in words stand here and in
 * the audit log; the value does not. It is sealed in `secrets` under the
 * purpose `site_access` and the id of this row, and `value_set_at` is all the
 * log learns of it: that it was set, and when.
 *
 * Kept in the office at the routes of the site, with `site.access`; a device
 * reads the rows and writes none. Which device gets which rows, and which of
 * them with the value, the pull decides (`database/device-scope.ts`).
 * Deleting marks the row and forgets the sealed value at once.
 */
export const siteAccesses = pgTable(
  'site_accesses',
  {
    id: primaryId<'site-access'>(),
    ...tenantColumn,
    siteId: reference<'site'>('site_id').notNull(),
    designation: text('designation').notNull(),
    hint: text('hint'),
    valueSetAt: timestamp('value_set_at', { withTimezone: true }),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('site_accesses_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.siteId],
      foreignColumns: [sites.tenantId, sites.id],
      name: 'site_accesses_site_in_tenant',
    }).onDelete('restrict'),
    index('site_accesses_site_idx').on(table.tenantId, table.siteId),
    // What `accessProblem` asks before anything reaches this table.
    check(
      'site_accesses_designation_shaped',
      sql`char_length(btrim(${table.designation})) between 1 and ${sql.raw(String(accessDesignationMaxLength))}`,
    ),
    check(
      'site_accesses_hint_bounded',
      sql`${table.hint} is null or char_length(${table.hint}) <= ${sql.raw(String(accessHintMaxLength))}`,
    ),
  ],
)

/**
 * Every time the value of an access was shown (#286), one row each: on the
 * device of a technician, written through the outbox and so also without a
 * network, or by the route that hands the value to the office. Who it was the
 * database writes from the request (`record_time_owner`, as for working time),
 * and the row is never changed; the audit log keeps it with everything else.
 */
export const siteAccessReveals = pgTable(
  'site_access_reveals',
  {
    id: primaryId<'site-access-reveal'>(),
    ...tenantColumn,
    siteAccessId: reference<'site-access'>('site_access_id').notNull(),
    userId: text('user_id').notNull(),
    revealedAt: timestamp('revealed_at', { withTimezone: true }).notNull(),
    // Which value was shown, by when it was set: the route writes the one it
    // opened, a device the one it held. Empty only on a showing from somebody
    // who keeps the ways in and wrote it without saying (#286).
    valueSetAt: timestamp('value_set_at', { withTimezone: true }),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.siteAccessId],
      foreignColumns: [siteAccesses.tenantId, siteAccesses.id],
      name: 'site_access_reveals_access_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'site_access_reveals_person_works_here',
    }).onDelete('restrict'),
    index('site_access_reveals_access_idx').on(table.tenantId, table.siteAccessId),
    index('site_access_reveals_person_idx').on(table.tenantId, table.userId),
  ],
)

/**
 * Which device got which value of which access, for which person (#286): a
 * row the first time a pull hands that value to that device, never changed
 * after. The value is named by when it was set, the device by the session
 * the pull came with. A showing written on a device is taken only for a value
 * that device got this way (`revealRefusal`), whatever became of the job
 * since, moved to another site or closed long ago, and not for a newer value
 * it never held; and the audit log says which devices held which code.
 * Written by the pull and by nothing else, not in the sync.
 */
export const siteAccessDeliveries = pgTable(
  'site_access_deliveries',
  {
    id: primaryId<'site-access-delivery'>(),
    ...tenantColumn,
    siteAccessId: reference<'site-access'>('site_access_id').notNull(),
    userId: text('user_id').notNull(),
    deviceId: text('device_id').notNull(),
    valueSetAt: timestamp('value_set_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.siteAccessId],
      foreignColumns: [siteAccesses.tenantId, siteAccesses.id],
      name: 'site_access_deliveries_access_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'site_access_deliveries_person_works_here',
    }).onDelete('restrict'),
    unique('site_access_deliveries_once').on(
      table.tenantId,
      table.siteAccessId,
      table.userId,
      table.deviceId,
      table.valueSetAt,
    ),
  ],
)
