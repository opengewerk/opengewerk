import type { JobId, LocationConsentId, Synced, TenantOwned, TimeEntryId } from './identifier.js'

/**
 * What a stretch of time was (#76, 4.4). Travel and breaks are kinds of their
 * own because they are paid and counted differently, and a break is what the
 * working time rules look for.
 */
export const timeEntryKinds = ['work', 'travel', 'break'] as const

export type TimeEntryKind = (typeof timeEntryKinds)[number]

/**
 * One stretch of somebody's time, from its start to its end, as the record
 * § 17 MiLoG asks for: beginning, end and so the duration.
 *
 * Written once and never changed, like an issued document. A mistake is put
 * right by a new entry that names the one it corrects and says why, and an
 * entry that should not have been written at all is withdrawn the same way,
 * by a correction that carries `withdrawn`. The old entry stays, readable, for
 * the two years the law keeps it; what counts is worked out from the chain
 * (`effectiveEntries`).
 *
 * Whose time it is, the server writes from the request: nobody records time
 * for somebody else.
 *
 * A place is recorded only with the person's consent, at start and end and
 * nowhere in between, in millionths of a degree so that it is a whole number
 * like everything else stored here.
 */
export interface TimeEntry extends Synced {
  readonly id: TimeEntryId
  readonly userId: string
  readonly kind: TimeEntryKind
  readonly jobId: JobId | null
  readonly startedAt: Date
  readonly endedAt: Date
  readonly note: string | null
  readonly correctsEntryId: TimeEntryId | null
  readonly withdrawn: boolean
  readonly startLatitudeMicro: number | null
  readonly startLongitudeMicro: number | null
  readonly endLatitudeMicro: number | null
  readonly endLongitudeMicro: number | null
}

/**
 * Somebody's answer to whether their place may be recorded at start and end,
 * one row per answer. The latest counts; the ones before stay as the record of
 * when consent was given and when it was withdrawn.
 */
export interface LocationConsent extends TenantOwned {
  readonly id: LocationConsentId
  readonly userId: string
  readonly given: boolean
}

/** The longest a single entry may run: a day, so that a night job past midnight is one entry. */
export const longestEntryMinutes = 24 * 60

function instant(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime()
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value)

    return Number.isNaN(parsed) ? null : parsed
  }

  return null
}

/** Whole minutes between two instants, as a list and the warnings count them. */
export function minutesBetween(start: Date | string, end: Date | string): number {
  return Math.round(((instant(end) ?? 0) - (instant(start) ?? 0)) / 60_000)
}

/** Why an entry's times cannot be recorded, or null when they can. */
export function timeEntryProblem(entry: {
  readonly startedAt?: unknown
  readonly endedAt?: unknown
}): string | null {
  const start = instant(entry.startedAt)
  const end = instant(entry.endedAt)

  if (start === null || end === null) {
    return 'Beginn und Ende müssen Zeitpunkte sein.'
  }

  if (end <= start) {
    return 'Das Ende liegt nicht nach dem Beginn.'
  }

  return (end - start) / 60_000 > longestEntryMinutes
    ? 'Ein Eintrag dauert höchstens 24 Stunden. Eine längere Zeit gehört in zwei Einträge.'
    : null
}

function named(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

/**
 * Why a correction cannot be recorded, or null when it can: it needs a reason,
 * and only an entry that corrects another can withdraw it.
 */
export function correctionProblem(entry: {
  readonly correctsEntryId?: unknown
  readonly note?: unknown
  readonly withdrawn?: unknown
}): string | null {
  if (entry.withdrawn === true && !named(entry.correctsEntryId)) {
    return 'Zurückziehen lässt sich nur ein Eintrag, den es gibt.'
  }

  if (named(entry.correctsEntryId) && !(typeof entry.note === 'string' && entry.note.trim())) {
    return 'Eine Korrektur braucht einen Grund.'
  }

  return null
}

function placeProblem(latitude: unknown, longitude: unknown): string | null {
  if (latitude === null || latitude === undefined) {
    return longitude === null || longitude === undefined
      ? null
      : 'Ein Standort besteht aus Breite und Länge.'
  }

  if (!Number.isInteger(latitude) || !Number.isInteger(longitude)) {
    return 'Ein Standort besteht aus Breite und Länge in millionstel Grad.'
  }

  return Math.abs(latitude as number) <= 90_000_000 && Math.abs(longitude as number) <= 180_000_000
    ? null
    : 'Der Standort liegt nicht auf der Erde.'
}

/** Why the places of an entry cannot be recorded, or null when they can. */
export function locationProblem(entry: {
  readonly startLatitudeMicro?: unknown
  readonly startLongitudeMicro?: unknown
  readonly endLatitudeMicro?: unknown
  readonly endLongitudeMicro?: unknown
}): string | null {
  return (
    placeProblem(entry.startLatitudeMicro, entry.startLongitudeMicro) ??
    placeProblem(entry.endLatitudeMicro, entry.endLongitudeMicro)
  )
}

/** The fields that carry a place. Stripped by the server without consent. */
export const locationFields = [
  'startLatitudeMicro',
  'startLongitudeMicro',
  'endLatitudeMicro',
  'endLongitudeMicro',
] as const

/**
 * The entries that count: every one nothing corrects, and no withdrawal. A
 * correction takes the place of what it corrects; a withdrawal takes it away
 * and counts for nothing itself.
 */
export function effectiveEntries<
  Entry extends {
    readonly id?: unknown
    readonly correctsEntryId?: unknown
    readonly withdrawn?: unknown
  },
>(entries: readonly Entry[]): Entry[] {
  const corrected = new Set(entries.map((entry) => entry.correctsEntryId).filter((id) => named(id)))

  return entries.filter((entry) => !corrected.has(entry.id) && entry.withdrawn !== true)
}
