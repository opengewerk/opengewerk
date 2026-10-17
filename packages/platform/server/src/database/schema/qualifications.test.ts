import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { qualificationSchema } from './qualifications.js'

// The tables of the qualifications as an application makes them (ADR 0012),
// asked of the tables and of no database. What a database makes of them, the
// tests of the application that binds them hold.

const columnsOf = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name)

describe('the tables of the qualifications', () => {
  it('travel: both carry the columns of the sync, and keep the tenants apart', () => {
    const travelling = ['version', 'updated_by', 'device_id', 'deleted_at', 'change_sequence']

    for (const table of Object.values(qualificationSchema())) {
      expect(columnsOf(table)).toEqual(expect.arrayContaining(travelling))
      expect(getTableConfig(table).policies.map((policy) => policy.name)).toContain(
        'tenant_isolation',
      )
    }
  })

  it('hold in the database that a qualification is of somebody here, of exactly one kind, with a stored certificate', () => {
    const { qualifications, qualificationKinds } = qualificationSchema()

    expect(getTableConfig(qualifications).foreignKeys.map((key) => key.getName())).toEqual(
      expect.arrayContaining([
        'qualifications_of_somebody_here',
        'qualifications_of_an_own_kind',
        'qualifications_certificate_stored',
      ]),
    )
    expect(getTableConfig(qualifications).checks.map((each) => each.name)).toEqual(
      expect.arrayContaining(['qualifications_one_kind', 'qualifications_certificate_is_a_hash']),
    )
    expect(getTableConfig(qualificationKinds).checks.map((each) => each.name)).toEqual(
      expect.arrayContaining(['qualification_kinds_level_known']),
    )
    expect(columnsOf(qualifications)).toEqual(
      expect.arrayContaining([
        'user_id',
        'kind_key',
        'own_kind_id',
        'valid_until',
        'certificate_sha256',
      ]),
    )
  })
})
