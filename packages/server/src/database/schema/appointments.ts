import { longestAppointmentNote, mostExceptions } from '@opengewerk/domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { memberships, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { jobs } from './jobs.js'

/**
 * An appointment at a job (#290, Feature-Gliederung 4.3), made in the office
 * on the planning board.
 *
 * Written at the route only, with a network: the route puts whoever gets one
 * on its job and tells them by push, which no device could do. Every device
 * reads them (`create: false`, ADR 0005). `revision` counts every change of
 * when it is, so that a confirmation of an earlier version does not hold for
 * the one now. A series keeps its rule as the value of an RRULE and the days
 * taken out as dates in German time, as RFC 5545 has them.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: primaryId<'appointment'>(),
    ...tenantColumn,
    jobId: reference<'job'>('job_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    note: text('note'),
    rrule: text('rrule'),
    exdates: date('exdates', { mode: 'string' })
      .array()
      .$type<readonly string[]>()
      .notNull()
      .default(sql`'{}'::date[]`),
    revision: integer('revision').notNull().default(1),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('appointments_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'appointments_job_in_tenant',
    }).onDelete('restrict'),
    check('appointments_end_after_start', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'appointments_note_fits',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${sql.raw(String(longestAppointmentNote))}`,
    ),
    check(
      'appointments_rule_fits',
      sql`${table.rrule} is null or char_length(${table.rrule}) between 10 and 200`,
    ),
    check(
      'appointments_exdates_of_a_series',
      sql`(${table.rrule} is not null or cardinality(${table.exdates}) = 0)
        and cardinality(${table.exdates}) <= ${sql.raw(String(mostExceptions))}
        and array_position(${table.exdates}, null) is null`,
    ),
    check('appointments_revision_counts', sql`${table.revision} >= 1`),
    index('appointments_of_a_job').on(table.tenantId, table.jobId),
    index('appointments_by_start').on(table.tenantId, table.startsAt),
  ],
)

/**
 * Who goes to an appointment, and which version of it they confirmed.
 *
 * Somebody who works in the business, as the key onto the memberships holds;
 * put on and taken off at the route of the appointment, by marking the row
 * deleted, so that every device learns it. Confirmed is the version in
 * `confirmed_revision`, set at the route of the person who goes.
 */
export const appointmentPeople = pgTable(
  'appointment_people',
  {
    id: primaryId<'appointment-person'>(),
    ...tenantColumn,
    appointmentId: reference<'appointment'>('appointment_id').notNull(),
    userId: text('user_id').notNull(),
    confirmedRevision: integer('confirmed_revision'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.appointmentId],
      foreignColumns: [appointments.tenantId, appointments.id],
      name: 'appointment_people_of_an_appointment',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'appointment_people_work_here',
    }).onDelete('restrict'),
    check(
      'appointment_people_confirmed_together',
      sql`(${table.confirmedRevision} is null) = (${table.confirmedAt} is null)`,
    ),
    uniqueIndex('appointment_people_once')
      .on(table.tenantId, table.appointmentId, table.userId)
      .where(sql`${table.deletedAt} is null`),
    index('appointment_people_of_a_person').on(table.tenantId, table.userId),
  ],
)
