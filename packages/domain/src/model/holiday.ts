import {
  addDays,
  type FederalState,
  federalStates,
  type IsoDate,
  ruleDayIn,
  type RuleRecord,
  type RuleSet,
  scopeOf,
} from '@opengewerk/platform-domain'

/**
 * The public holidays a business counts leave and hours with (#288,
 * Feature-Gliederung 4.4): those of its state from the rule package
 * "holidays", and of the local ones only those it has switched on. A local
 * holiday holds in some places of a state and not in others, Mariä
 * Himmelfahrt in the Catholic parishes of Bavaria, and whether the business
 * works there is something only it knows.
 *
 * Nothing here knows a holiday by name. The days are rules with a source and
 * the time they are in force, like a tax rate, and a new holiday is a record
 * in the package, not a change to this file.
 */
export interface Holiday {
  readonly on: IsoDate
  readonly key: string
  readonly name: string
  readonly source: string
  readonly local: boolean
}

/** Where the business is and which local holidays it counts. */
export interface HolidaySetting {
  readonly state: FederalState
  /** Keys of the local holidays it switched on, `local_holiday.<name>`. */
  readonly local: readonly string[]
}

/** A local holiday a business of a state may switch on, for the settings. */
export interface LocalHoliday {
  readonly key: string
  readonly name: string
  /** Where it holds, as the law says it. */
  readonly where: string
  readonly source: string
}

const statewidePrefix = 'holiday.'
const localPrefix = 'local_holiday.'

/**
 * The rule that makes every Sunday a holiday, which Hessen has (§ 1
 * HFeiertagsG) and no day of the year can say. A flag, in force or not.
 */
export const everySundayKey = 'holiday.every_sunday'

export function isFederalState(value: unknown): value is FederalState {
  return typeof value === 'string' && (federalStates as readonly string[]).includes(value)
}

/** The name of a holiday: its note up to the colon that begins an explanation. */
export function holidayName(record: Pick<RuleRecord, 'key' | 'note'>): string {
  const note = record.note ?? record.key

  return note.split(': ')[0] ?? note
}

function explanation(record: Pick<RuleRecord, 'note'>): string {
  const note = record.note ?? ''
  const at = note.indexOf(': ')

  return at === -1 ? '' : note.slice(at + 2)
}

function inForce(record: RuleRecord, on: IsoDate): boolean {
  return record.validFrom <= on && (record.validUntil === null || on <= record.validUntil)
}

function counts(record: RuleRecord, setting: HolidaySetting): boolean {
  if (scopeOf(record) !== setting.state) {
    return false
  }

  if (record.key.startsWith(localPrefix)) {
    return setting.local.includes(record.key)
  }

  return record.key.startsWith(statewidePrefix) && record.key !== everySundayKey
}

/** The holidays of a year where the business is, earliest first. */
export function holidaysIn(
  rules: RuleSet,
  setting: HolidaySetting,
  year: number,
): readonly Holiday[] {
  const found: Holiday[] = []

  for (const record of rules.all()) {
    if (!counts(record, setting)) {
      continue
    }

    const on = ruleDayIn(record, year)

    if (on !== null && inForce(record, on)) {
      found.push({
        on,
        key: record.key,
        name: holidayName(record),
        source: record.source,
        local: record.key.startsWith(localPrefix),
      })
    }
  }

  return found.sort(
    (one, other) => one.on.localeCompare(other.on) || one.key.localeCompare(other.key),
  )
}

/** The local holidays of a state, one per key, to switch on or off. */
export function localHolidaysOf(rules: RuleSet, state: FederalState): readonly LocalHoliday[] {
  const seen = new Map<string, LocalHoliday>()

  for (const record of rules.all()) {
    if (record.key.startsWith(localPrefix) && scopeOf(record) === state && !seen.has(record.key)) {
      seen.set(record.key, {
        key: record.key,
        name: holidayName(record),
        where: explanation(record),
        source: record.source,
      })
    }
  }

  return [...seen.values()].sort((one, other) => one.name.localeCompare(other.name, 'de'))
}

/**
 * Whether a day is a public holiday where the business is: one of its
 * holidays, or a Sunday in a state where every Sunday is one. The days of a
 * year are worked out once and kept, because leave asks about every day.
 */
export function holidayCalendar(rules: RuleSet, setting: HolidaySetting): (on: IsoDate) => boolean {
  const years = new Map<number, ReadonlySet<IsoDate>>()

  return (on) => {
    const year = Number(on.slice(0, 4))
    let days = years.get(year)

    if (days === undefined) {
      days = new Set(holidaysIn(rules, setting, year).map((holiday) => holiday.on))
      years.set(year, days)
    }

    if (days.has(on)) {
      return true
    }

    const sundays = rules.at(everySundayKey, on, setting.state)

    return sundays !== null && sundays.value === 1 && new Date(`${on}T00:00:00Z`).getUTCDay() === 0
  }
}

/** Every day from one to another, both counted. */
export function daysFrom(first: IsoDate, last: IsoDate): readonly IsoDate[] {
  const days: IsoDate[] = []

  for (let on = first; on <= last; on = addDays(on, 1)) {
    days.push(on)
  }

  return days
}
