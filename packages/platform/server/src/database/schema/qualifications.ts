import { personLevels, qualificationLimits } from '@opengewerk/platform-domain'
import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { primaryId, reference, syncColumns, timestamps } from './columns.js'
import { files } from './files.js'
import { memberships } from './memberships.js'
import { tenantIsolation } from './rls.js'
import { tenantColumn } from './tenants.js'

// The qualifications as a building block (ADR 0012): the kinds a tenant adds
// to those of a catalogue, and what each person holds. Tables an application
// makes with this function, like the stock, so that it decides whether it
// keeps them. Both carry the columns of the sync and are marked, never
// removed: a qualification taken out of the records stays in the change log
// with what it said.

/** A text from one character up to the bound. */
const fits = (column: unknown, most: number) =>
  sql`char_length(${column}) between 1 and ${sql.raw(String(most))}`

/** One of the words of a list, as a check of the database. */
const oneOf = (column: unknown, words: readonly string[]) =>
  sql`${column} in (${sql.raw(words.map((word) => `'${word}'`).join(', '))})`

function kindParts() {
  return {
    id: primaryId<'qualification-kind'>(),
    ...tenantColumn,
    label: text('label').notNull(),
    level: text('level').notNull(),
    ...timestamps,
    ...syncColumns,
  }
}

function qualificationParts() {
  return {
    id: primaryId<'qualification'>(),
    ...tenantColumn,
    userId: text('user_id').notNull(),
    kindKey: text('kind_key'),
    ownKindId: reference<'qualification-kind'>('own_kind_id'),
    validUntil: date('valid_until', { mode: 'string' }),
    note: text('note'),
    certificateSha256: text('certificate_sha256'),
    ...timestamps,
    ...syncColumns,
  }
}

/** The tables of the qualifications, as an application binds them. */
export function qualificationSchema() {
  const qualificationKinds = pgTable('qualification_kinds', kindParts(), (table) => [
    tenantIsolation(table.tenantId),
    unique('qualification_kinds_tenant_id_key').on(table.tenantId, table.id),
    // A label once per tenant, however it is written, among those not taken out.
    uniqueIndex('qualification_kinds_label_once')
      .on(table.tenantId, sql`lower(${table.label})`)
      .where(sql`${table.deletedAt} is null`),
    check('qualification_kinds_label_fits', fits(table.label, qualificationLimits.kindLabel)),
    check('qualification_kinds_level_known', oneOf(table.level, personLevels)),
  ])

  const qualifications = pgTable('qualifications', qualificationParts(), (table) => [
    tenantIsolation(table.tenantId),
    unique('qualifications_tenant_id_key').on(table.tenantId, table.id),
    index('qualifications_of_a_person').on(table.tenantId, table.userId),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
      name: 'qualifications_of_somebody_here',
    }),
    foreignKey({
      columns: [table.tenantId, table.ownKindId],
      foreignColumns: [qualificationKinds.tenantId, qualificationKinds.id],
      name: 'qualifications_of_an_own_kind',
    }),
    foreignKey({
      columns: [table.tenantId, table.certificateSha256],
      foreignColumns: [files.tenantId, files.sha256],
      name: 'qualifications_certificate_stored',
    }),
    // Exactly one kind: of a catalogue, or of the tenant's own.
    check('qualifications_one_kind', sql`num_nonnulls(${table.kindKey}, ${table.ownKindId}) = 1`),
    check(
      'qualifications_kind_key_fits',
      sql`${table.kindKey} is null or ${fits(table.kindKey, qualificationLimits.kindKey)}`,
    ),
    check(
      'qualifications_note_fits',
      sql`${table.note} is null or ${fits(table.note, qualificationLimits.note)}`,
    ),
    check(
      'qualifications_certificate_is_a_hash',
      sql`${table.certificateSha256} is null or ${table.certificateSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ])

  return { qualificationKinds, qualifications }
}
