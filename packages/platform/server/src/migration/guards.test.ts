import { describe, expect, it } from 'vitest'

import {
  attachmentsGuard,
  attachmentVersionsGuard,
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

  it('hangs the triggers a table has of its own after those two, each on its function', () => {
    const sealed: TableGuard = {
      ...record,
      triggers: [
        { name: 'probe_records_signed', fires: 'BEFORE INSERT', calls: 'sign_probe_record' },
        {
          name: 'probe_records_stay',
          fires: 'BEFORE UPDATE OR DELETE',
          calls: 'probe_record_stays',
        },
      ],
    }

    expect(triggerStatements(sealed).slice(2)).toEqual([
      'CREATE TRIGGER "probe_records_signed" BEFORE INSERT ON "probe_records"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "sign_probe_record"();',
      'CREATE TRIGGER "probe_records_stay" BEFORE UPDATE OR DELETE ON "probe_records"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "probe_record_stays"();',
    ])
    expect(triggerStatements({ ...sealed, audited: false, synced: false })).toHaveLength(2)
    expect(triggerStatements(record)).toHaveLength(2)
  })

  it('refuses a trigger whose name, function or moment is not a plain one', () => {
    const hung = (trigger: object): TableGuard => ({
      ...record,
      triggers: [
        { name: 'probe_stay', fires: 'BEFORE INSERT', calls: 'probe_stays', ...trigger } as never,
      ],
    })

    expect(() => triggerStatements(hung({ name: 'stay" ON "tenants' }))).toThrow(/Not a name/)
    expect(() => triggerStatements(hung({ calls: 'stays"(); DROP TABLE x; --' }))).toThrow(
      /Not a name/,
    )
    expect(() => triggerStatements(hung({ fires: 'INSTEAD OF INSERT' }))).toThrow(
      /Not a moment a trigger fires at/,
    )
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

describe('the files in the records of a tenant, where an application keeps them', () => {
  it('are marked and never removed, and travel and are watched like every record', () => {
    // Watched in two halves (#658): what is changed or deleted while the
    // document goes for good is not copied into the log.
    expect(guardStatements(attachmentsGuard)).toEqual([
      'ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;',
      'GRANT SELECT, INSERT, UPDATE ON "attachments" TO "opengewerk_app";',
      'CREATE TRIGGER "audit_changes" AFTER INSERT ON "attachments"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "record_change"();',
      'CREATE TRIGGER "audit_changes_unless_purged" AFTER UPDATE OR DELETE ON "attachments"\n' +
        '\tFOR EACH ROW WHEN (NOT (public.attachment_purging(old.id))) EXECUTE FUNCTION "record_change"();',
      'CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "attachments"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();',
    ])
  })

  it('have versions that are read and inserted, and deleted only with their document, with who stored one and the bolt', () => {
    // DELETE is granted, and the bolt lets a deletion through only while the
    // document goes for good on the way an application opens (#658). The
    // trigger after it takes the files of the version, which the application
    // itself may not delete.
    expect(guardStatements(attachmentVersionsGuard)).toEqual([
      'ALTER TABLE "attachment_versions" FORCE ROW LEVEL SECURITY;',
      'GRANT SELECT, INSERT, DELETE ON "attachment_versions" TO "opengewerk_app";',
      'CREATE TRIGGER "audit_changes" AFTER INSERT ON "attachment_versions"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "record_change"();',
      'CREATE TRIGGER "audit_changes_unless_purged" AFTER UPDATE OR DELETE ON "attachment_versions"\n' +
        '\tFOR EACH ROW WHEN (NOT (public.attachment_purging(old.attachment_id))) EXECUTE FUNCTION "record_change"();',
      'CREATE TRIGGER "stamp_sync_columns" BEFORE INSERT OR UPDATE ON "attachment_versions"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "stamp_sync_columns"();',
      'CREATE TRIGGER "attachment_versions_record_uploader" BEFORE INSERT ON "attachment_versions"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "record_attachment_uploader"();',
      'CREATE TRIGGER "attachment_versions_take_their_files" AFTER DELETE ON "attachment_versions"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "version_takes_its_files"();',
      'CREATE TRIGGER "attachment_versions_stay_as_written" BEFORE UPDATE OR DELETE ON "attachment_versions"\n' +
        '\tFOR EACH ROW EXECUTE FUNCTION "attachment_version_stays_as_written"();',
    ])
  })
})

describe('the tables of the foundation', () => {
  it('are each described once', () => {
    const tables = foundationGuards.map((guard) => guard.table)

    expect(new Set(tables).size).toBe(tables.length)
    expect(tables).toHaveLength(33)
  })

  it('give the application nothing but reading on what only a trigger writes', () => {
    const writtenByTrigger = ['audit_chains', 'audit_entries', 'sync_sequences', 'instance_changes']

    for (const table of writtenByTrigger) {
      expect(foundationGuards.find((guard) => guard.table === table)?.grants).toEqual(['select'])
    }
  })

  it('let the application add to what records one moment, and neither change nor remove it', () => {
    // A correction of an account, a new password and a change of the mail
    // server of the instance, as a tenant learns of them: written once, and
    // whoever wrote one has no way to take it back (opengewerk-haustechnik#360).
    for (const table of [
      'account_corrections',
      'password_resets',
      'account_mail_server_changes',
      'second_factor_changes',
    ]) {
      expect(foundationGuards.find((guard) => guard.table === table)?.grants).toEqual([
        'select',
        'insert',
      ])
    }
  })

  it('let nothing that names a tenant be deleted by the application, its roles and its mail server aside', () => {
    // Who was let in, by whom and what became of it is part of the record. A
    // person is blocked and an invitation called back, both changes the log
    // keeps; a row that can be removed is a record with a hole in it. A role
    // and the mail server of a tenant are settings and no record: a role the
    // tenant made is removed again (opengewerk/opengewerk-haustechnik#346),
    // a mail server is set up and removed again, and the log keeps both. A
    // file goes only with the last version of a document that goes for good,
    // taken by the trigger of the version and not by the application (#658).
    const ofATenant = foundationGuards.filter(
      (guard) => !guard.table.startsWith('auth_') && !guard.table.startsWith('instance_'),
    )

    expect(ofATenant).toHaveLength(22)
    expect(
      ofATenant.filter((guard) => guard.grants.includes('delete')).map((guard) => guard.table),
    ).toEqual(['tenant_roles', 'mail_settings'])
  })

  it('let the application name and take away who runs the instance, change its settings, and no more', () => {
    // Who runs the instance is a row that is there or not: taking it away is
    // the delete, and the log of the instance keeps that it happened. The
    // settings are one row that is changed and never added to or removed,
    // and the log is read. None of the three is watched by the trigger of a
    // tenant: they have none, and a trigger of their own instead.
    const ofTheInstance = Object.fromEntries(
      foundationGuards
        .filter((guard) => guard.table.startsWith('instance_'))
        .map((guard) => [guard.table, { grants: guard.grants, audited: guard.audited }]),
    )

    expect(ofTheInstance).toEqual({
      instance_operators: { grants: ['select', 'insert', 'delete'], audited: false },
      instance_settings: { grants: ['select', 'update'], audited: false },
      instance_changes: { grants: ['select'], audited: false },
    })
  })

  it('watch what a tenant may see of its people, its files, its mail server and its settings of deadlines, and nothing that has no tenant', () => {
    expect(
      foundationGuards
        .filter((guard) => guard.audited)
        .map((guard) => guard.table)
        .sort(),
    ).toEqual([
      'account_corrections',
      'account_mail_server_changes',
      'audit_redactions',
      'deadline_settings',
      'files',
      'invitations',
      'mail_settings',
      'member_passkeys',
      'memberships',
      'password_resets',
      'second_factor_changes',
      'tenant_roles',
      'tenant_sessions',
      'tenants',
    ])
  })
})
