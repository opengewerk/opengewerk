import type { AuditOperation, ChainVerification } from './audit.js'
import { type Permission, permissionLabel, permissions } from './authorization.js'

/**
 * The change log as the owner reads it in the office (#285).
 *
 * The log itself is one row per field and knows tables and columns. What the
 * screen needs is one change per write, with the words of the office around
 * it: which record, who, from which device and on which way. This file holds
 * the shapes the server hands over and the rules both sides share, so that the
 * server picks the same parts of a record the screen promises.
 */

/** One field of one change, before and after, as the text the log holds. */
export interface AuditFieldChange {
  /** The column as the database spells it. */
  readonly field: string
  readonly before: string | null
  readonly after: string | null
}

/**
 * One write to one record: every field that moved in it, who made it, when,
 * from which device and why. The log groups them by `change_id`, one per row
 * the trigger saw.
 */
export interface AuditChange {
  readonly changeId: string
  /** ISO 8601, as the database wrote it. */
  readonly changedAt: string
  readonly operation: AuditOperation
  readonly table: string
  readonly recordId: string
  readonly userId: string | null
  /**
   * The device the record says it was written from, which the log only notes
   * when it changes: a change that does not move `device_id` came from the
   * device of the change before it. Null for anything written in the office
   * outside the sync, and for tables without the column.
   */
  readonly deviceId: string | null
  readonly reason: string | null
  readonly databaseRole: string
  /** Where the change sits in the chain, so that a break can be put at its change. */
  readonly firstSequence: number
  readonly lastSequence: number
  readonly fields: readonly AuditFieldChange[]
}

/** What a record on a page is called, found in the log itself. */
export interface AuditTitle {
  readonly table: string
  /**
   * The field the name came from, for the screen to write it as that field
   * is written: a person's name for `user_id`, a date for `started_at`. Null
   * for a contact, whose name is two fields.
   */
  readonly field: string | null
  /** The name, number or designation the record last carried, or null. */
  readonly title: string | null
  /** Its `kind` where it has one, for a document the kind of document. */
  readonly kind: string | null
}

/**
 * A page of the log, newest first, with the names the page needs.
 *
 * The names come from the log as well and not from the records: a record that
 * was deleted still has a history, and its history still needs its name.
 */
export interface AuditPage {
  readonly changes: readonly AuditChange[]
  /** Hand this back as `before` for the page after, null at the first change. */
  readonly next: number | null
  /** By record id: every record on the page and every one a field points at. */
  readonly titles: Readonly<Record<string, AuditTitle>>
  /** By user id: the people on the page. */
  readonly people: Readonly<Record<string, string>>
  /** By device id: the browser it last signed in with, null when nothing is known. */
  readonly devices: Readonly<Record<string, string | null>>
}

/** The check of the chain as the office reads it. */
export interface AuditChainReport extends ChainVerification {
  /** When the entry the chain stops fitting at was written, ISO 8601, or null. */
  readonly brokenAtTime: string | null
  /** When the check ran. */
  readonly checkedAt: string
}

/** The most changes one page holds. */
export const auditPageSize = 50

/** The database role the application works as, and the one migrations run as. */
export const applicationRole = 'opengewerk_app'
export const migrationRole = 'opengewerk_owner'

/** What a change says about its way into the log. */
export interface AuditWay {
  readonly text: string
  /**
   * The change went past the application, straight into the database. The
   * one way worth a second look, so the screen shows it differently.
   */
  readonly direct: boolean
}

const reasonWords: Readonly<Record<string, string>> = {
  migration: 'Update der Anwendung',
  deadline: 'Von selbst, Fristen',
  notification: 'Von selbst, Benachrichtigungen',
  mail: 'Von selbst, E-Mail-Versand',
  push: 'Von selbst, Push-Versand',
  'session.start': 'Anmeldung',
  'session.end': 'Abmeldung',
  'session.revoke': 'Gerät abgemeldet',
  'session.switch': 'Wechsel in einen anderen Betrieb',
  'passkey.add': 'Passkey hinzugefügt',
  'passkey.rename': 'Passkey umbenannt',
  'passkey.remove': 'Passkey gelöscht',
  authentication: 'Anmeldung und Konten',
  'instance.setup': 'Ersteinrichtung',
  'invitation.redeem': 'Einladung eingelöst',
  'membership.create': 'Zugang über die Kommandozeile',
  'instance.settings': 'Einstellungen der Instanz ändern',
  'operator.appoint': 'Betreiber benennen',
  'operator.remove': 'Betreiber entfernen',
  'operator.cli': 'Betreiber über die Kommandozeile',
  'instance.tenant': 'Betrieb für andere anlegen',
  'tenant.cli': 'Betrieb über die Kommandozeile',
  environment: 'Übernommen aus der .env',
  // The sync reads and writes under two rights; either way it is the sync.
  'sync.read': 'Abgleich',
  'sync.write': 'Abgleich',
}

function isPermission(reason: string): reason is Permission {
  return (permissions as readonly string[]).includes(reason)
}

/**
 * The way a change took, in the words of the office.
 *
 * The role decides first. Anybody at a database prompt can set `app.reason`
 * to whatever they like, so a reason from a connection that is neither the
 * application nor a migration says nothing, and the change is marked as what
 * it is: made directly in the database.
 */
export function auditWay(reason: string | null, databaseRole: string): AuditWay {
  if (databaseRole !== applicationRole && databaseRole !== migrationRole) {
    return { text: 'Direkt in der Datenbank', direct: true }
  }

  if (reason === null || reason === '') {
    return {
      text: databaseRole === migrationRole ? 'Update der Anwendung' : 'Anwendung',
      direct: false,
    }
  }

  const words = reasonWords[reason] ?? (isPermission(reason) ? permissionLabel[reason] : reason)

  return { text: words, direct: false }
}

