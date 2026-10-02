import { describe, expect, it } from 'vitest'

import {
  foundationGuards,
  guardStatements,
  protectionStatements,
  type TableGuard,
  triggerStatements,
} from './guards.js'

// What a table needs beyond its columns, as statements. The database is the
// judge of whether they do what they say, in `foundation.test.ts`; here it is
// what gets written, and what is refused before anything is written.

const record: TableGuard = {
  table: 'probe_records',
  grants: ['update', 'select', 'insert'],
  audited: true,
  synced: true,
}

describe('what guards a table', () => {
  it('forces row level security first and grants in a fixed order', () => {
    expect(protectionStatements(record)).toEqual([
      'ALTER TABLE "probe_records" FORCE ROW LEVEL SECURITY;',
      'GRANT SELECT, INSERT, UPDATE ON "probe_records" TO "opengewerk_app";',
    ])
  })

  it('grants single columns on a table that is not updatable as a whole', () => {
    const guard: TableGuard = {
      table: 'probe_names',
      grants: ['select'],
      updatableColumns: ['name', 'updated_at'],
      audited: false,
      synced: false,
    }

    expect(protectionStatements(guard)).toEqual([
      'ALTER TABLE "probe_names" FORCE ROW LEVEL SECURITY;',
      'GRANT SELECT ON "probe_names" TO "opengewerk_app";',
      'GRANT UPDATE ("name", "updated_at") ON "probe_names" TO "opengewerk_app";',
    ])
  })

  it('forces a table nobody is granted anything on, and grants nothing', () => {
    // FORCE is not a consequence of a grant. A table without one is still a
    // table the owner would otherwise read past every policy.
    expect(
      protectionStatements({ table: 'probe_closed', grants: [], audited: false, synced: false }),
    ).toEqual(['ALTER TABLE "probe_closed" FORCE ROW LEVEL SECURITY;'])
  })

  it('refuses columns named beside an update of the whole table', () => {
    // The two together say nothing more than the first alone, and a reader
    // would take the list for a limit that is not there.
    expect(() => protectionStatements({ ...record, updatableColumns: ['name'] })).toThrow(
      /updatable as a whole/,
    )
  })

  it('hangs the audit trigger and the stamp under the names the catalogue is asked for', () => {
    expect(triggerStatements(record)).toEqual([
      'CREATE TRIGGER "audit_changes" AFTER INSERT OR UPDATE OR DELETE ON "probe_records"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "record_change"();',
      'CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "probe_records"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();',
    ])
    expect(triggerStatements({ ...record, audited: false, synced: false })).toEqual([])
  })

  it('puts the protection before the triggers when both are asked for at once', () => {
    expect(guardStatements(record)).toEqual([
      ...protectionStatements(record),
      ...triggerStatements(record),
    ])
  })

  it.each(['Probe', 'probe-records', 'probe records', 'probe"; drop table tenants; --', ''])(
    'refuses %j as the name of a table',
    (table) => {
      // The names come from code and never from a request. They go into a
      // statement all the same, so only what needs no quoting rule is taken.
      expect(() => protectionStatements({ ...record, table })).toThrow(/Not a name/)
      expect(() => triggerStatements({ ...record, table })).toThrow(/Not a name/)
    },
  )

  it('refuses a column that is not a plain name', () => {
    expect(() =>
      protectionStatements({
        table: 'probe_names',
        grants: ['select'],
        updatableColumns: ['name) TO PUBLIC; --'],
        audited: false,
        synced: false,
      }),
    ).toThrow(/Not a name/)
  })
})

describe('the tables of the foundation', () => {
  it('are each described once', () => {
    const tables = foundationGuards.map((guard) => guard.table)

    expect(new Set(tables).size).toBe(tables.length)
    expect(tables).toHaveLength(18)
  })

  it('give the application nothing but reading on what only a trigger writes', () => {
    const writtenByTrigger = ['audit_chains', 'audit_entries', 'sync_sequences']

    for (const table of writtenByTrigger) {
      expect(foundationGuards.find((guard) => guard.table === table)?.grants).toEqual(['select'])
    }
  })

  it('let nothing that names a tenant be deleted by the application', () => {
    // Who was let in, by whom and what became of it is part of the record. A
    // person is blocked and an invitation called back, both changes the log
    // keeps; a row that can be removed is a record with a hole in it.
    const ofATenant = foundationGuards.filter((guard) => !guard.table.startsWith('auth_'))

    expect(ofATenant.filter((guard) => guard.grants.includes('delete'))).toEqual([])
  })

  it('watch what a tenant may see of its people, and nothing that has no tenant', () => {
    expect(
      foundationGuards
        .filter((guard) => guard.audited)
        .map((guard) => guard.table)
        .sort(),
    ).toEqual([
      'invitations',
      'member_passkeys',
      'memberships',
      'tenant_roles',
      'tenant_sessions',
      'tenants',
    ])
  })
})
