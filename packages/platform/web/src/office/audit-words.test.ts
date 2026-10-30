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
    'note-on-the-shelf': {
      table: 'notes',
      field: 'text',
      title: 'Zange fehlt',
      kind: null,
      at: { table: 'shelves', id: ids.shelf },
    },
    'long-note-on-the-shelf': {
      table: 'notes',
      field: 'text',
      title: 'Zange '.repeat(30),
      kind: null,
      at: { table: 'shelves', id: ids.shelf },
    },
    'note-on-a-shelf-unknown': {
      table: 'notes',
      field: 'text',
      title: 'Zange fehlt',
      kind: null,
      at: { table: 'shelves', id: 'not-on-the-page' },
    },
    'note-on-a-note': {
      table: 'notes',
      field: 'text',
      title: 'Auch hier',
      kind: null,
      at: { table: 'notes', id: 'note-on-the-shelf' },
    },
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
    expect(words.auditValue('letter_lines', 'basis_points', '2250', page)).toBe('22,5 %')
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
    // What a browser handed over for push, which an application had to name
    // on its own page until the foundation did. Only on the table it is on.
    for (const field of ['endpoint', 'p256dh', 'auth']) {
      expect([field, words.auditValue('push_subscriptions', field, 'BNcRdreALRFX', page)]).toEqual([
        field,
        'gesetzt',
      ])
    }

    expect(words.auditValue('shelves', 'auth', 'offen', page)).toBe('offen')
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

  it('names each record a list in a field points at, in either form the database keeps one', () => {
    expect(
      words.auditValue('notes', 'about_letters', `["${ids.letter}", "${ids.reminder}"]`, page),
    ).toBe('Wartung im Oktober, Zweite Erinnerung')
    expect(words.auditValue('notes', 'about_letters', `{${ids.letter}}`, page)).toBe(
      'Wartung im Oktober',
    )
    // One the page has no name for is said to be what it is, never its key.
    expect(
      words.auditValue('notes', 'about_letters', `["${ids.letter}", "${ids.shelf}x"]`, page),
    ).toBe('Wartung im Oktober, Brief ohne Bezeichnung')
    // No record is no value, and the screen says "leer".
    expect(words.auditValue('notes', 'about_letters', '[]', page)).toBeNull()
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

// The log holds whatever was written. A value that is called like something
// every object carries is a value like any other, and no word for it.
describe('a value called like what every list carries', () => {
  it('is read as it is written where the words have no entry for it', () => {
    for (const raw of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(words.auditValue('letters', 'status', raw, page)).toBe(raw)
      expect(words.auditValue('shelves', 'labels', `{${raw},red}`, page)).toBe(`${raw}, Rot`)
      expect(words.auditValue('memberships', 'roles', `{${raw},lead}`, page)).toBe(
        `${raw}, Leitung`,
      )
      expect(words.auditValue('tenant_roles', 'rights', `{${raw}}`, page)).toBe(raw)
      expect(words.auditValue('memberships', 'user_id', raw, page)).toBe(
        'Eine Person, die es nicht mehr gibt',
      )
      expect(words.recordTitle('notes', raw, page)).toBe('Notiz ohne Bezeichnung')
      expect(words.recordKind('letters', raw, page)).toBe('Brief')
      expect(words.deviceWords(raw, page)).toBe(`Gerät ${raw}`)
      expect(words.wayWords(change({ userId: raw }), page).person).toBe(
        'Eine Person, die es nicht mehr gibt',
      )
    }
  })
})

// What a field holds as structured data the application reads elsewhere in
// its own words, and says here how (opengewerk-haustechnik#263).
describe('a value the application writes its own way', () => {
  const own = auditWords({
    ...probeAuditWords,
    written: (table, field, raw, format) => {
      if (table !== 'shelves' || field !== 'layout') {
        return null
      }

      const layout = JSON.parse(raw) as { rows?: number; since?: string; note?: string }

      return [
        layout.rows === undefined ? null : `Reihen: ${String(layout.rows)}`,
        layout.since === undefined ? null : `Seit: ${format.date(layout.since)}`,
        layout.note ?? null,
      ]
        .filter((part) => part !== null)
        .join(', ')
    },
  })

  it('is read as the application writes it, with the days of whoever reads', () => {
    expect(own.auditValue('shelves', 'layout', '{"rows": 4, "since": "2026-10-03"}', page)).toBe(
      'Reihen: 4, Seit: 03.10.2026',
    )
  })

  it('is no value where the application writes nothing for it, and is cut like any other text', () => {
    expect(own.auditValue('shelves', 'layout', '{}', page)).toBeNull()
    expect(
      own.auditValue('shelves', 'layout', JSON.stringify({ note: 'x'.repeat(400) }), page),
    ).toBe(`${'x'.repeat(300)}…`)
  })

  it('is left to the rules here where the application has no way of its own', () => {
    expect(own.auditValue('shelves', 'closed', 'true', page)).toBe('Ja')
    expect(own.auditValue('letters', 'status', 'sent', page)).toBe('Verschickt')
    expect(own.auditValue('notes', 'layout', '{"rows": 4}', page)).toBe('{"rows": 4}')
  })

  it('is never asked for a field whose value the page keeps to itself', () => {
    const asked: string[] = []
    const discreet = auditWords({
      ...probeAuditWords,
      hidden: ['lock_code', 'layout'],
      written: (_table, field) => {
        asked.push(field)

        return 'verraten'
      },
    })

    expect(discreet.auditValue('shelves', 'layout', '{"rows": 4}', page)).toBe(
      discreet.auditValue('shelves', 'lock_code', '4711', page),
    )
    expect(asked).toEqual([])
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

  it('tells a record apart by what it stands at, after its own name', () => {
    expect(words.recordTitle('notes', 'note-on-the-shelf', page)).toBe('Zange fehlt, Werkzeug')
    // The name is cut to its length first, and where it stands is said whole.
    expect(words.recordTitle('notes', 'long-note-on-the-shelf', page)).toBe(
      `${'Zange '.repeat(30).slice(0, 80).trimEnd()}…, Werkzeug`,
    )
  })

  it('says the own name alone where the page has no name for what the record stands at, and goes one step and no further', () => {
    expect(words.recordTitle('notes', 'note-on-a-shelf-unknown', page)).toBe('Zange fehlt')
    expect(words.recordTitle('notes', 'note-on-a-note', page)).toBe('Auch hier, Zange fehlt')
  })

  it('reads a value that points at a record behind a prefix as that record, and every other value of the field as before', () => {
    expect(words.auditValue('letters', 'status', `after-${ids.letter}`, page)).toBe(
      'Wartung im Oktober',
    )
    expect(words.auditValue('letters', 'status', 'after-not-on-the-page', page)).toBe(
      'Brief ohne Bezeichnung',
    )
    expect(words.auditValue('letters', 'status', 'sent', page)).toBe('Verschickt')
    expect(words.auditValue('letters', 'status', 'after-', page)).toBe('after-')
    // Another field with the same beginning is a text like any other.
    expect(words.auditValue('letters', 'subject', `after-${ids.letter}`, page)).toBe(
      `after-${ids.letter}`,
    )
  })

  it('keeps a value to itself behind a prefix as well, where the field is one the page does not spell out', () => {
    const discreet = auditWords({ ...probeAuditWords, hidden: ['lock_code', 'status'] })

    expect(discreet.auditValue('notes', 'status', `after-${ids.letter}`, page)).toBe(
      discreet.auditValue('shelves', 'lock_code', '4711', page),
    )
    expect(discreet.auditValue('notes', 'status', `after-${ids.letter}`, page)).not.toContain(
      'Wartung',
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
    expect(words.changeSummary(change({ operation: 'insert' }), page)).toBe('Angelegt')
    expect(words.changeSummary(change({ operation: 'delete' }), page)).toBe('Entfernt')
    expect(
      words.changeSummary(
        change({ fields: [{ field: 'deleted_at', before: null, after: '2026-10-03T10:00:00Z' }] }),
        page,
      ),
    ).toBe('Als gelöscht markiert')
    expect(
      words.changeSummary(
        change({ fields: [{ field: 'deleted_at', before: '2026-10-03T10:00:00Z', after: null }] }),
        page,
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
        page,
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
    expect(words.changeSummary(moved, page)).toBe(
      'Beschriftung, Fassung, Geändert am und 1 weitere',
    )
    expect(
      words.changeSummary(
        change({ fields: [{ field: 'id', before: null, after: ids.shelf }] }),
        page,
      ),
    ).toBe('Ohne sichtbare Änderung')
  })

  it('names the values where one or two fields moved, as the opened change reads them', () => {
    const moved = (table: string, ...fields: AuditChange['fields']) =>
      words.changeSummary(change({ table, fields }), page)

    expect(moved('shelves', { field: 'closed', before: 'false', after: 'true' })).toBe(
      'Geschlossen: Nein → Ja',
    )
    // In the application's words for a value, and by the name of a record.
    expect(moved('letters', { field: 'status', before: 'sent', after: 'draft' })).toBe(
      'Stand: Verschickt → Entwurf',
    )
    expect(moved('notes', { field: 'shelf_id', before: null, after: ids.shelf })).toBe(
      'Regal: leer → Werkzeug',
    )
    expect(moved('shelves', { field: 'label', before: 'Werkzeug', after: null })).toBe(
      'Beschriftung: Werkzeug → leer',
    )
    // Two fields, the naming one first.
    expect(
      moved(
        'shelves',
        { field: 'closed', before: 'false', after: 'true' },
        { field: 'label', before: 'Werkzeug', after: 'Messgeräte' },
      ),
    ).toBe('Beschriftung: Werkzeug → Messgeräte, Geschlossen: Nein → Ja')
    // Three are named and not spelled out.
    expect(
      moved(
        'shelves',
        { field: 'closed', before: 'false', after: 'true' },
        { field: 'label', before: 'Werkzeug', after: 'Messgeräte' },
        { field: 'text', before: null, after: 'Neu' },
      ),
    ).toBe('Beschriftung, Geschlossen, Text')
  })

  it('says only what happened to a field whose value is long or reads the same', () => {
    const moved = (field: string, before: string | null, after: string | null) =>
      words.changeSummary(change({ table: 'notes', fields: [{ field, before, after }] }), page)
    const long = 'Die Zange liegt seit gestern im Keller.'

    expect(moved('text', null, long)).toBe('Text neu')
    expect(moved('text', long, `${long} Und der Hammer auch.`)).toBe('Text geändert')
    expect(moved('text', long, null)).toBe('Text entfernt')
    // One long side is enough: half a pair says nothing.
    expect(moved('text', 'Kurz', long)).toBe('Text geändert')
    // Twenty-four characters are spelled out, the twenty-fifth is one too many.
    expect(moved('text', 'Kurz', 'x'.repeat(24))).toBe(`Text: Kurz → ${'x'.repeat(24)}`)
    expect(moved('text', 'Kurz', 'x'.repeat(25))).toBe('Text geändert')
    // What the log keeps to itself reads as set before and after.
    expect(moved('lock_code', '1234', '9876')).toBe('lock_code geändert')
    expect(moved('lock_code', null, '9876')).toBe('lock_code: leer → gesetzt')
    // An empty text and none are both empty.
    expect(moved('text', '', null)).toBe('Text geändert')
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
