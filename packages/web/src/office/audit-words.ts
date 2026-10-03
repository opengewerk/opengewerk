import {
  type AuditChange,
  type AuditFieldChange,
  auditLanguage,
  type AuditPage,
  auditVocabulary,
  cableInstallationMethodLabel,
  distributionBoardKindLabel,
  type NumberRangeKey,
  overcurrentDeviceLabel,
  permissionLabel,
  rcdTypeLabel,
  tripCharacteristicLabel,
} from '@opengewerk/domain'

import { elektroRegistry } from '@opengewerk/gewerk-elektro'
import { amount, date, euros, moment } from '@opengewerk/platform-web/format'
import { deviceName } from '@opengewerk/platform-web/session'

import { documentStateLabel } from '../app/document-state.js'
import {
  customerKindLabel,
  documentKindLabel,
  installationKindLabel,
  jobKindLabel,
  jobStatusLabel,
  lineUnitLabel,
  roleLabel,
  snippetPurposeLabel,
  taskStatusLabel,
  taxTreatmentLabel,
  vatRateLabel,
} from '../app/labels.js'
import { timeEntryKindLabel } from '../app/time.js'

/**
 * The change log in the words of the office (#285): what a value, a change,
 * a record and a device are called. The log holds text as the database wrote
 * it, `issued`, `true`, `12500`; the owner reads "Festgeschrieben", "Ja" and
 * "125,00 €".
 *
 * A value nothing here knows stays as it is. The log is read to find out what
 * happened, and a raw value says that, where an empty cell would hide it.
 */

type Words = Readonly<Record<string, string>>

/**
 * The change log's rules in the words of the business: what a table and a
 * field are called, where a record's name is. The foundation holds them
 * (ADR 0010), this application's vocabulary fills them in.
 */
export const audit = auditLanguage(auditVocabulary)

/**
 * What a page brings along to name what its changes point at: records,
 * people and devices. The log of a business and the log of the instance
 * (#188) both carry it, and everything here reads nothing else.
 */
export type AuditNames = Pick<AuditPage, 'titles' | 'people' | 'devices'>

const numberRangeWords: Readonly<Record<NumberRangeKey, string>> = {
  job: 'Aufträge',
  quote: 'Angebote',
  order_confirmation: 'Auftragsbestätigungen',
  delivery_note: 'Lieferscheine',
  report: 'Regieberichte',
  invoice: 'Rechnungen',
}

/** The forms of the trade packages by their key, "Prüfprotokoll Erstprüfung nach DIN VDE 0100-600". */
const formWords: Words = Object.fromEntries(
  elektroRegistry.current().map((definition) => [definition.key, definition.title]),
)

/** Fields whose value is a key into a list of words, by table. */
const valueWords: Readonly<Record<string, Readonly<Record<string, Words>>>> = {
  customers: { kind: customerKindLabel },
  installations: { kind: installationKindLabel },
  jobs: { kind: jobKindLabel, status: jobStatusLabel },
  tasks: { status: taskStatusLabel },
  documents: {
    kind: documentKindLabel,
    status: documentStateLabel,
    tax_treatment: taxTreatmentLabel,
  },
  document_lines: { unit: lineUnitLabel, vat_rate: vatRateLabel },
  text_snippets: { purpose: snippetPurposeLabel },
  distribution_boards: { kind: distributionBoardKindLabel },
  circuits: {
    overcurrent_device: overcurrentDeviceLabel,
    trip_characteristic: tripCharacteristicLabel,
    rcd_type: rcdTypeLabel,
    cable_installation_method: cableInstallationMethodLabel,
  },
  time_entries: { kind: timeEntryKindLabel },
  tenant_sessions: { sign_in_method: { password: 'Passwort', passkey: 'Passkey' } },
  number_ranges: { key: numberRangeWords },
  form_records: { definition_key: formWords },
}

/** Fields shown as "gesetzt" and never as their value: keys of a browser and hashes of a secret. */
const hiddenFields: ReadonlySet<string> = new Set(['p256dh', 'auth', 'endpoint', 'token_hash'])

/** Fields that hold a fingerprint, shortened to its start. */
const hashFields: ReadonlySet<string> = new Set(['sha256', 'preview_sha256', 'content_fingerprint'])

/** How long a text may be in a cell before it is cut. */
const longestValue = 300

/** How long the name of a record may be in the list. */
const longestTitle = 80

