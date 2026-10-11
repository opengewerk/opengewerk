import type { AuditChange, AuditFieldChange } from './audit.js'
import {
  type AuditLanguage,
  auditLanguage,
  type AuditPage,
  type AuditVocabulary,
  withheldAuditValue,
} from './audit-log.js'
import { deviceName } from './device-name.js'

/**
 * The change log in words a person reads (ADR 0010): what a value, a change,
 * a record and a device are called. The log holds text as the database wrote
 * it, `true`, `12500`, a key; a person reads "Ja", "125,00 €" and a name.
 *
 * A value nothing here knows stays as it is. The log is read to find out what
 * happened, and a raw value says that, where an empty cell would hide it.
 *
 * What the foundation's own fields hold, roles, rights, the way somebody
 * signed in, the settings of the instance, is written here. What the fields
 * of an application hold the application says in its `AuditValueWords`.
 *
 * The same words on the screen and in the log as a table, which the server
 * writes (opengewerk-haustechnik#236): the numbers and the days come from
 * whoever asks (`AuditFormat`), a screen with the clock of its device and a
 * server with the clock of Germany.
 */

type Words = Readonly<Record<string, string>>

/**
 * What a page brings along to name what its changes point at: records,
 * people and devices. The log of a tenant and the log of the instance both
 * carry it, and everything here reads nothing else.
 */
export type AuditNames = Pick<AuditPage, 'titles' | 'people' | 'devices'>

/** How a number, an amount, a day and a moment are written where the words are read. */
export interface AuditFormat {
  readonly euros: (cents: number) => string
  readonly amount: (milli: number) => string
  readonly date: (value: string) => string
  readonly moment: (value: string) => string
}

/**
 * What an application says about the values in its log, beside the
 * vocabulary its server is told as well.
 */
export interface AuditValueWords {
  /** The vocabulary of the log, the same value the server is handed. */
  readonly vocabulary: AuditVocabulary
  /** Fields whose value is a key into a list of words, by table, then by field. */
  readonly values?: Readonly<Record<string, Readonly<Record<string, Words>>>>
  /** Fields that hold a list of keys, by field, with the words for each key. */
  readonly lists?: Readonly<Record<string, Words>>
  /**
   * Fields shown as "gesetzt" and never as their value, whatever table they
   * are on. What the log keeps to itself the vocabulary says (`secretFields`),
   * and the server does not send it; this is for a value the page may have
   * and should not spell out.
   */
  readonly hidden?: readonly string[]
  /** Fields that hold a fingerprint, shortened to its start. */
  readonly fingerprints?: readonly string[]
  /**
   * A change in one word where the application has one, "Festgeschrieben",
   * or null to leave it to the fields that moved.
   */
  readonly summary?: (change: AuditChange) => string | null
  /**
   * What sort of record it is where the table alone does not say, by its
   * `kind`; null for the label of the table.
   */
  readonly kindOf?: (table: string, kind: string | null) => string | null
}

/** What the foundation's own fields hold as a key, by table, then by field. */
const foundationValues: Readonly<Record<string, Readonly<Record<string, Words>>>> = {
  tenant_sessions: { sign_in_method: { password: 'Passwort', passkey: 'Passkey' } },
}

/** How long a text may be in a cell before it is cut. */
const longestValue = 300

/** How long the name of a record may be in the list. */
const longestTitle = 80

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A list of keys the database keeps as an array, `{a,b}` or `["a"]`. */
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

