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

  it('names a contact and who it is itself, and what one hangs on in the words of the application', () => {
    expect(language.tableLabel('contacts')).toBe('Ansprechpartner')
    expect(language.fieldName('contacts', 'given_name')).toBe('Vorname')
    expect(language.fieldName('contacts', 'family_name')).toBe('Nachname')
    expect(language.fieldName('contacts', 'role')).toBe('Funktion')
    expect(language.fieldName('contacts', 'phone')).toBe('Telefon')
    expect(language.fieldName('contacts', 'email')).toBe('E-Mail')
    // The parents are columns of the application, which names them.
    expect(language.fieldName('contacts', 'shelf_id')).toBe('Regal')
    expect(language.fieldName('contacts', 'letter_id')).toBe('Brief')
    expect(language.fieldName('contacts', 'drawer_id')).toBeNull()
  })

  it('names a file of the records and its versions itself, and what a file hangs on in the words of the application', () => {
    expect(language.tableLabel('attachments')).toBe('Datei')
    expect(language.fieldName('attachments', 'title')).toBe('Titel')
    expect(language.tableLabel('attachment_versions')).toBe('Fassung einer Datei')
    expect(language.fieldName('attachment_versions', 'attachment_id')).toBe('Datei')
    expect(language.fieldName('attachment_versions', 'sha256')).toBe('Prüfsumme')
    expect(language.fieldName('attachment_versions', 'file_name')).toBe('Dateiname')
    expect(language.fieldName('attachment_versions', 'media_type')).toBe('Dateityp')
    expect(language.fieldName('attachment_versions', 'size_bytes')).toBe('Größe')
    expect(language.fieldName('attachment_versions', 'preview_sha256')).toBe('Vorschau')
    expect(language.fieldName('attachment_versions', 'created_by')).toBe('Angelegt von')
    // The places are columns of the application, which names them.
    expect(language.fieldName('attachments', 'shelf_id')).toBe('Regal')
    expect(language.fieldName('attachments', 'letter_id')).toBe('Brief')
    expect(language.fieldName('attachments', 'drawer_id')).toBeNull()
  })

  it('calls a file and a version what the application calls them, where it says so', () => {
    const filing = auditLanguage({
      ...probeAuditVocabulary,
      foundation: {
        ...probeAuditVocabulary.foundation,
        attachments: { record: 'Scan', version: 'Fassung eines Scans' },
      },
    })

    expect(filing.tableLabel('attachments')).toBe('Scan')
    expect(filing.tableLabel('attachment_versions')).toBe('Fassung eines Scans')
    expect(filing.fieldName('attachment_versions', 'attachment_id')).toBe('Scan')
    // What a version says of its bytes is called the same everywhere.
    expect(filing.fieldName('attachment_versions', 'file_name')).toBe('Dateiname')
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

  it('is the title of a file, and the name its bytes came with for a version', () => {
    expect(language.titleFrom('attachments', { title: 'Schaltplan' })).toBe('Schaltplan')
    expect(language.titleFields('attachment_versions')).toEqual(['file_name'])
    expect(language.titleFrom('attachment_versions', { file_name: 'Schaltplan.pdf' })).toBe(
      'Schaltplan.pdf',
    )
  })

  it('is both names of a contact, whatever an application says of its title', () => {
    const renaming = auditLanguage({
      ...probeAuditVocabulary,
      titles: { ...probeAuditVocabulary.titles, contacts: ['role'] },
    })
    const jensen = { given_name: 'Ole', family_name: 'Jensen', role: 'Empfang' }

    expect(language.titleFields('contacts')).toEqual(['given_name', 'family_name'])
    expect(language.titleFrom('contacts', jensen)).toBe('Ole Jensen')
    expect(language.titleFrom('contacts', { given_name: null, family_name: 'Jensen' })).toBe(
      'Jensen',
    )
    expect(renaming.titleFrom('contacts', jensen)).toBe('Ole Jensen')
  })
})

describe('the fields the log treats apart', () => {
  it("knows a person by the foundation's fields and the application's", () => {
    const joined = auditLanguage(withContacts)

    expect(joined.isPersonField('user_id')).toBe(true)
    expect(joined.isPersonField('invited_by')).toBe(true)
    expect(joined.isPersonField('requested_by')).toBe(true)
    // Who stored a version of a file.
    expect(joined.isPersonField('created_by')).toBe(true)
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

  it("keeps the foundation's secret values to itself, and the application's, each on its own table", () => {
    const joined = auditLanguage({ ...withContacts, secretFields: { visitors: ['door_code'] } })

    for (const field of ['endpoint', 'p256dh', 'auth']) {
      expect([field, joined.isSecret('push_subscriptions', field)]).toEqual([field, true])
    }

    expect(joined.isSecret('invitations', 'token_hash')).toBe(true)
    expect(joined.isSecret('visitors', 'door_code')).toBe(true)
    // Secret on its table and nowhere else, and no table is one because every
    // object answers to its name.
    expect(joined.isSecret('shelves', 'auth')).toBe(false)
    expect(joined.isSecret('push_subscriptions', 'label')).toBe(false)
    expect(joined.isSecret('constructor', 'name')).toBe(false)
    expect(language.isSecret('visitors', 'door_code')).toBe(false)
  })

  it('finds parts where the application names them, and references where it or the foundation does', () => {
    // The notes on a shelf, and the people to ask about it.
    expect(language.partsOf('shelves')).toEqual([
      { table: 'notes', column: 'shelf_id' },
      { table: 'contacts', column: 'shelf_id' },
    ])
    expect(language.partsOf('notes')).toEqual([])
    expect(language.referenceOf('letter_id')).toBe('letters')
    // The invitation a message is about, in the outbox of every application.
    expect(language.referenceOf('invitation_id')).toBe('invitations')
    // The file a version belongs to, wherever an application keeps files.
    expect(language.referenceOf('attachment_id')).toBe('attachments')
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

  it('names the jobs of the foundation that send, mail and push alike', () => {
    // Since #23 the foundation sends mail and push and writes what is raised;
    // a change those jobs make reads in its words in every application.
    expect(language.way('mail', applicationRoleName).text).toBe('Von selbst, E-Mail-Versand')
    expect(language.way('push', applicationRoleName).text).toBe('Von selbst, Push-Versand')
    expect(language.way('notification', applicationRoleName).text).toBe(
      'Von selbst, Benachrichtigungen',
    )
  })
})

describe('a day in a filter', () => {
  it('is an ISO day that exists', () => {
    expect(auditDayProblem('2026-10-03')).toBeNull()
    expect(auditDayProblem('03.10.2026')).toBe('Ein Tag in der Form JJJJ-MM-TT.')
    expect(auditDayProblem('2026-13-40')).toBe('Ein Tag in der Form JJJJ-MM-TT.')
  })
})
