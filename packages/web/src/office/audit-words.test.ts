import type { AuditChange, AuditPage } from '@opengewerk/domain'
import { euros } from '@opengewerk/platform-web/format'
import { describe, expect, it } from 'vitest'

import { auditValue, changeSummary, deviceWords, recordKind, recordTitle } from './audit-words.js'

/**
 * The values of the change log in the words of the office (#285): what the
 * database wrote as `issued`, `true` or `12500` reads as "Festgeschrieben",
 * "Ja" and "125,00 €", and a key into another record as that record's name.
 */

const page: AuditPage = {
  changes: [],
  next: null,
  titles: {
    'c-1': {
      table: 'customers',
      field: 'name',
      title: 'Hausverwaltung Süd GmbH',
      kind: 'business',
    },
    'd-1': { table: 'documents', field: 'number', title: 'A-2026-0091', kind: 'quote' },
    't-1': {
      table: 'time_entries',
      field: 'started_at',
      title: '2026-09-25T05:30:00Z',
      kind: 'work',
    },
    'm-1': { table: 'memberships', field: 'user_id', title: 'anna', kind: null },
    'x-1': { table: 'sites', field: null, title: null, kind: null },
  },
  people: { anna: 'Anna Weber' },
  devices: {
    'device-anna': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile Safari/604.1',
  },
}

function change(over: Partial<AuditChange>): AuditChange {
  return {
    changeId: 'change-1',
    changedAt: '2026-09-27T12:32:00Z',
    operation: 'update',
    table: 'customers',
    recordId: 'c-1',
    userId: 'anna',
    deviceId: null,
    reason: 'sync.write',
    databaseRole: 'opengewerk_app',
    firstSequence: 1,
    lastSequence: 1,
    fields: [],
    ...over,
  }
}

describe('the values of the change log', () => {
  it('writes keys of a list, amounts, days and yes or no as the office reads them', () => {
    expect(auditValue('documents', 'status', 'issued', page)).toBe('Festgeschrieben')
    expect(auditValue('documents', 'kind', 'quote', page)).toBe('Angebot')
    expect(auditValue('document_lines', 'unit_price_cents', '12500', page)).toBe(euros(12500))
    expect(auditValue('customers', 'tax_exemption_valid_until', '2026-12-31', page)).toBe(
      '31.12.2026',
    )
    expect(auditValue('customers', 'is_business', 'true', page)).toBe('Ja')
    expect(auditValue('customers', 'is_business', 'false', page)).toBe('Nein')
    expect(auditValue('number_ranges', 'key', 'invoice', page)).toBe('Rechnungen')
  })

  it('writes what a role may do in the words of the rights', () => {
    expect(auditValue('tenant_roles', 'rights', '{customer.read,job.progress}', page)).toBe(
      'Kunden ansehen, Aufträge abschließen und Notizen schreiben',
    )
    // A right another version wrote stays readable, and no right is no value.
    expect(auditValue('tenant_roles', 'rights', '["customer.read","shelf.burn"]', page)).toBe(
      'Kunden ansehen, shelf.burn',
    )
    expect(auditValue('tenant_roles', 'rights', '{}', page)).toBeNull()
    expect(auditValue('tenant_roles', 'leads', 'true', page)).toBe('Ja')
  })

  it('writes roles in either form the database keeps a list', () => {
    expect(auditValue('memberships', 'roles', '["owner","office"]', page)).toBe('Inhaber, Büro')
    expect(auditValue('memberships', 'roles', '{technician}', page)).toBe('Monteur')
  })

  it('names people and the records a field points at', () => {
    expect(auditValue('tasks', 'assignee_user_id', 'anna', page)).toBe('Anna Weber')
    expect(auditValue('tasks', 'assignee_user_id', 'gone', page)).toBe(
      'Eine Person, die es nicht mehr gibt',
    )
    expect(auditValue('contacts', 'customer_id', 'c-1', page)).toBe('Hausverwaltung Süd GmbH')
  })

  it('never shows the keys of a browser and shortens a fingerprint', () => {
    expect(
      auditValue('push_subscriptions', 'p256dh', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', page),
    ).toBe('gesetzt')
    expect(auditValue('files', 'sha256', 'a'.repeat(64), page)).toBe(`${'a'.repeat(12)}…`)
  })

  it('writes an empty value as nothing, for the screen to say "leer"', () => {
    expect(auditValue('customers', 'phone', null, page)).toBeNull()
    expect(auditValue('customers', 'phone', '', page)).toBeNull()
  })
})

describe('records and devices', () => {
  it('names a record from the log, a document by its kind, and says when there is no name', () => {
    expect(recordTitle('documents', 'd-1', page)).toBe('A-2026-0091')
    expect(recordKind('documents', 'd-1', page)).toBe('Angebot')
    expect(recordKind('customers', 'c-1', page)).toBe('Kunde')
    expect(recordTitle('memberships', 'm-1', page)).toBe('Anna Weber')
    expect(recordTitle('sites', 'x-1', page)).toBe('Objekt ohne Bezeichnung')
    expect(recordTitle('time_entries', 't-1', page)).toMatch(/^25\.09\.2026, \d{2}:30$/)
  })

  it('names a device by its browser while it is known, and by the end of its id after', () => {
    expect(deviceWords('device-anna', page)).toBe('Safari auf iPhone')
    expect(deviceWords('0199a3f2-7c1d-7b2e-9f3a-8c4e2a91b7d3', page)).toBe('Gerät 91B7D3')
    expect(deviceWords('vorschau-tablet', page)).toBe('Gerät vorschau-tablet')
  })
})

describe('a change in a few words', () => {
  it('says what happened to the record where one word says it', () => {
    expect(changeSummary(change({ operation: 'insert' }))).toBe('Angelegt')
    expect(changeSummary(change({ operation: 'delete' }))).toBe('Entfernt')
    expect(
      changeSummary(
        change({ fields: [{ field: 'deleted_at', before: null, after: '2026-09-27T10:00:00Z' }] }),
      ),
    ).toBe('Als gelöscht markiert')
    expect(
      changeSummary(
        change({
          table: 'documents',
          fields: [
            { field: 'number', before: null, after: 'A-2026-0091' },
            { field: 'status', before: 'draft', after: 'issued' },
          ],
        }),
      ),
    ).toBe('Festgeschrieben')
  })

  it('names the fields that moved, three and the count of the rest', () => {
    expect(
      changeSummary(
        change({
          fields: [
            { field: 'city', before: 'A', after: 'B' },
            { field: 'email', before: 'a', after: 'b' },
            { field: 'phone', before: '1', after: '2' },
            { field: 'street', before: 'x', after: 'y' },
            { field: 'device_id', before: 'one', after: 'two' },
          ],
        }),
      ),
    ).toBe('E-Mail, Ort, Straße und 1 weitere')
  })
})
