import type { AuditChange, AuditPage } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { euros } from '../format.js'
import { probeAuditWords } from '../probe-application.js'
import { auditWords } from './audit-words.js'

/**
 * The values of the change log in words a person reads (ADR 0010), for an
 * application that belongs to nobody: its shelves, notes and letters, its
 * tenants called "Mandant". What the database wrote as `true`, `12500` or a
 * key reads as "Ja", an amount and a name; what the foundation's own fields
 * hold the foundation writes, what the application's hold the application
 * says.
 */

const words = auditWords(probeAuditWords)

const ids = {
  shelf: '0199bbbb-0000-7000-8000-000000000001',
  letter: '0199bbbb-0000-7000-8000-000000000002',
  line: '0199bbbb-0000-7000-8000-000000000003',
  reminder: '0199bbbb-0000-7000-8000-000000000004',
  membership: '0199bbbb-0000-7000-8000-000000000005',
  nameless: '0199bbbb-0000-7000-8000-000000000006',
  long: '0199bbbb-0000-7000-8000-000000000007',
}

const page: AuditPage = {
  changes: [],
  next: null,
  titles: {
    [ids.shelf]: { table: 'shelves', field: 'label', title: 'Werkzeug', kind: null },
    [ids.letter]: { table: 'letters', field: 'subject', title: 'Wartung im Oktober', kind: null },
    [ids.line]: { table: 'letter_lines', field: 'letter_id', title: ids.letter, kind: null },
    [ids.reminder]: {
      table: 'letters',
      field: 'subject',
      title: 'Zweite Erinnerung',
      kind: 'reminder',
    },
    [ids.membership]: { table: 'memberships', field: 'user_id', title: 'mia', kind: null },
    [ids.nameless]: { table: 'notes', field: null, title: null, kind: null },
    [ids.long]: { table: 'notes', field: 'text', title: 'Zange '.repeat(30), kind: null },
  },
  people: { mia: 'Mia Mitglied' },
  devices: {
    'device-mia': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile Safari/604.1',
  },
}

function change(over: Partial<AuditChange>): AuditChange {
  return {
    changeId: 'change-1',
    changedAt: '2026-10-03T12:32:00Z',
    operation: 'update',
    table: 'shelves',
    recordId: ids.shelf,
    userId: 'mia',
    deviceId: null,
    reason: 'shelves.write',
    databaseRole: 'opengewerk_app',
    firstSequence: 1,
    lastSequence: 1,
    fields: [],
    ...over,
  }
}

describe('the values of the change log', () => {
  it("writes a key in the application's words, and one of the foundation in its own", () => {
    expect(words.auditValue('letters', 'status', 'sent', page)).toBe('Verschickt')
    expect(words.auditValue('letters', 'status', 'lost', page)).toBe('lost')
    expect(words.auditValue('tenant_sessions', 'sign_in_method', 'passkey', page)).toBe('Passkey')
  })

  it('writes amounts, thousandths, days, moments and yes or no as a person reads them', () => {
    expect(words.auditValue('letter_lines', 'total_cents', '12500', page)).toBe(euros(12500))
    expect(words.auditValue('letter_lines', 'weight_milli', '2500', page)).toBe('2,5')
    expect(words.auditValue('letters', 'sent_on', '2026-10-03', page)).toBe('03.10.2026')
    expect(words.auditValue('shelves', 'closed', 'true', page)).toBe('Ja')
    expect(words.auditValue('shelves', 'closed', 'false', page)).toBe('Nein')
    expect(words.auditValue('letters', 'sent_at', '2026-10-03T10:00:00Z', page)).toMatch(
      /^03\.10\.2026, \d{2}:00$/,
    )
  })

  it("writes roles and rights in the application's words, and keeps one it does not know", () => {
    expect(words.auditValue('memberships', 'roles', '{lead,member}', page)).toBe(
      'Leitung, Mitglied',
    )
    expect(words.auditValue('invitations', 'roles', '["guest"]', page)).toBe('Gast')
    expect(words.auditValue('tenant_roles', 'rights', '{notes.write,shelf.burn}', page)).toBe(
      'Notizen schreiben, shelf.burn',
    )
    // No right is no value, and the screen says "leer".
    expect(words.auditValue('tenant_roles', 'rights', '{}', page)).toBeNull()
  })

  it('writes a list of keys the application names, in either form the database keeps one', () => {
    expect(words.auditValue('shelves', 'labels', '{red,blue}', page)).toBe('Rot, Blau')
    expect(words.auditValue('shelves', 'labels', '["blue","green"]', page)).toBe('Blau, green')
  })

  it('never shows a hidden value and shortens a fingerprint', () => {
    expect(words.auditValue('invitations', 'token_hash', 'f'.repeat(64), page)).toBe('gesetzt')
    expect(words.auditValue('shelves', 'lock_code', '4711', page)).toBe('gesetzt')
    expect(words.auditValue('notes', 'checksum', 'a'.repeat(64), page)).toBe(`${'a'.repeat(12)}…`)
  })

  it('names people, devices and the records a field points at', () => {
    expect(words.auditValue('memberships', 'user_id', 'mia', page)).toBe('Mia Mitglied')
    expect(words.auditValue('invitations', 'invited_by', 'gone', page)).toBe(
      'Eine Person, die es nicht mehr gibt',
    )
    expect(words.auditValue('notes', 'shelf_id', ids.shelf, page)).toBe('Werkzeug')
    expect(words.auditValue('notes', 'device_id', 'device-mia', page)).toBe('Safari auf iPhone')
  })

  it('writes the settings of the instance as they were set', () => {
    expect(
      words.auditValue('instance_settings', 'mail_internal_hosts', '{mail.lan,10.0.0.2}', page),
    ).toBe('mail.lan, 10.0.0.2')
    expect(words.auditValue('instance_settings', 'mail_internal_hosts', '{}', page)).toBeNull()
    expect(words.auditValue('instance_settings', 'backup_time', '03:15:00', page)).toBe('03:15')
  })

  it('writes an empty value as nothing, and cuts a long text', () => {
    expect(words.auditValue('notes', 'text', null, page)).toBeNull()
    expect(words.auditValue('notes', 'text', '', page)).toBeNull()
    expect(words.auditValue('notes', 'text', 'x'.repeat(400), page)).toBe(`${'x'.repeat(300)}…`)
  })
})

