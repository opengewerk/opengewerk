import { absenceKinds, absenceLimits, absenceStates, federalStates } from '@opengewerk/domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
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

import { people } from './people.js'

export const absenceKind = pgEnum('absence_kind', absenceKinds)

export const absenceState = pgEnum('absence_state', absenceStates)

const known = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '))

/**
 * Leave and sickness of the people of the business (#288, Feature-Gliederung
 * 4.9), a span of days either end of which may be half.
 *
 * What the database holds besides the tenant: the person is one of this
 * business, the days are in order, one day is not half twice over, a
 * sickness carries no note and is never asked for. A sickness has no column
 * for its reason; nothing here could hold one.
 *
 * `decided_by` names who approved or turned down a request, like
 * `updated_by` without a key, so that a later change to an account cannot
 * take the record away. The rows travel to no device: a person reads their
 * own absences online, as their file.
 */
export const absences = pgTable(
  'absences',
  {
    id: primaryId<'absence'>(),
    ...tenantColumn,
    personId: reference<'person'>('person_id').notNull(),
    kind: absenceKind('kind').notNull(),
    state: absenceState('state').notNull(),
    firstDay: date('first_day').notNull(),
    lastDay: date('last_day').notNull(),
    startsAtNoon: boolean('starts_at_noon').notNull().default(false),
    endsAtNoon: boolean('ends_at_noon').notNull().default(false),
    note: text('note'),
    answer: text('answer'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('absences_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.personId],
      foreignColumns: [people.tenantId, people.id],
      name: 'absences_of_somebody_here',
    }),
    index('absences_of_a_person').on(table.tenantId, table.personId, table.firstDay),
    check('absences_days_in_order', sql`${table.lastDay} >= ${table.firstDay}`),
    check(
      'absences_not_half_twice',
      sql`not (${table.firstDay} = ${table.lastDay} and ${table.startsAtNoon} and ${table.endsAtNoon})`,
    ),
    check(
      'absences_sickness_entered',
      sql`${table.kind} <> 'sickness' or (${table.state} = 'approved' and ${table.note} is null)`,
    ),
    check(
      'absences_note_fits',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${sql.raw(String(absenceLimits.note))}`,
    ),
    check(
      'absences_answer_fits',
      sql`${table.answer} is null or char_length(${table.answer}) between 1 and ${sql.raw(String(absenceLimits.answer))}`,
    ),
  ],
)

/**
 * The days of leave a person has in a year and what came over from the year
 * before, in half days. The office carries a rest over by hand; nothing here
 * lets it run out by itself (#288, decided on 01.11.2026).
 */
export const leaveEntitlements = pgTable(
  'leave_entitlements',
  {
    id: primaryId<'leave-entitlement'>(),
    ...tenantColumn,
    personId: reference<'person'>('person_id').notNull(),
    year: integer('year').notNull(),
    entitledHalfDays: integer('entitled_half_days').notNull().default(0),
    carriedHalfDays: integer('carried_half_days').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('leave_entitlements_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.personId],
      foreignColumns: [people.tenantId, people.id],
      name: 'leave_entitlements_of_somebody_here',
    }),
    uniqueIndex('leave_entitlements_one_a_year')
      .on(table.tenantId, table.personId, table.year)
      .where(sql`${table.deletedAt} is null`),
    check(
      'leave_entitlements_year_known',
      sql`${table.year} between ${sql.raw(String(absenceLimits.firstYear))} and ${sql.raw(String(absenceLimits.lastYear))}`,
    ),
    check(
      'leave_entitlements_half_days_fit',
      sql`${table.entitledHalfDays} between 0 and ${sql.raw(String(absenceLimits.halfDays))}
        and ${table.carriedHalfDays} between 0 and ${sql.raw(String(absenceLimits.halfDays))}`,
    ),
  ],
)

/**
 * Where the business is, for its public holidays (#288, Feature-Gliederung
 * 4.4): the state, and the keys of the local holidays it switched on. One row
 * for a business, written in its settings. Which local holiday belongs to
 * which state the rule package says, not this table.
 */
export const holidaySettings = pgTable(
  'holiday_settings',
  {
    id: primaryId<'holiday-setting'>(),
    ...tenantColumn,
    state: text('state').notNull(),
    localHolidays: text('local_holidays')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('holiday_settings_tenant_id_key').on(table.tenantId, table.id),
    uniqueIndex('holiday_settings_one_a_business')
      .on(table.tenantId)
      .where(sql`${table.deletedAt} is null`),
    check('holiday_settings_state_known', sql`${table.state} in (${known(federalStates)})`),
    check(
      'holiday_settings_local_are_local',
      sql`array_position(${table.localHolidays}, null) is null and coalesce(array_length(${table.localHolidays}, 1), 0) <= 20`,
    ),
  ],
)
