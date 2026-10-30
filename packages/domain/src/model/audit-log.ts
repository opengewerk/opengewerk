import {
  type AuditPart,
  type AuditTitleRule,
  type AuditVocabulary,
  structureAuditParts,
  structureAuditReferences,
  structureAuditTitles,
} from '@opengewerk/platform-domain'

import { auditCommonFields, auditTables } from './audit-labels.js'
import { permissionLabel, roleKeys, roles } from './authorization.js'

/**
 * The change log as the owner reads it in the office (#285), in the words of
 * the business: which tables are parts of a record, what a field points at,
 * where a record's name is and what a reason means. The foundation reads the
 * log and holds the rules (ADR 0010); this is what it is told, as one value,
 * `auditVocabulary`.
 */

/** The reasons of the business's own work, beside those of the foundation. */
const reasonWords: Readonly<Record<string, string>> = {
  'article.import': 'Import aus DATANORM',
  'article.import.interrupted': 'Von selbst, Import beim Neustart beendet',
  'article.prices.follow': 'Verkaufspreise nach einem geänderten Aufschlag',
}

/**
 * What the log of one record takes in beside the record itself: its parts,
 * the rows the office sees and changes on the same screen. A customer with its
 * contacts, a document with its lines, an installation with its whole
 * structure, walked down level by level.
 *
 * Not everything that points at a record is a part of it. A document points
 * at its customer and is still a record of its own, with its own log; taking
 * it in would bury the three changes to an address under three hundred to
 * invoices.
 */
const auditParts: Readonly<Record<string, readonly AuditPart[]>> = {
  customers: [
    { table: 'contacts', column: 'customer_id' },
    { table: 'customer_tags', column: 'customer_id' },
  ],
  // A supplier with its people and its own markup (#463).
  suppliers: [
    { table: 'contacts', column: 'supplier_id' },
    { table: 'supplier_markups', column: 'supplier_id' },
  ],
  // An article with its prices, how its selling price is made (#463) and where
  // it comes from (#296), walked down to the purchase prices at each supplier.
  articles: [
    { table: 'article_prices', column: 'article_id' },
    { table: 'article_markups', column: 'article_id' },
    { table: 'supplier_articles', column: 'article_id' },
  ],
  // A selling price with what it came from (#463).
  article_prices: [{ table: 'article_price_origins', column: 'article_price_id' }],
  supplier_articles: [{ table: 'purchase_prices', column: 'supplier_article_id' }],
  sites: [
    { table: 'contacts', column: 'site_id' },
    { table: 'site_tags', column: 'site_id' },
    { table: 'site_accesses', column: 'site_id' },
  ],
  site_accesses: [
    { table: 'site_access_reveals', column: 'site_access_id' },
    { table: 'site_access_deliveries', column: 'site_access_id' },
  ],
  installations: [
    { table: 'distribution_boards', column: 'installation_id' },
    { table: 'inverters', column: 'installation_id' },
    { table: 'installation_labels', column: 'installation_id' },
  ],
  // Below a board and an inverter the parts are the foundation's (ADR 0014).
  ...structureAuditParts,
  jobs: [
    { table: 'job_notes', column: 'job_id' },
    { table: 'job_assignments', column: 'job_id' },
  ],
  documents: [
    { table: 'document_lines', column: 'document_id' },
    { table: 'document_signatures', column: 'document_id' },
    { table: 'document_instruction_choices', column: 'document_id' },
    { table: 'document_sources', column: 'document_id' },
    { table: 'payments', column: 'document_id' },
  ],
}

/** The records the office opens the log from, with the button "Änderungen". */
const auditRecordTables = [
  'customers',
  'sites',
  'installations',
  'jobs',
  'documents',
  'articles',
  'suppliers',
] as const

/**
 * Fields that point at another record, and the table they point into. The
 * page names what they point at, so that a customer moved to another site
 * reads as two names and not as two keys.
 */
const auditReferences: Readonly<Record<string, string>> = {
  customer_id: 'customers',
  site_id: 'sites',
  installation_id: 'installations',
  job_id: 'jobs',
  parent_job_id: 'jobs',
  predecessor_job_id: 'jobs',
  document_id: 'documents',
  predecessor_document_id: 'documents',
  source_document_id: 'documents',
  ...structureAuditReferences,
  article_id: 'articles',
  supplier_id: 'suppliers',
  supplier_article_id: 'supplier_articles',
  article_price_id: 'article_prices',
  pv_system_id: 'installations',
  task_id: 'tasks',
  deadline_id: 'deadlines',
  corrects_entry_id: 'time_entries',
  tag_id: 'tags',
  site_access_id: 'site_accesses',
  import_id: 'article_imports',
}

/** Fields that hold the id of a person, beside those of the foundation. */
const auditPersonFields: readonly string[] = [
  'assignee_user_id',
  'created_by',
  'issued_by',
  'requested_by',
]

