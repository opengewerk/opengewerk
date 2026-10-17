import { addDays } from './calendar.js'
import type { Id, IsoDate, Synced } from './identifier.js'

/**
 * The qualifications of the people who work for a tenant (ADR 0012,
 * opengewerk-haustechnik#337): what a person may carry out, as a kind of
 * qualification held until a day or without one, with its certificate. A
 * building block of the foundation, so that every application keeps one
 * model of them; the first binds it with #337, the craft software with the
 * file of its staff.
 *
 * Where the kinds come from stays with the application: a catalogue of
 * packages names its kinds by a key of its own, and a tenant adds kinds of
 * its own beside them, which the table factory of the server keeps. What an
 * application asks of a qualification, the kind a task requires, it asks
 * with `qualificationCheck`.
 */

export type QualificationId = Id<'qualification'>
export type QualificationKindId = Id<'qualification-kind'>

/**
 * The levels a person holds, from the employee instructed to the person
 * competent to test (DGUV Vorschrift 3, § 2 Abs. 6 BetrSichV). A body of
 * inspection, an expert and a laboratory are firms and hold none.
 */
export const personLevels = ['instructed_person', 'skilled_person', 'competent_person'] as const

export type PersonLevel = (typeof personLevels)[number]

export const personLevelLabel: Readonly<Record<PersonLevel, string>> = {
  instructed_person: 'Unterwiesene Person',
  skilled_person: 'Fachkraft',
  competent_person: 'Zur Prüfung befähigte Person',
}

/** The bounds of what a qualification carries, the same in a form, a route and the database. */
export const qualificationLimits = {
  kindLabel: 120,
  /** The key a catalogue gives a kind, "<package>.<key>". */
  kindKey: 120,
  note: 500,
} as const

/** A kind of qualification, from a catalogue of the application or the tenant's own. */
export interface QualificationKind {
  /** "<package>.<key>" for a kind of a catalogue, the id of the row for one of the tenant's own. */
  readonly key: string
  readonly label: string
  readonly level: PersonLevel
}

/** A kind the tenant adds to those of the catalogue, marked and never removed. */
export interface OwnQualificationKind extends Synced {
  readonly id: QualificationKindId
  readonly label: string
  readonly level: PersonLevel
}

/** A qualification a person holds: one kind, until a day or without one, with its certificate. */
export interface Qualification extends Synced {
  readonly id: QualificationId
  readonly userId: string
  /** The kind from a catalogue, or null where it is one of the tenant's own. */
  readonly kindKey: string | null
  /** The tenant's own kind, or null where it comes from a catalogue. */
  readonly ownKindId: QualificationKindId | null
  /** The last day it holds; null where it does not expire. */
  readonly validUntil: IsoDate | null
  readonly note: string | null
  /** The certificate, a file of the tenant's store, where there is one. */
  readonly certificateSha256: string | null
}

/** How a qualification stands on a day: it holds, its end is near, or it has run out. */
export type QualificationStanding = 'valid' | 'expiring' | 'expired'

export const qualificationStandingLabel: Readonly<Record<QualificationStanding, string>> = {
  valid: 'Gültig',
  expiring: 'Läuft bald ab',
  expired: 'Abgelaufen',
}

/**
 * How a qualification stands on a day. It holds through its last day; from
 * the first day of the lead before it, its end is near.
 */
export function qualificationStanding(
  qualification: Pick<Qualification, 'validUntil'>,
  day: IsoDate,
  leadDays: number,
): QualificationStanding {
  if (qualification.validUntil === null) {
    return 'valid'
  }

  if (qualification.validUntil < day) {
    return 'expired'
  }

  return addDays(day, leadDays) >= qualification.validUntil ? 'expiring' : 'valid'
}

/** What a person holds of the kind a task requires, on a day. */
export type QualificationCheck = 'held' | 'expired' | 'missing'

/**
 * Whether a person holds the kind a task requires on a day: one of their
 * qualifications of that kind that holds is enough; one that ran out says
 * so; none at all is missing. A qualification taken out of the records
 * counts for nothing.
 */
export function qualificationCheck(
  held: readonly {
    readonly kindKey: string | null
    readonly ownKindId: string | null
    readonly validUntil: IsoDate | null
    readonly deletedAt: Date | string | null
  }[],
  requiredKey: string,
  day: IsoDate,
): QualificationCheck {
  const ofKind = held.filter(
    (each) =>
      each.deletedAt === null && (each.kindKey === requiredKey || each.ownKindId === requiredKey),
  )

  if (ofKind.length === 0) {
    return 'missing'
  }

  return ofKind.some((each) => each.validUntil === null || each.validUntil >= day)
    ? 'held'
    : 'expired'
}

type Problems = Record<string, string>

const calendarDay = (value: unknown): value is IsoDate =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

/** What is wrong with a kind of the tenant's own, by field. */
export function qualificationKindProblems(
  kind: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}
  const label = typeof kind['label'] === 'string' ? kind['label'].trim() : ''

  if (label === '') {
    problems['label'] = 'Die Bezeichnung fehlt.'
  } else if (label.length > qualificationLimits.kindLabel) {
    problems['label'] = `Höchstens ${String(qualificationLimits.kindLabel)} Zeichen.`
  }

  if (!(personLevels as readonly unknown[]).includes(kind['level'])) {
    problems['level'] =
      'Die Stufe ist eine unterwiesene Person, eine Fachkraft oder eine zur Prüfung befähigte Person.'
  }

  return problems
}

/**
 * What is wrong with a qualification, by field: a person, exactly one kind,
 * a last day where it has one, and a note within its bound. Whether the
 * person works for the tenant and the kind is known, the application asks.
 */
export function qualificationProblems(
  qualification: Readonly<Record<string, unknown>>,
): Readonly<Problems> {
  const problems: Problems = {}
  const userId = qualification['userId']

  if (typeof userId !== 'string' || userId.trim() === '') {
    problems['userId'] = 'Wählen Sie die Person.'
  }

  const kindKey = qualification['kindKey'] ?? null
  const ownKindId = qualification['ownKindId'] ?? null
  const named = [kindKey, ownKindId].filter((each) => each !== null)

  if (
    named.length !== 1 ||
    !named.every((each) => typeof each === 'string' && each !== '') ||
    (typeof kindKey === 'string' && kindKey.length > qualificationLimits.kindKey)
  ) {
    problems['kind'] = 'Wählen Sie die Art der Qualifikation.'
  }

  const validUntil = qualification['validUntil'] ?? null

  if (validUntil !== null && !calendarDay(validUntil)) {
    problems['validUntil'] = 'Gültig bis ist ein Tag, geschrieben 2026-10-03, oder leer.'
  }

  const note = qualification['note'] ?? null

  if (
    note !== null &&
    (typeof note !== 'string' || note.trim().length > qualificationLimits.note)
  ) {
    problems['note'] = `Höchstens ${String(qualificationLimits.note)} Zeichen.`
  }

  return problems
}
