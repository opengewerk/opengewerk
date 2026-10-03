import type { AuditVocabulary } from './audit-log.js'

/**
 * What an application that belongs to nobody says about its tables in the
 * change log, for the tests of the foundation: the records of
 * `probePolicies` that have tables, its shelves with their notes and its
 * letters with their lines.
 *
 * A test that ran green with the tables of a real application would not show
 * that the log knows none of them. Its tenant is a "Mandant", whoever runs an
 * instance its "Aufsicht der Instanz", as the probe application says in its
 * sentences.
 */
export const probeAuditVocabulary: AuditVocabulary = {
  tables: {
    shelves: { label: 'Regal', fields: { label: 'Beschriftung', closed: 'Geschlossen' } },
    notes: { label: 'Notiz', fields: { shelf_id: 'Regal' } },
    letters: { label: 'Brief', fields: { subject: 'Betreff', status: 'Stand' } },
    letter_lines: {
      label: 'Briefzeile',
      fields: { letter_id: 'Brief', quantity: 'Menge', price: 'Preis', total: 'Summe' },
    },
  },
  commonFields: { text: 'Text' },
  // The probe application keeps the number of a parcel beside a message about
  // one, and beside the deadline that waits for it to be picked up.
  ownFields: {
    mail_outbox: { parcel_number: 'Paketnummer' },
    deadlines: { parcel_number: 'Paketnummer' },
  },
  foundation: {
    tenant: 'Mandant',
    tenantParameter: 'Einstellung des Mandanten',
    leads: 'Leitet den Mandanten',
    operator: 'Aufsicht der Instanz',
    reasons: {
      'session.switch': 'Wechsel in einen anderen Mandanten',
      'operator.appoint': 'Aufsicht benennen',
      'operator.remove': 'Aufsicht entfernen',
      'operator.cli': 'Aufsicht über die Kommandozeile',
      'instance.tenant': 'Mandant für andere anlegen',
      'tenant.cli': 'Mandant über die Kommandozeile',
    },
  },
  parts: {
    shelves: [{ table: 'notes', column: 'shelf_id' }],
    letters: [{ table: 'letter_lines', column: 'letter_id' }],
  },
  records: ['shelves', 'letters'],
  references: { shelf_id: 'shelves', letter_id: 'letters' },
  personFields: [],
  titles: {
    shelves: ['label'],
    notes: ['text'],
    letters: ['subject'],
    // A line has nothing of its own to be called by and is named after its letter.
    letter_lines: ['letter_id'],
  },
  reasons: { tidy: 'Von selbst, Aufräumen' },
  rights: {
    'membership.read': 'Mitglieder sehen',
    'membership.write': 'Mitglieder verwalten',
    'members.read': 'Andere sehen',
    'notes.write': 'Notizen schreiben',
    'shelves.write': 'Regale führen',
    'letters.write': 'Briefe schreiben',
    'audit.read': 'Protokoll einsehen',
  },
  roles: { lead: 'Leitung', member: 'Mitglied', guest: 'Gast' },
}
