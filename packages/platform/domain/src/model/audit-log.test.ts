import { describe, expect, it } from 'vitest'

import {
  applicationRoleName,
  auditDayProblem,
  auditLanguage,
  type AuditVocabulary,
  auditWay,
  foundationAuditReasons,
  foundationAuditTables,
  migrationRoleName,
} from './audit-log.js'
import { probeAuditVocabulary } from './probe-audit.js'

// The rules of the change log with the vocabulary of an application that is
// nobody's (ADR 0010): its shelves, notes and letters, a tenant it calls a
// "Mandant", and whoever runs an instance its "Aufsicht der Instanz".

const language = auditLanguage(probeAuditVocabulary)

/** The same application with a contact whose name is two fields, and quiet fields of its own. */
const withContacts: AuditVocabulary = {
  ...probeAuditVocabulary,
  tables: {
    ...probeAuditVocabulary.tables,
    visitors: { label: 'Gast', fields: { first: 'Vorname', last: 'Nachname' } },
  },
  titles: { ...probeAuditVocabulary.titles, visitors: { joined: ['first', 'last'] } },
  personFields: ['host_id'],
  quietFields: ['badge'],
}

describe('what the log calls a table and a field', () => {
  it("names the application's tables in its words and the foundation's in its own", () => {
    expect(language.tableLabel('shelves')).toBe('Regal')
    expect(language.tableLabel('memberships')).toBe('Zugang')
    expect(language.tableLabel('tenant_sessions')).toBe('Anmeldung')
    expect(language.tableLabel('instance_settings')).toBe('Einstellungen der Instanz')
  })

  it("names the foundation's tables with the application's word where one is needed", () => {
    expect(language.tableLabel('tenants')).toBe('Mandant')
    expect(language.tableLabel('tenant_parameters')).toBe('Einstellung des Mandanten')
    expect(language.tableLabel('instance_operators')).toBe('Aufsicht der Instanz')
    expect(language.fieldName('tenant_roles', 'leads')).toBe('Leitet den Mandanten')
    expect(language.fieldName('notes', 'tenant_id')).toBe('Mandant')
  })

  it('names a field by its table first, then by the common fields of the application, then by those of the foundation', () => {
    expect(language.fieldName('shelves', 'label')).toBe('Beschriftung')
    expect(language.fieldName('notes', 'text')).toBe('Text')
    expect(language.fieldName('notes', 'device_id')).toBe('Gerät')
    expect(language.fieldName('letters', 'change_sequence')).toBe('Abgleichsnummer')
    expect(language.fieldName('memberships', 'roles')).toBe('Rollen')
    expect(language.fieldName('letters', 'nothing_names_this')).toBeNull()
  })

  it("names a column of the application's own on a table of the foundation, never one the foundation names", () => {
    const overreaching = auditLanguage({
      ...probeAuditVocabulary,
      ownFields: { mail_outbox: { parcel_number: 'Paketnummer', subject: 'Überschrift' } },
    })

    expect(language.fieldName('mail_outbox', 'parcel_number')).toBe('Paketnummer')
    expect(language.fieldName('mail_outbox', 'subject')).toBe('Betreff')
    expect(overreaching.fieldName('mail_outbox', 'subject')).toBe('Betreff')
    expect(language.fieldName('shelves', 'parcel_number')).toBeNull()
  })

  it('writes a field with its table, and a table nothing names as itself', () => {
    expect(language.fieldLabel('shelves', 'label')).toBe('Regal, Beschriftung')
    expect(language.fieldLabel('shelves', 'unnamed')).toBe('Regal, unnamed')
    expect(language.tableLabel('unknown_table')).toBe('unknown_table')
  })

  it('holds every table of the foundation the log of a tenant keeps', () => {
    for (const table of foundationAuditTables) {
      expect([table, language.tableLabel(table) === table]).toEqual([table, false])
    }

    expect(Object.keys(language.tables).sort()).toEqual(
      [...foundationAuditTables, ...Object.keys(probeAuditVocabulary.tables)].sort(),
    )
  })
})