/** A list of keys the database keeps as an array, `{owner,office}` or `["quote"]`. */
function keysOf(raw: string): readonly string[] | null {
  const trimmed = raw.trim()

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)

      return Array.isArray(parsed) ? parsed.map(String) : null
    } catch {
      return null
    }
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}') && !trimmed.includes(':')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((part) => part.replace(/^"|"$/g, ''))
      .filter((part) => part !== '')
  }

  return null
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A device as a person recognises it: its browser while one of its sessions
 * is still there, else the end of its id, which at least tells two devices
 * apart. The id is minted on the device (`app/device.ts`), random in its last
 * part; one that is not a uuid, from a test or the preview, is shown whole.
 */
export function deviceWords(deviceId: string, page: Pick<AuditPage, 'devices'>): string {
  const agent = page.devices[deviceId]

  if (agent) {
    return deviceName(agent)
  }

  return uuidPattern.test(deviceId)
    ? `Gerät ${deviceId.replace(/-/g, '').slice(-6).toUpperCase()}`
    : `Gerät ${deviceId}`
}

/** What a record is called: its name as the log last had it, or what it is. */
export function recordTitle(table: string, id: string, page: AuditNames): string {
  const found = page.titles[id]

  if (!found || found.title === null) {
    return `${audit.tableLabel(table)} ohne Bezeichnung`
  }

  const title =
    found.field === null
      ? found.title
      : (auditValue(found.table, found.field, found.title, page) ?? found.title)

  // A note is named by its text, and a list is no place for a paragraph.
  return title.length > longestTitle ? `${title.slice(0, longestTitle).trimEnd()}…` : title
}

/** What kind of record it is: for a document its kind, "Angebot", otherwise the table. */
export function recordKind(table: string, id: string, page: AuditNames): string {
  const kind = page.titles[id]?.kind

  if (table === 'documents' && kind) {
    return (documentKindLabel as Words)[kind] ?? 'Beleg'
  }

  return audit.tableLabel(table)
}

/**
 * One value of one field, as the office reads it, or null for no value, which
 * the screen writes as "leer".
 */
export function auditValue(
  table: string,
  field: string,
  raw: string | null,
  page: AuditNames,
): string | null {
  if (raw === null || raw === '') {
    return null
  }

  const words = valueWords[table]?.[field]

  if (words) {
    return words[raw] ?? raw
  }

  if (hiddenFields.has(field)) {
    return 'gesetzt'
  }

  if (hashFields.has(field)) {
    return `${raw.slice(0, 12)}…`
  }

  if (field === 'roles') {
    const keys = keysOf(raw)

    return keys ? keys.map((key) => (roleLabel as Words)[key] ?? key).join(', ') : raw
  }

  if (field === 'kinds') {
    const keys = keysOf(raw)

    return keys ? keys.map((key) => (documentKindLabel as Words)[key] ?? key).join(', ') : raw
  }

  // What a role may do (ADR 0010), in the words a refusal uses for a right.
  // One this version does not know stays as it is written.
  if (table === 'tenant_roles' && field === 'rights') {
    const keys = keysOf(raw)

    if (!keys) {
      return raw
    }

    return keys.length === 0
      ? null
      : keys.map((key) => (permissionLabel as Words)[key] ?? key).join(', ')
  }

  // The settings of the instance (#188): a list of servers, and a time the
  // database writes with seconds that nobody set.
  if (field === 'mail_internal_hosts') {
    const keys = keysOf(raw)

    return keys ? (keys.length === 0 ? null : keys.join(', ')) : raw
  }

  if (field === 'backup_time' && /^\d{2}:\d{2}/.test(raw)) {
    return raw.slice(0, 5)
  }

  if (audit.isPersonField(field)) {
    return page.people[raw] ?? 'Eine Person, die es nicht mehr gibt'
  }

  const target = audit.referenceOf(field)

  if (target) {
    return recordTitle(target, raw, page)
  }

  if (field === 'device_id') {
    return deviceWords(raw, page)
  }

  if (raw === 'true') {
    return 'Ja'
  }

  if (raw === 'false') {
    return 'Nein'
  }

  if (field.endsWith('_cents') && /^-?\d+$/.test(raw)) {
    return euros(Number(raw))
  }

  if (field.endsWith('_milli') && /^-?\d+$/.test(raw)) {
    return amount(Number(raw))
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return date(raw)
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    return moment(raw)
  }

  return raw.length > longestValue ? `${raw.slice(0, longestValue)}…` : raw
}

