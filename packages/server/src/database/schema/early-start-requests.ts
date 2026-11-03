import { longestDeviceInfo, longestSignaturePath, longestSignerName } from '@opengewerk/domain'
import {
  primaryId,
  reference,
  syncColumns,
  tenantIsolation,
  timestamps,
} from '@opengewerk/platform-server'
import { tenantColumn } from '@opengewerk/platform-server/schema'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

import { jobs } from './jobs.js'

/**
 * The request for an early start a consumer signs at the door (#292): the
 * instructions of a service call shown on the device, and under the request
 * the customer's name and signature, like a report. Inserted from a device
 * and never changed or deleted; the database grants reading and inserting
 * only, and checks that the job is a service call for a consumer. Who signed
 * on whose device: `created_by` the database writes, as for a note.
 */
export const earlyStartRequests = pgTable(
  'early_start_requests',
  {
    id: primaryId<'early-start-request'>(),
    ...tenantColumn,
    jobId: reference<'job'>('job_id').notNull(),
    signerName: text('signer_name').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
    deviceInfo: text('device_info'),
    path: text('path').notNull(),
    contentFingerprint: text('content_fingerprint').notNull(),
    createdBy: text('created_by'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('early_start_requests_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'early_start_requests_job_in_tenant',
    }).onDelete('restrict'),
    check(
      'early_start_requests_signer_named',
      sql`length(btrim(${table.signerName})) between 1 and ${sql.raw(String(longestSignerName))}`,
    ),
    check(
      'early_start_requests_path_shape',
      sql`${table.path} ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$' and length(${table.path}) <= ${sql.raw(String(longestSignaturePath))}`,
    ),
    check(
      'early_start_requests_device_info_short',
      sql`${table.deviceInfo} is null or length(${table.deviceInfo}) <= ${sql.raw(String(longestDeviceInfo))}`,
    ),
    index('early_start_requests_job_idx').on(table.tenantId, table.jobId, table.signedAt),
  ],
)
