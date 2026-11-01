import { personLimits, workingTimeLimits } from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { memberships } from './memberships.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

// The people who work for a tenant as a building block (ADR 0016): a file of
// its own, with an account here or without one, and the working time agreed
// with each from a day on. Tables an application makes with this function,
// like the stock, so that it decides whether it keeps them. Both carry the
// columns of the sync and are marked, never removed: a person who left stays
// in the change log with what their file said.

/** A text from one character up to the bound. */
const fits = (column: unknown, most: number) =>
  sql`char_length(${column}) between 1 and ${sql.raw(String(most))}`

/** The minutes of a day, from none to the whole day. */
const aDay = (column: unknown) =>
  sql`${column} between 0 and ${sql.raw(String(workingTimeLimits.dayMinutes))}`

function personParts() {
  return {
    id: primaryId<'person'>(),
    ...tenantColumn,
    name: text('name').notNull(),
    userId: text('user_id'),
    joinedOn: date('joined_on', { mode: 'string' }),
    leftOn: date('left_on', { mode: 'string' }),
    ...timestamps,
    ...syncColumns,
  }
}

function workingTimeParts() {
  return {
    id: primaryId<'working-time'>(),
    ...tenantColumn,
    personId: reference<'person'>('person_id').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    mondayMinutes: integer('monday_minutes').notNull().default(0),
    tuesdayMinutes: integer('tuesday_minutes').notNull().default(0),
    wednesdayMinutes: integer('wednesday_minutes').notNull().default(0),
    thursdayMinutes: integer('thursday_minutes').notNull().default(0),
    fridayMinutes: integer('friday_minutes').notNull().default(0),
    saturdayMinutes: integer('saturday_minutes').notNull().default(0),
    sundayMinutes: integer('sunday_minutes').notNull().default(0),
    ...timestamps,
    ...syncColumns,
  }
}

/** The tables of the people, as an application binds them. */
export function peopleSchema() {
  const people = pgTable('people', personParts(), (table) => [
    tenantIsolation(table.tenantId),
    unique('people_tenant_id_key').on(table.tenantId, table.id),
    // An account is one person here at most, among those not taken out.
    uniqueIndex('people_one_per_account')
      .on(table.tenantId, table.userId)
      .where(sql`${table.userId} is not null and ${table.deletedAt} is null`),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'people_account_here',
    }),
    check('people_name_fits', fits(table.name, personLimits.name)),
    check(
      'people_leave_after_joining',
      sql`${table.leftOn} is null or ${table.joinedOn} is null or ${table.leftOn} >= ${table.joinedOn}`,
    ),
  ])

  const workingTimes = pgTable('working_times', workingTimeParts(), (table) => [
    tenantIsolation(table.tenantId),
    unique('working_times_tenant_id_key').on(table.tenantId, table.id),
    // One working time from a day for a person, among those not taken out.
    uniqueIndex('working_times_one_from_a_day')
      .on(table.tenantId, table.personId, table.validFrom)
      .where(sql`${table.deletedAt} is null`),
    index('working_times_of_a_person').on(table.tenantId, table.personId),
    foreignKey({
      columns: [table.tenantId, table.personId],
      foreignColumns: [people.tenantId, people.id],
      name: 'working_times_of_a_person_here',
    }),
    check(
      'working_times_a_day_at_most',
      sql`${aDay(table.mondayMinutes)} and ${aDay(table.tuesdayMinutes)} and ${aDay(table.wednesdayMinutes)}
        and ${aDay(table.thursdayMinutes)} and ${aDay(table.fridayMinutes)}
        and ${aDay(table.saturdayMinutes)} and ${aDay(table.sundayMinutes)}`,
    ),
  ])

  return { people, workingTimes }
}

/** The people of an application, made with `peopleSchema`. */
export type PeopleTables = ReturnType<typeof peopleSchema>