/** A field with its name, "Straße". */
export function fieldWords(table: string, field: string): string {
  return audit.fieldName(table, field) ?? field
}

/**
 * The fields of a change a person wants to see: not the key, the business and
 * the moment the row was made, which every new row carries and which say
 * nothing, and not the device, which the change names on its own.
 *
 * In the order of their German names, the name of the record first. The log
 * keeps them in the order of the column names, which is English and reads as
 * no order at all: "Käuferreferenz, Ort, Land" for a new customer.
 */
export function shownFields(change: AuditChange): readonly AuditFieldChange[] {
  const naming = audit.titleFields(change.table)
  const rank = (field: string) => {
    const place = naming.indexOf(field)

    return place === -1 ? naming.length : place
  }

  return change.fields
    .filter((field) => !audit.isQuiet(field.field) && field.field !== 'device_id')
    .sort(
      (one, other) =>
        rank(one.field) - rank(other.field) ||
        fieldWords(change.table, one.field).localeCompare(
          fieldWords(change.table, other.field),
          'de',
        ),
    )
}

/**
 * The change in a few words, for the column "Änderung": what happened to the
 * record where one word says it, the fields that moved otherwise.
 */
export function changeSummary(change: AuditChange): string {
  if (change.operation === 'insert') {
    return 'Angelegt'
  }

  if (change.operation === 'delete') {
    return 'Entfernt'
  }

  const deleted = change.fields.find((field) => field.field === 'deleted_at')

  if (deleted) {
    return deleted.after === null ? 'Wiederhergestellt' : 'Als gelöscht markiert'
  }

  const status = change.fields.find((field) => field.field === 'status')

  if (change.table === 'documents' && status?.after) {
    const said: Words = {
      issued: 'Festgeschrieben',
      cancelled: 'Storniert',
      signed: 'Unterschrieben',
    }
    const word = said[status.after]

    if (word) {
      return word
    }
  }

  const names = shownFields(change).map((field) => fieldWords(change.table, field.field))

  if (names.length === 0) {
    return 'Ohne sichtbare Änderung'
  }

  return names.length <= 3
    ? names.join(', ')
    : `${names.slice(0, 3).join(', ')} und ${String(names.length - 3)} weitere`
}

/** Who, from where and on which way, in the line under the person. */
export function wayWords(
  change: AuditChange,
  page: AuditNames,
): {
  readonly person: string | null
  readonly device: string | null
  readonly way: string
  readonly direct: boolean
} {
  const way = audit.way(change.reason, change.databaseRole)

  return {
    person:
      change.userId === null
        ? null
        : (page.people[change.userId] ?? 'Eine Person, die es nicht mehr gibt'),
    device: change.deviceId === null ? null : deviceWords(change.deviceId, page),
    way: way.text,
    direct: way.direct,
  }
}

/** Where a record is opened in the office, for the records that have a screen. */
export function recordHref(table: string, id: string): string | null {
  const screens: Readonly<Record<string, string>> = {
    customers: '/kunden/',
    sites: '/objekte/',
    installations: '/anlagen/',
    jobs: '/auftraege/',
    documents: '/belege/',
    distribution_boards: '/verteiler/',
    circuits: '/stromkreise/',
    inverters: '/wechselrichter/',
    pv_strings: '/strings/',
    form_records: '/pruefprotokolle/',
    articles: '/artikel/',
    suppliers: '/lieferanten/',
  }
  const start = screens[table]

  return start ? `${start}${id}` : null
}

/** The label of the link to a record, "Zum Kunden". */
export function recordLinkWords(table: string): string {
  const words: Readonly<Record<string, string>> = {
    customers: 'Zum Kunden',
    sites: 'Zum Objekt',
    installations: 'Zur Anlage',
    jobs: 'Zum Auftrag',
    documents: 'Zum Beleg',
    distribution_boards: 'Zum Verteiler',
    circuits: 'Zum Stromkreis',
    inverters: 'Zum Wechselrichter',
    pv_strings: 'Zum String',
    form_records: 'Zum Protokoll',
    articles: 'Zum Artikel',
    suppliers: 'Zum Lieferanten',
  }

  return words[table] ?? 'Zum Datensatz'
}