/** The words of the log and the rules under them, made once from what an application says. */
export interface AuditTextWords {
  readonly language: AuditLanguage
  /** A device by its browser while it is known, by the end of its id after. */
  readonly deviceWords: (deviceId: string, page: Pick<AuditPage, 'devices'>) => string
  /** What a record is called: its name as the log last had it, or what it is. */
  readonly recordTitle: (table: string, id: string, page: AuditNames) => string
  /** What sort of record it is. */
  readonly recordKind: (table: string, id: string, page: AuditNames) => string
  /** One value of one field, or null for no value, which a screen writes as "leer". */
  readonly auditValue: (
    table: string,
    field: string,
    raw: string | null,
    page: AuditNames,
  ) => string | null
  /** A field with its name. */
  readonly fieldWords: (table: string, field: string) => string
  /** The fields of a change a person wants to see, the name of the record first. */
  readonly shownFields: (change: AuditChange) => readonly AuditFieldChange[]
  /** The change in a few words, for the column "Änderung". */
  readonly changeSummary: (change: AuditChange) => string
  /** Who, from where and on which way. */
  readonly wayWords: (
    change: AuditChange,
    page: AuditNames,
  ) => {
    readonly person: string | null
    readonly device: string | null
    readonly way: string
    readonly direct: boolean
  }
}

const nobody = 'Eine Person, die es nicht mehr gibt'