describe("what a record's name is", () => {
  it('is the first naming field with a value, and which one it came from', () => {
    const latest = { subject: '', status: 'sent' }

    expect(language.titleFields('letters')).toEqual(['subject'])
    expect(language.titleFrom('shelves', { label: 'Werkzeug' })).toBe('Werkzeug')
    expect(language.titleFieldOf('shelves', { label: 'Werkzeug' })).toBe('label')
    expect(language.titleFrom('letters', latest)).toBeNull()
    expect(language.titleFieldOf('letters', latest)).toBeNull()
  })

  it('is two fields joined where the application says so, from no single field', () => {
    const joined = auditLanguage(withContacts)

    expect(joined.titleFields('visitors')).toEqual(['first', 'last'])
    expect(joined.titleFrom('visitors', { first: 'Ida', last: 'Ost' })).toBe('Ida Ost')
    expect(joined.titleFrom('visitors', { first: ' ', last: 'Ost' })).toBe('Ost')
    expect(joined.titleFrom('visitors', { first: null, last: '' })).toBeNull()
    expect(joined.titleFieldOf('visitors', { first: 'Ida', last: 'Ost' })).toBeNull()
  })

  it("is the foundation's own for its tables, and the common fields for a table nobody names", () => {
    expect(language.titleFields('memberships')).toEqual(['user_id'])
    expect(language.titleFields('mail_outbox')).toEqual(['subject'])
    expect(language.titleFields('tenant_roles')).toEqual(['label', 'key'])
    expect(language.titleFrom('tenants', { name: 'Mandant Nord' })).toBe('Mandant Nord')
    expect(language.titleFrom('member_passkeys', { name: 'Laptop' })).toBe('Laptop')
  })
})

describe('the fields the log treats apart', () => {
  it("knows a person by the foundation's fields and the application's", () => {
    const joined = auditLanguage(withContacts)

    expect(joined.isPersonField('user_id')).toBe(true)
    expect(joined.isPersonField('invited_by')).toBe(true)
    expect(joined.isPersonField('requested_by')).toBe(true)
    expect(joined.isPersonField('host_id')).toBe(true)
    expect(joined.isPersonField('shelf_id')).toBe(false)
  })

  it("keeps the foundation's quiet fields quiet, and the application's", () => {
    const joined = auditLanguage(withContacts)

    for (const field of ['id', 'tenant_id', 'created_at', 'passkey_id', 'badge']) {
      expect([field, joined.isQuiet(field)]).toEqual([field, true])
    }

    expect(joined.isQuiet('label')).toBe(false)
    expect(language.isQuiet('badge')).toBe(false)
  })

  it('finds parts where the application names them, and references where it or the foundation does', () => {
    expect(language.partsOf('shelves')).toEqual([{ table: 'notes', column: 'shelf_id' }])
    expect(language.partsOf('notes')).toEqual([])
    expect(language.referenceOf('letter_id')).toBe('letters')
    // The invitation a message is about, in the outbox of every application.
    expect(language.referenceOf('invitation_id')).toBe('invitations')
    expect(language.referenceOf('label')).toBeNull()
  })
})

describe('the way a change took', () => {
  it('is the database itself for any other role, whatever its reason says', () => {
    expect(auditWay(probeAuditVocabulary, 'tidy', 'postgres')).toEqual({
      text: 'Direkt in der Datenbank',
      direct: true,
    })
  })

  it('is the application or an update without a reason', () => {
    expect(language.way(null, applicationRoleName)).toEqual({ text: 'Anwendung', direct: false })
    expect(language.way('', migrationRoleName)).toEqual({
      text: 'Update der Anwendung',
      direct: false,
    })
  })

  it("is in the foundation's words for its reasons, and in the application's for those that name a tenant", () => {
    expect(language.way('session.start', applicationRoleName).text).toBe('Anmeldung')
    expect(language.way('sync.write', applicationRoleName).text).toBe('Abgleich')
    expect(language.way('session.switch', applicationRoleName).text).toBe(
      'Wechsel in einen anderen Mandanten',
    )
    expect(language.way('operator.appoint', applicationRoleName).text).toBe('Aufsicht benennen')
  })

  it("is the application's reason, else the label of the right it names, else the reason as it is", () => {
    expect(language.way('tidy', applicationRoleName).text).toBe('Von selbst, Aufräumen')
    expect(language.way('notes.write', applicationRoleName).text).toBe('Notizen schreiben')
    expect(language.way('made.up', applicationRoleName).text).toBe('made.up')
  })

  it("keeps the foundation's words for its own reasons", () => {
    const overriding = auditLanguage({
      ...probeAuditVocabulary,
      reasons: { 'session.start': 'Eigene Wörter' },
    })

    expect(overriding.way('session.start', applicationRoleName).text).toBe('Anmeldung')
    expect(foundationAuditReasons).toContain('session.start')
    expect(foundationAuditReasons).toContain('tenant.cli')
    expect(foundationAuditReasons).not.toContain('tenant.create')
  })
})

describe('a day in a filter', () => {
  it('is an ISO day that exists', () => {
    expect(auditDayProblem('2026-10-03')).toBeNull()
    expect(auditDayProblem('03.10.2026')).toBe('Ein Tag in der Form JJJJ-MM-TT.')
    expect(auditDayProblem('2026-13-40')).toBe('Ein Tag in der Form JJJJ-MM-TT.')
  })
})