/**
 * The tables whose rows are best named by their person: somebody put on a job,
 * a consent. A membership, a stretch of work in the business and an occasion
 * switched off for push the foundation names the same way.
 */
const auditPersonTables: readonly string[] = ['job_assignments', 'location_consents']

/**
 * Where a record's name is, field by field until one has a value. A document
 * is its number once it has one and its subject before, a job the other way
 * round, because the office says "Störung Treppenhauslicht" and not the number.
 */
const titleFieldsByTable: Readonly<Record<string, readonly string[]>> = {
  documents: ['number', 'subject'],
  jobs: ['designation', 'number'],
  document_lines: ['designation', 'description'],
  // A label is told apart by its code, the one thing it says (#308).
  installation_labels: ['code'],
  // An article by what it is called, a price by the day it begins, and what a
  // supplier sells by the supplier, which the page names (#296).
  articles: ['designation', 'number'],
  article_prices: ['valid_from'],
  purchase_prices: ['valid_from'],
  supplier_articles: ['supplier_id'],
  // A list price like a purchase price; an import of DATANORM by the supplier
  // it came from, which the page names (#297).
  list_prices: ['valid_from'],
  // A markup by its percentage (#463); a fixed price has none and is the label alone.
  supplier_markups: ['basis_points'],
  article_price_origins: ['basis_points'],
  selling_price_runs: ['from_day'],
  article_markups: ['basis_points'],
  article_imports: ['supplier_id'],
  // Hours are told apart by when they began; whose they are the list says anyway.
  time_entries: ['started_at'],
  letterheads: ['company_name'],
  instructions: ['title', 'template'],
  form_definitions: ['key'],
  form_records: ['definition_key'],
  document_signatures: ['signer_name'],
  job_notes: ['text'],
  payments: ['received_on'],
  document_files: ['purpose'],
  document_instruction_choices: ['variant'],
  // Rows with nothing of their own to be called by are named after what they belong to.
  document_snapshots: ['document_id'],
  document_sources: ['source_document_id'],
  // A tag on a customer or a site is called by the tag, which the page names.
  customer_tags: ['tag_id'],
  site_tags: ['tag_id'],
  // The showing of an access and its way onto a device are called by the
  // access, which the page names.
  site_access_reveals: ['site_access_id'],
  site_access_deliveries: ['site_access_id'],
}

/**
 * Where a record's name is: by its fields, or by its person. A contact is
 * named by both its names, which the foundation says for its table.
 */
const auditTitles: Readonly<Record<string, AuditTitleRule>> = {
  ...structureAuditTitles,
  ...titleFieldsByTable,
  ...Object.fromEntries(auditPersonTables.map((table) => [table, ['user_id']])),
}

/** The change log of the business, as the foundation is told it (ADR 0010). */
export const auditVocabulary: AuditVocabulary = {
  tables: auditTables,
  commonFields: auditCommonFields,
  // The outbox, the deadlines, the contacts and the files with their versions
  // are the foundation's tables (#23, opengewerk-haustechnik#24, #85 and #97);
  // the columns for what a message or a deadline of this application is
  // about, and for what a contact or a file hangs on, are this application's
  // own.
  ownFields: {
    attachments: {
      customer_id: 'Kunde',
      site_id: 'Objekt',
      installation_id: 'Anlage',
      job_id: 'Auftrag',
    },
    contacts: {
      customer_id: 'Kunde',
      site_id: 'Objekt',
      supplier_id: 'Lieferant',
    },
    mail_outbox: {
      task_id: 'Aufgabe',
      document_id: 'Beleg',
      attachment: 'Anhang',
      deadline_id: 'Frist',
    },
    deadlines: {
      document_id: 'Beleg',
      installation_id: 'Anlage',
      customer_id: 'Kunde',
      site_id: 'Objekt',
      job_id: 'Auftrag',
      task_id: 'Aufgabe',
    },
  },
  foundation: {
    tenant: 'Betrieb',
    tenantParameter: 'Einstellung des Betriebs',
    leads: 'Führt den Betrieb',
    operator: 'Betreiber',
    reasons: {
      'session.switch': 'Wechsel in einen anderen Betrieb',
      'operator.appoint': 'Betreiber benennen',
      'operator.remove': 'Betreiber entfernen',
      'operator.cli': 'Betreiber über die Kommandozeile',
      'instance.tenant': 'Betrieb für andere anlegen',
      'tenant.cli': 'Betrieb über die Kommandozeile',
    },
  },
  parts: auditParts,
  records: auditRecordTables,
  references: auditReferences,
  personFields: auditPersonFields,
  titles: auditTitles,
  reasons: reasonWords,
  rights: permissionLabel,
  roles: Object.fromEntries(roleKeys.map((key) => [key, roles[key].label])),
}