describe('records and devices', () => {
  it('names a record from the log, and says what it is where it has no name', () => {
    expect(words.recordTitle('shelves', ids.shelf, page)).toBe('Werkzeug')
    expect(words.recordTitle('memberships', ids.membership, page)).toBe('Mia Mitglied')
    expect(words.recordTitle('notes', ids.nameless, page)).toBe('Notiz ohne Bezeichnung')
    expect(words.recordTitle('notes', 'not-on-the-page', page)).toBe('Notiz ohne Bezeichnung')
    expect(words.recordTitle('notes', ids.long, page)).toBe(
      `${'Zange '.repeat(30).slice(0, 80).trimEnd()}…`,
    )
  })

  it('names a part by the record it belongs to', () => {
    expect(words.recordTitle('letter_lines', ids.line, page)).toBe('Wartung im Oktober')
  })

  it("says what sort of record it is in the application's words where the table alone does not", () => {
    expect(words.recordKind('letters', ids.reminder, page)).toBe('Mahnung')
    expect(words.recordKind('letters', ids.letter, page)).toBe('Brief')
    expect(words.recordKind('memberships', ids.membership, page)).toBe('Zugang')
  })

  it('names a device by its browser while it is known, and by the end of its id after', () => {
    expect(words.deviceWords('device-mia', page)).toBe('Safari auf iPhone')
    expect(words.deviceWords('0199a3f2-7c1d-7b2e-9f3a-8c4e2a91b7d3', page)).toBe('Gerät 91B7D3')
    expect(words.deviceWords('probe-tablet', page)).toBe('Gerät probe-tablet')
  })

  it('opens a record where the application has a screen for it', () => {
    expect(words.recordHref('shelves', ids.shelf)).toBe(`/regale/${ids.shelf}`)
    expect(words.recordHref('notes', ids.nameless)).toBeNull()
    expect(words.recordLinkWords('letters')).toBe('Zum Brief')
    expect(words.recordLinkWords('notes')).toBe('Zum Datensatz')
  })
})

describe('a change in a few words', () => {
  it('says what happened to the record where one word says it', () => {
    expect(words.changeSummary(change({ operation: 'insert' }))).toBe('Angelegt')
    expect(words.changeSummary(change({ operation: 'delete' }))).toBe('Entfernt')
    expect(
      words.changeSummary(
        change({ fields: [{ field: 'deleted_at', before: null, after: '2026-10-03T10:00:00Z' }] }),
      ),
    ).toBe('Als gelöscht markiert')
    expect(
      words.changeSummary(
        change({ fields: [{ field: 'deleted_at', before: '2026-10-03T10:00:00Z', after: null }] }),
      ),
    ).toBe('Wiederhergestellt')
  })

  it("says it in the application's word where it has one", () => {
    expect(
      words.changeSummary(
        change({
          table: 'letters',
          recordId: ids.letter,
          fields: [{ field: 'status', before: 'draft', after: 'sent' }],
        }),
      ),
    ).toBe('Verschickt')
  })

  it('names the fields that moved, three and the count of the rest, the naming field first', () => {
    const moved = change({
      fields: [
        { field: 'closed', before: 'false', after: 'true' },
        { field: 'device_id', before: 'one', after: 'two' },
        { field: 'label', before: 'A', after: 'B' },
        { field: 'tenant_id', before: null, after: 't-1' },
        { field: 'updated_at', before: 'x', after: 'y' },
        { field: 'version', before: '1', after: '2' },
      ],
    })

    expect(words.shownFields(moved).map((field) => field.field)).toEqual([
      'label',
      'version',
      'updated_at',
      'closed',
    ])
    expect(words.changeSummary(moved)).toBe('Beschriftung, Fassung, Geändert am und 1 weitere')
    expect(
      words.changeSummary(change({ fields: [{ field: 'id', before: null, after: ids.shelf }] })),
    ).toBe('Ohne sichtbare Änderung')
  })

  it('says who, from where and on which way, and marks a way past the application', () => {
    expect(words.wayWords(change({ deviceId: 'device-mia' }), page)).toEqual({
      person: 'Mia Mitglied',
      device: 'Safari auf iPhone',
      way: 'Regale führen',
      direct: false,
    })
    expect(
      words.wayWords(change({ userId: null, reason: 'tidy', databaseRole: 'postgres' }), page),
    ).toEqual({ person: null, device: null, way: 'Direkt in der Datenbank', direct: true })
  })
})
