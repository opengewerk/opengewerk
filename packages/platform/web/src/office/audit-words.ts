import {
  type AuditChange,
  type AuditFieldChange,
  type AuditLanguage,
  auditLanguage,
  type AuditPage,
  type AuditVocabulary,
} from '@opengewerk/platform-domain'

import { useApplication } from '../application.js'
import { amount, date, euros, moment } from '../format.js'
import { deviceName } from '../session/device-name.js'

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
 * of an application hold, and where its records are opened, the application
 * says in its `AuditScreenWords`.
 */

type Words = Readonly<Record<string, string>>

/**
 * What a page brings along to name what its changes point at: records,
 * people and devices. The log of a tenant and the log of the instance both
 * carry it, and everything here reads nothing else.
 */
export type AuditNames = Pick<AuditPage, 'titles' | 'people' | 'devices'>

/**
 * What an application says about the values in its log and the ways from it
 * to its screens, beside the vocabulary its server is told as well.
 */
export interface AuditScreenWords {
  /** The vocabulary of the log, the same value the server is handed. */
  readonly vocabulary: AuditVocabulary
  /** Fields whose value is a key into a list of words, by table, then by field. */
  readonly values?: Readonly<Record<string, Readonly<Record<string, Words>>>>
  /** Fields that hold a list of keys, by field, with the words for each key. */
  readonly lists?: Readonly<Record<string, Words>>
  /** Fields shown as "gesetzt" and never as their value, beside the foundation's own. */
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
  /** Where a record is opened, for the records that have a screen of their own. */
  readonly href?: (table: string, id: string) => string | null
  /** The label of the link to a record, "Zum Kunden". */
  readonly linkWords?: (table: string) => string | null
  /** Beside the chip of one record's log: what it takes in, by the record's table. */
  readonly partsWords?: Readonly<Record<string, string>>
}

/** Keys of the browser and the hash of a link: never shown, only that they are set. */
const foundationHidden: readonly string[] = ['token_hash']

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
export interface AuditWords {
  readonly language: AuditLanguage
  readonly screen: AuditScreenWords
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
  /** Where a record is opened, or null. */
  readonly recordHref: (table: string, id: string) => string | null
  /** The label of the link to a record. */
  readonly recordLinkWords: (table: string) => string
}

const nobody = 'Eine Person, die es nicht mehr gibt'

/** The words of the log for an application. */
export function auditWords(screen: AuditScreenWords): AuditWords {
  const language = auditLanguage(screen.vocabulary)
  const hidden = new Set([...foundationHidden, ...(screen.hidden ?? [])])
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

    if (hidden.has(field)) {
      return 'gesetzt'
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
    screen,
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
    recordHref: (table, id) => screen.href?.(table, id) ?? null,
    recordLinkWords: (table) => screen.linkWords?.(table) ?? 'Zum Datensatz',
  }
}

/** The words made from one application's value, once per value. */
const made = new WeakMap<AuditScreenWords, AuditWords>()

/**
 * The words of the log for the application over this screen. A screen outside
 * an office that hands them in has nothing to name a record with, and says so
 * instead of showing a column name.
 */
export function useAuditWords(): AuditWords {
  const screen = useApplication().audit

  if (!screen) {
    throw new Error(
      'Diese Ansicht braucht die Wörter des Änderungsprotokolls, die dieser Einstieg nicht mitbringt.',
    )
  }

  const known = made.get(screen)

  if (known) {
    return known
  }

  const words = auditWords(screen)

  made.set(screen, words)

  return words
}
