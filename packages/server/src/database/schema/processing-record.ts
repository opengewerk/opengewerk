import { primaryId, tenantIsolation, timestamps } from '@opengewerk/platform-server'
import { applicationRole, tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, pgPolicy, pgTable, text, unique } from 'drizzle-orm/pg-core'

import { personLeads } from './erasures.js'

/**
 * What whoever leads the business wrote for the record of the processing
 * (#319, Art. 30 DSGVO): who is responsible, the data protection officer and
 * what the business processes outside the application, as typed. One row per
 * business; without one the record proposes the letterhead and says that
 * nobody confirmed it. Written by whoever leads, as the policies say; the
 * route asks first, so that a refusal is a sentence.
 */
export const processingRecordSettings = pgTable(
  'processing_record_settings',
  {
    id: primaryId<'processing-record-setting'>(),
    ...tenantColumn,
    controller: text('controller'),
    officer: text('officer'),
    outside: text('outside'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    pgPolicy('settings_written_by_whoever_leads', {
      as: 'restrictive',
      for: 'insert',
      to: applicationRole,
      withCheck: personLeads,
    }),
    pgPolicy('settings_changed_by_whoever_leads', {
      as: 'restrictive',
      for: 'update',
      to: applicationRole,
      using: personLeads,
      withCheck: personLeads,
    }),
    unique('processing_record_settings_once').on(table.tenantId),
  ],
)

/**
 * What whoever leads the business wrote for one activity of the record
 * (#319): the purpose and the legal basis it confirmed or changed, null while
 * the proposal of the application stands, and the recipients, which the
 * answer to a request for access names too (#318). One row per business and
 * activity; taking the proposal back sets purpose and legal basis to null
 * again, so a row is never removed. The key of the activity is the one of
 * `processingActivities` in `domain`; a row of an activity the application no
 * longer knows stays out of the record.
 */
export const processingRecordActivities = pgTable(
  'processing_record_activities',
  {
    id: primaryId<'processing-record-activity'>(),
    ...tenantColumn,
    activity: text('activity').notNull(),
    purpose: text('purpose'),
    legalBasis: text('legal_basis'),
    recipients: text('recipients'),
    ...timestamps,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    pgPolicy('activities_written_by_whoever_leads', {
      as: 'restrictive',
      for: 'insert',
      to: applicationRole,
      withCheck: personLeads,
    }),
    pgPolicy('activities_changed_by_whoever_leads', {
      as: 'restrictive',
      for: 'update',
      to: applicationRole,
      using: personLeads,
      withCheck: personLeads,
    }),
    unique('processing_record_activities_once').on(table.tenantId, table.activity),
    // Confirmed is both or neither: a purpose of the owner beside the
    // proposed legal basis would be a record nobody confirmed as a whole.
    check(
      'processing_record_activities_confirmed_whole',
      sql`(${table.purpose} is null) = (${table.legalBasis} is null)`,
    ),
  ],
)
