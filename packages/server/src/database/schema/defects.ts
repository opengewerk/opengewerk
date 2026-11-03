import {
  defectStatuses,
  defectSteps as defectStepNames,
  longestDefectDescription,
  longestSignaturePath,
  longestSignerName,
} from '@opengewerk/domain'
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

import { formRecords } from './form-records.js'
import { installations } from './installations.js'
import { jobs } from './jobs.js'

export const defectStatus = pgEnum('defect_status', defectStatuses)
export const defectStep = pgEnum('defect_step', defectStepNames)

/**
 * The defects and complaints of a business (#311): at a job, at an
 * installation or at both, which the check says.
 *
 * `status` is where the defect stands, written by the trigger that takes a
 * step (migration 0119) and by nothing else: the application may not set it,
 * and the sync keeps it for the server. Description, installation and the
 * customer's deadline may be corrected until the defect is accepted; after
 * that a trigger refuses every change. Removing one is marking it deleted,
 * which the same trigger allows only while it is reported, has taken no step
 * and does not come out of an acceptance.
 *
 * A signed acceptance writes one defect for each line of its reservations
 * (migration 0119), named by the protocol and the line, once: the unique
 * index keeps a second signing of the same lines from writing them twice.
 * `created_by` is written from the request, like the author of a note.
 */
export const defects = pgTable(
  'defects',
  {
    id: primaryId<'defect'>(),
    ...tenantColumn,
    jobId: reference<'job'>('job_id'),
    installationId: reference<'installation'>('installation_id'),
    description: text('description').notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by'),
    remedyDueOn: date('remedy_due_on'),
    status: defectStatus('status').notNull().default('reported'),
    acceptanceRecordId: reference<'form-record'>('acceptance_record_id'),
    acceptanceLine: integer('acceptance_line'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    unique('defects_tenant_id_key').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: 'defects_job_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.installationId],
      foreignColumns: [installations.tenantId, installations.id],
      name: 'defects_installation_in_tenant',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.acceptanceRecordId],
      foreignColumns: [formRecords.tenantId, formRecords.id],
      name: 'defects_acceptance_in_tenant',
    }).onDelete('restrict'),
    check('defects_have_a_home', sql`num_nonnulls(${table.jobId}, ${table.installationId}) >= 1`),
    check(
      'defects_described',
      sql`length(btrim(${table.description})) between 1 and ${sql.raw(String(longestDefectDescription))}`,
    ),
    check(
      'defects_acceptance_line',
      sql`(${table.acceptanceRecordId} is null) = (${table.acceptanceLine} is null) and (${table.acceptanceLine} is null or ${table.acceptanceLine} >= 1)`,
    ),
    uniqueIndex('defects_acceptance_line_once').on(table.acceptanceRecordId, table.acceptanceLine),
    index('defects_job_idx').on(table.tenantId, table.jobId),
    index('defects_installation_idx').on(table.tenantId, table.installationId),
  ],
)

/**
 * The steps of a defect (#311), one row each and never changed: the grant
 * stops at INSERT, and a trigger checks that a step follows the one the defect
 * stands at and moves the defect on. `taken_at` is the device's; who took it
 * is written from the request. Only the acceptance carries a signer and a
 * signature, and it always does.
 */
export const defectSteps = pgTable(
  'defect_steps',
  {
    id: primaryId<'defect-step'>(),
    ...tenantColumn,
    defectId: reference<'defect'>('defect_id').notNull(),
    step: defectStep('step').notNull(),
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
    createdBy: text('created_by'),
    signerName: text('signer_name'),
    signaturePath: text('signature_path'),
    ...timestamps,
    ...syncColumns,
  },
  (table) => [
    tenantIsolation(table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.defectId],
      foreignColumns: [defects.tenantId, defects.id],
      name: 'defect_steps_defect_in_tenant',
    }).onDelete('restrict'),
    check(
      'defect_steps_signed_acceptance',
      sql`case when ${table.step} = 'accepted'
        then length(btrim(coalesce(${table.signerName}, ''))) between 1 and ${sql.raw(String(longestSignerName))}
          and ${table.signaturePath} ~ '^(M[0-9]{1,4},[0-9]{1,4}(L[0-9]{1,4},[0-9]{1,4})*)+$'
          and length(${table.signaturePath}) <= ${sql.raw(String(longestSignaturePath))}
        else ${table.signerName} is null and ${table.signaturePath} is null end`,
    ),
    index('defect_steps_defect_idx').on(table.tenantId, table.defectId, table.takenAt),
  ],
)
