import { timeEntryKinds } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { jobs } from './jobs.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

export const timeEntryKind = pgEnum('time_entry_kind', timeEntryKinds)

/**
 * Somebody's working time, one stretch per row (#76), the record § 17 MiLoG
 * asks for.
 *
 * Written once and never changed. The grant stops at INSERT and a trigger
 * refuses every change to everybody, and a deletion until the record has been
 * kept for as long as the law says (migration 0036). A correction is a new row
 * that names the old one, and one row can be corrected once, which the unique
 * index says: two corrections of the same entry would leave two answers to
 * what it should have been.
 *
 * `user_id` is written by a trigger from the request, like the author of a
 * task, and carries no key: it records whose time it is, and a record of that
 * must not be something a later change to an account can take away.
 */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: primaryId<'time-entry'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    kind: timeEntryKind('kind').notNull(),
    jobId: reference<'job'>('job_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    note: text('note'),
    correctsEntryId: reference<'time-entry'>('corrects_entry_id'),
    withdrawn: boolean('withdrawn').notNull().default(false),
    startLatitudeMicro: integer('start_latitude_micro'),
    startLongitudeMicro: integer('start_longitude_micro'),
    endLatitudeMicro: integer('end_latitude_micro'),
    endLongitudeMicro: integer('end_longitude_micro'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('time_entries_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'time_entries_job_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.correctsEntryId],
      foreignColumns: [table.tenantId, table.id],
      name: 'time_entries_correction_in_tenant',
    }).onDelete('restrict'),
    uniqueIndex('time_entries_corrected_once')
      .on(table.tenantId, table.correctsEntryId)
      .where(sql`${table.correctsEntryId} is not null`),
    check('time_entries_end_after_start', sql`${table.endedAt} > ${table.startedAt}`),
    check(
      'time_entries_at_most_a_day',
      sql`${table.endedAt} - ${table.startedAt} <= interval '24 hours'`,
    ),
    check(
      'time_entries_withdraw_a_correction',
      sql`not ${table.withdrawn} or ${table.correctsEntryId} is not null`,
    ),
    index('time_entries_user_idx').on(table.tenantId, table.userId, table.startedAt),
    index('time_entries_job_idx').on(table.tenantId, table.jobId),
  ],
)

/**
 * Somebody's answers to whether their place may be recorded with their time,
 * one row per answer and never changed. The latest counts; the earlier ones
 * are the record of when consent was given and withdrawn. Not synced: consent
 * is given and withdrawn with a connection, and a device asks for the current
 * answer.
 */
export const locationConsents = pgTable(
  'location_consents',
  {
    id: primaryId<'location-consent'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    given: boolean('given').notNull(),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    index('location_consents_user_idx').on(table.tenantId, table.userId, table.createdAt),
  ],
)
