import { berlinClock, type IsoDate, type Synced } from '@opengewerk/platform-domain'

import type { OnCallShiftId } from './identifier.js'

/**
 * A time of the on-call plan (#293, Feature-Gliederung 4.1, 4.3): who is on
 * call from when until when, nights, weekends and public holidays alike, as
 * the time they lie in. Kept in the office at its routes; a device reads the
 * times of its own person, which is what lets it make a service call while
 * on call and not otherwise. Two times swap their people, and the change log
 * keeps who did.
 */
export interface OnCallShift extends Synced {
  readonly id: OnCallShiftId
  readonly userId: string
  readonly startsAt: Date
  readonly endsAt: Date
  readonly note: string | null
}

/** The longest note of a time of the plan, which `on_call_shifts_note_short` holds. */
export const longestOnCallNote = 200

/** The longest time one entry of the plan may span: four weeks, a rota of a month at most. */
export const longestOnCallDays = 28

/** What is wrong with a time of the plan, or null when nothing is. */
export function onCallShiftProblem(startsAt: unknown, endsAt: unknown, note: unknown): string | null {
  const start = startsAt instanceof Date ? startsAt : new Date(String(startsAt))
  const end = endsAt instanceof Date ? endsAt : new Date(String(endsAt))

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Eine Bereitschaft braucht Beginn und Ende.'
  }

  if (end.getTime() <= start.getTime()) {
    return 'Das Ende einer Bereitschaft liegt nach ihrem Beginn.'
  }

  if (end.getTime() - start.getTime() > longestOnCallDays * 86_400_000) {
    return `Eine Bereitschaft dauert höchstens ${String(longestOnCallDays)} Tage. Für einen längeren Plan mehrere eintragen.`
  }

  if (note !== null && note !== undefined && (typeof note !== 'string' || note.length > longestOnCallNote)) {
    return `Die Notiz hat höchstens ${String(longestOnCallNote)} Zeichen.`
  }

  return null
}

/** Whether a time of the plan covers a moment: from its beginning, up to but not including its end. */
export function shiftCovers(
  shift: { readonly startsAt: Date | string; readonly endsAt: Date | string },
  moment: Date,
): boolean {
  const at = moment.getTime()

  return new Date(shift.startsAt).getTime() <= at && at < new Date(shift.endsAt).getTime()
}

/**
 * The kinds of an emergency call (#293), by when the customer called: on a
 * public holiday, at the weekend, at night. Each has its own surcharge.
 */
export const emergencyKinds = ['night', 'weekend', 'holiday'] as const

export type EmergencyKind = (typeof emergencyKinds)[number]

export const emergencyKindLabel: Readonly<Record<EmergencyKind, string>> = {
  night: 'Nacht',
  weekend: 'Wochenende',
  holiday: 'Feiertag',
}

/** The night of the surcharge when the business sets none: 20:00 to 06:00. */
export const defaultNight = { fromMinute: 20 * 60, untilMinute: 6 * 60 } as const

/**
 * The kind of a call at a moment, or null for one in ordinary hours: a public
 * holiday of the business first, then Saturday and Sunday, then the night,
 * which may run over midnight. All in German time.
 */
export function emergencyKindAt(
  moment: Date,
  holidays: ReadonlySet<IsoDate>,
  night: { readonly fromMinute: number; readonly untilMinute: number } = defaultNight,
): EmergencyKind | null {
  const { day, minute } = berlinClock(moment)

  if (holidays.has(day)) {
    return 'holiday'
  }

  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()

  if (weekday === 0 || weekday === 6) {
    return 'weekend'
  }

  const { fromMinute, untilMinute } = night
  const atNight =
    fromMinute <= untilMinute
      ? minute >= fromMinute && minute < untilMinute
      : minute >= fromMinute || minute < untilMinute

  return atNight ? 'night' : null
}

/** What the business set for one kind on a day: a flat amount, or a percentage of the working time. */
export interface EmergencySurcharge {
  readonly flatCents: number
  readonly basisPoints: number
}

/** A line of a document as the surcharge makes it. */
export interface SurchargeLine {
  readonly designation: string
  readonly description: string | null
  readonly quantityMilli: number
  readonly unit: 'flat_rate'
  readonly unitPriceCents: number
  readonly netCents: number
}

/**
 * The line an invoice gets for the surcharge of a call (#293), or null when
 * the business set none for its kind. A flat amount is one flat rate at that
 * amount; a percentage comes on the net of the lines in hours, rounded to the
 * cent. Lines in hours without a price yet give a surcharge of nothing,
 * which the office prices with them.
 */
export function emergencySurchargeLine(
  kind: EmergencyKind,
  surcharge: EmergencySurcharge,
  hourNetCents: number,
): SurchargeLine | null {
  const designation = `Notdienstzuschlag ${emergencyKindLabel[kind]}`

  if (surcharge.flatCents > 0) {
    return {
      designation,
      description: null,
      quantityMilli: 1000,
      unit: 'flat_rate',
      unitPriceCents: surcharge.flatCents,
      netCents: surcharge.flatCents,
    }
  }

  if (surcharge.basisPoints > 0) {
    const cents = Math.round((hourNetCents * surcharge.basisPoints) / 10_000)
    const percent = (surcharge.basisPoints / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })

    return {
      designation,
      description: `${percent} % auf die Arbeitszeit`,
      quantityMilli: 1000,
      unit: 'flat_rate',
      unitPriceCents: cents,
      netCents: cents,
    }
  }

  return null
}

/** What is wrong with a value of a surcharge setting, or null. */
export function emergencyParameterProblem(unit: string, value: number): string | null {
  if (!Number.isInteger(value) || value < 0) {
    return 'Ein Notdienstzuschlag ist eine ganze Zahl, nicht negativ.'
  }

  if (unit === 'minutes' && value >= 24 * 60) {
    return 'Beginn und Ende der Nacht sind Uhrzeiten zwischen 00:00 und 23:59.'
  }

  if (unit === 'basis_points' && value > 100_000) {
    return 'Ein Aufschlag liegt zwischen 0 und 1.000 %.'
  }

  if (unit === 'cents' && value > 100_000_000) {
    return 'Eine Pauschale liegt unter 1.000.000 €.'
  }

  return null
}