/** The words of the log for an application, with numbers and days as `format` writes them. */
export function auditTextWords(screen: AuditValueWords, format: AuditFormat): AuditTextWords {
  const { amount, date, euros, moment } = format
  const language = auditLanguage(screen.vocabulary)
  const hidden = new Set(screen.hidden ?? [])
  const fingerprints = new Set(screen.fingerprints ?? [])

  const deviceWords = (deviceId: string, page: Pick<AuditPage, 'devices'>): string => {
    const agent = page.devices[deviceId]

    if (agent) {
      return deviceName(agent)
    }

    return uuidPattern.test(deviceId)
      ? `Gerät ${deviceId.replace(/-/g, '').slice(-6).toUpperCase()}`
      : `Gerät ${deviceId}`
  }

  const recordTitle = (table: string, id: string, page: AuditNames): string => {
    const found = page.titles[id]

    if (!found || found.title === null) {
      return `${language.tableLabel(table)} ohne Bezeichnung`
    }

    const title =
      found.field === null
        ? found.title
        : (auditValue(found.table, found.field, found.title, page) ?? found.title)

    // A record named by a text of its own, and a list is no place for a paragraph.
    return title.length > longestTitle ? `${title.slice(0, longestTitle).trimEnd()}…` : title
  }

  const auditValue = (
    table: string,
    field: string,
    raw: string | null,
    page: AuditNames,
  ): string | null => {
    if (raw === null || raw === '') {
      return null
    }

    const words = screen.values?.[table]?.[field] ?? foundationValues[table]?.[field]

    if (words) {
      return words[raw] ?? raw
    }

    // Kept back by the server already; asked here as well, so that a page
    // never spells such a value out, whatever it was handed.
    if (language.isSecret(table, field) || hidden.has(field)) {
      return withheldAuditValue
    }

    if (fingerprints.has(field)) {
      return `${raw.slice(0, 12)}…`
    }

    const listed = field === 'roles' ? screen.vocabulary.roles : screen.lists?.[field]

    if (listed) {
      const keys = keysOf(raw)

      return keys ? keys.map((key) => listed[key] ?? key).join(', ') : raw
    }

    // What a role may do, in the words a refusal uses for a right. One this
    // version does not know stays as it is written.
    if (table === 'tenant_roles' && field === 'rights') {
      const keys = keysOf(raw)

      if (!keys) {
        return raw
      }

      return keys.length === 0
        ? null
        : keys.map((key) => screen.vocabulary.rights[key] ?? key).join(', ')
    }

    // The settings of the instance: a list of servers, and a time the
    // database writes with seconds that nobody set.
    if (field === 'mail_internal_hosts') {
      const keys = keysOf(raw)

      return keys ? (keys.length === 0 ? null : keys.join(', ')) : raw
    }

    if (field === 'backup_time' && /^\d{2}:\d{2}/.test(raw)) {
      return raw.slice(0, 5)
    }

    if (language.isPersonField(field)) {
      return page.people[raw] ?? nobody
    }

    const target = language.referenceOf(field)

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

  const fieldWords = (table: string, field: string): string =>
    language.fieldName(table, field) ?? field

  const shownFields = (change: AuditChange): readonly AuditFieldChange[] => {
    const naming = language.titleFields(change.table)
    const rank = (field: string) => {
      const place = naming.indexOf(field)

      return place === -1 ? naming.length : place
    }

    return change.fields
      .filter((field) => !language.isQuiet(field.field) && field.field !== 'device_id')
      .sort(
        (one, other) =>
          rank(one.field) - rank(other.field) ||
          fieldWords(change.table, one.field).localeCompare(
            fieldWords(change.table, other.field),
            'de',
          ),
      )
  }

  const changeSummary = (change: AuditChange): string => {
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

    const own = screen.summary?.(change) ?? null

    if (own !== null) {
      return own
    }

    const names = shownFields(change).map((field) => fieldWords(change.table, field.field))

    if (names.length === 0) {
      return 'Ohne sichtbare Änderung'
    }

    return names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 3).join(', ')} und ${String(names.length - 3)} weitere`
  }

  return {
    language,
    deviceWords,
    recordTitle,
    recordKind: (table, id, page) =>
      screen.kindOf?.(table, page.titles[id]?.kind ?? null) ?? language.tableLabel(table),
    auditValue,
    fieldWords,
    shownFields,
    changeSummary,
    wayWords(change, page) {
      const way = language.way(change.reason, change.databaseRole)

      return {
        person: change.userId === null ? null : (page.people[change.userId] ?? nobody),
        device: change.deviceId === null ? null : deviceWords(change.deviceId, page),
        way: way.text,
        direct: way.direct,
      }
    },
  }
}

/**
 * The columns of the log as a table (opengewerk-haustechnik#236): a row for
 * each field a change shows, as the opened change lists them, with the
 * record, the change and who made it on each, so that a row says what it is
 * wherever a spreadsheet sorts it. A change without a field it shows has a
 * row of its own.
 */
export const auditTableColumns = {
  moment: 'Zeitpunkt',
  record: 'Datensatz',
  kind: 'Art',
  change: 'Änderung',
  field: 'Feld',
  before: 'Vorher',
  after: 'Nachher',
  person: 'Person',
  device: 'Gerät',
  way: 'Weg',
} as const

/**
 * Why the log is no table for somebody who reads it and may not see the
 * staff. Every row names who made a change, and a record is often called by
 * a person or holds one in a field: a log that left the people out would
 * still name them, so it goes out whole or not at all.
 */
export const auditTableNamesPeople =
  'Das Änderungsprotokoll nennt Personen. Als Tabelle bekommt es, wer die Zugänge sehen darf.'

/** What the opened change writes for a field without a value. */
export const emptyAuditValue = 'leer'

const money = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
})
const quantity = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})
const dayInGermany = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeZone: 'Europe/Berlin',
})
const calendarDay = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' })
const momentInGermany = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Berlin',
})

/** A text as a moment, or nothing where it is none. */
function at(value: string): Date | null {
  const moment = new Date(value)

  return Number.isNaN(moment.getTime()) ? null : moment
}

/**
 * The formats of the log as the office writes them, by the clock of Germany
 * whatever the clock of the machine says: for the log as a table, which the
 * server writes. A day as the records keep it is written as it is.
 */
export const auditFormatInGermany: AuditFormat = {
  euros: (cents) => money.format(cents / 100),
  amount: (milli) => quantity.format(milli / 1000),
  date: (value) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const day = at(`${value}T00:00:00Z`)

      return day === null ? '' : calendarDay.format(day)
    }

    const moment = at(value)

    return moment === null ? '' : dayInGermany.format(moment)
  },
  moment: (value) => {
    const moment = at(value)

    return moment === null ? '' : momentInGermany.format(moment)
  },
}