/** A table whose rows belong to a record of another, and the column that says to which. */
export interface AuditPart {
  readonly table: string
  readonly column: string
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
export const auditParts: Readonly<Record<string, readonly AuditPart[]>> = {
  customers: [
    { table: 'contacts', column: 'customer_id' },
    { table: 'customer_tags', column: 'customer_id' },
  ],
  sites: [
    { table: 'contacts', column: 'site_id' },
    { table: 'site_tags', column: 'site_id' },
    { table: 'site_accesses', column: 'site_id' },
  ],
  site_accesses: [{ table: 'site_access_reveals', column: 'site_access_id' }],
  installations: [
    { table: 'distribution_boards', column: 'installation_id' },
    { table: 'inverters', column: 'installation_id' },
  ],
  distribution_boards: [
    { table: 'board_sections', column: 'distribution_board_id' },
    { table: 'circuits', column: 'distribution_board_id' },
  ],
  circuits: [{ table: 'equipment', column: 'circuit_id' }],
  inverters: [{ table: 'pv_strings', column: 'inverter_id' }],
  pv_strings: [{ table: 'pv_modules', column: 'pv_string_id' }],
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
export const auditRecordTables = [
  'customers',
  'sites',
  'installations',
  'jobs',
  'documents',
] as const

/**
 * Fields that point at another record, and the table they point into. The
 * page names what they point at, so that a customer moved to another site
 * reads as two names and not as two keys.
 */
export const auditReferences: Readonly<Record<string, string>> = {
  customer_id: 'customers',
  site_id: 'sites',
  installation_id: 'installations',
  job_id: 'jobs',
  parent_job_id: 'jobs',
  predecessor_job_id: 'jobs',
  document_id: 'documents',
  predecessor_document_id: 'documents',
  source_document_id: 'documents',
  distribution_board_id: 'distribution_boards',
  board_section_id: 'board_sections',
  circuit_id: 'circuits',
  inverter_id: 'inverters',
  pv_string_id: 'pv_strings',
  attachment_id: 'attachments',
  task_id: 'tasks',
  deadline_id: 'deadlines',
  invitation_id: 'invitations',
  corrects_entry_id: 'time_entries',
  subscription_id: 'push_subscriptions',
  tag_id: 'tags',
  site_access_id: 'site_accesses',
}

/** Fields that hold the id of a person. */
export const auditPersonFields: ReadonlySet<string> = new Set([
  'user_id',
  'assignee_user_id',
  'responsible_user_id',
  'natural_user_id',
  'created_by',
  'issued_by',
  'invited_by',
  'requested_by',
  'closed_by',
])

/**
 * The tables whose rows are best named by their person: a membership, a
 * stretch of work in the business, somebody put on a job.
 */
export const auditPersonTables: ReadonlySet<string> = new Set([
  'memberships',
  'tenant_sessions',
  'job_assignments',
  'location_consents',
  'push_opt_outs',
])

/**
 * Where a record's name is, field by field until one has a value. A document
 * is its number once it has one and its subject before, a job the other way
 * round, because the office says "Störung Treppenhauslicht" and not the number.
 */
const titleFieldsByTable: Readonly<Record<string, readonly string[]>> = {
  documents: ['number', 'subject'],
  jobs: ['designation', 'number'],
  document_lines: ['designation', 'description'],
  circuits: ['designation', 'consumer'],
  equipment: ['designation', 'model'],
  pv_modules: ['model', 'serial_number'],
  // Hours are told apart by when they began; whose they are the list says anyway.
  time_entries: ['started_at'],
  deadlines: ['source_label'],
  letterheads: ['company_name'],
  mail_settings: ['from_address'],
  mail_outbox: ['subject'],
  invitations: ['name', 'email'],
  instructions: ['title', 'template'],
  form_definitions: ['key'],
  form_records: ['definition_key'],
  attachment_versions: ['file_name'],
  document_signatures: ['signer_name'],
  number_ranges: ['key'],
  tenant_parameters: ['key'],
  deadline_settings: ['kind'],
  push_subscriptions: ['label'],
  job_notes: ['text'],
  payments: ['received_on'],
  files: ['media_type'],
  document_files: ['purpose'],
  document_instruction_choices: ['variant'],
  // Rows with nothing of their own to be called by are named after what they belong to.
  document_snapshots: ['document_id'],
  document_sources: ['source_document_id'],
  // A tag on a customer or a site is called by the tag, which the page names.
  customer_tags: ['tag_id'],
  site_tags: ['tag_id'],
  // The showing of an access is called by the access, which the page names.
  site_access_reveals: ['site_access_id'],
}

const defaultTitleFields = ['name', 'designation', 'title', 'subject', 'number']

/** The fields a record of this table is named by, in the order they are tried. */
export function auditTitleFields(table: string): readonly string[] {
  if (table === 'contacts') {
    return ['given_name', 'family_name']
  }

  if (auditPersonTables.has(table)) {
    return ['user_id']
  }

  return titleFieldsByTable[table] ?? defaultTitleFields
}

/**
 * The name from the latest values of those fields: the first one with a
 * value, and for a contact given and family name together.
 */
export function auditTitleFrom(
  table: string,
  latest: Readonly<Record<string, string | null>>,
): string | null {
  const fields = auditTitleFields(table)

  if (table === 'contacts') {
    const joined = fields
      .map((field) => latest[field])
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join(' ')

    return joined === '' ? null : joined
  }

  for (const field of fields) {
    const value = latest[field]

    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }
  }

  return null
}

/** Why a day in a filter is not one, or null when it is. */
export function auditDayProblem(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ? null
    : 'Ein Tag in der Form JJJJ-MM-TT.'
}
