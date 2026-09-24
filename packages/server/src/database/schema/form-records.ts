import { formRecordStatuses, longestFormValues } from '@opengewerk/domain'
import { sql } from 'drizzle-orm'
import { check, date, foreignKey, index, integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { installations } from './installations.js'
import { jobs } from './jobs.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

export const formRecordStatus = pgEnum('form_record_status', formRecordStatuses)

/**
 * A filled form (#78), a test protocol at an installation first (#79).
 *
 * Travels like a report: made on site, changed while it is a draft, and fixed
 * once the signature that seals it is given, which the sync policy asks
 * before and a trigger of migration 0043 holds behind. The values are one
 * field of JSON text, shaped by the definition named in key and version:
 * text and not `jsonb`, because the sync carries plain values and compares a
 * field by what a device saw in it, and `jsonb` would hand back a string
 * other than the one written. Which definition it is, and whether the values
 * fit it, the server asks the registry of the trade packages, as the device
 * does before it sends.
 */
export const formRecords = pgTable(
  'form_records',
  {
    id: primaryId<'form-record'>(),
    ...tenantColumn,
    definitionKey: text('definition_key').notNull(),
    definitionVersion: integer('definition_version').notNull(),
    installationId: reference<'installation'>('installation_id').notNull(),
    jobId: reference<'job'>('job_id'),
    performedOn: date('performed_on').notNull(),
    status: formRecordStatus('status').notNull().default('draft'),
    values: text('values').notNull().default('{}'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.installationId],
      foreignColumns: [installations.tenantId, installations.id],
      name: 'form_records_installation_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'form_records_job_in_tenant',
    }).onDelete('restrict'),
    check('form_records_version_positive', sql`${table.definitionVersion} > 0`),
    check(
      'form_records_values_bounded',
      sql`char_length(${table.values}) <= ${sql.raw(String(longestFormValues))}`,
    ),
    index('form_records_installation_idx').on(table.tenantId, table.installationId),
  ],
)
