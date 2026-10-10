import { addDays, easterSunday } from '../model/calendar.js'
import type { IsoDate } from '../model/identifier.js'

/**
 * What a rule value is counted in.
 *
 * All of them are whole numbers, and that is the point. A tax rate as 0.19 and
 * an amount as 22000.00 put every calculation at the mercy of binary floating
 * point, where nineteen percent of a hundred euros is not reliably nineteen
 * euros. Basis points and cents keep the arithmetic exact until the one place
 * where rounding is a decision somebody made on purpose, and a flag is a zero
 * or a one for the same reason: one kind of value in a column, and it adds up.
 * Minutes and years came with the working time rules (#76): a break of 30
 * minutes and a retention of two years are what the law says, and neither is
 * a whole number of days. Kiloohms, milliseconds, volts and plain factors came
 * with the limits of the test protocol (#79): an insulation resistance of at
 * least one megaohm is a thousand kiloohms, a tripping time of at most 300
 * milliseconds is 300, and a breaker B trips at five times its rating.
 * Months, tenths of a degree Celsius, kilowatts, kilograms and tonnes of CO2
 * equivalent and a count per 100 millilitres came with the duties of whoever
 * runs a building (opengewerk-haustechnik#16): a test every 36 months, hot
 * water at 60.0 degrees, a heating system from 70 kilowatts, a refrigerant
 * charge from 5 tonnes of CO2 equivalent, legionella from 100 per 100 ml.
 *
 * A day of the year and the distance to Easter Sunday came with the public
 * holidays of a state (opengewerk-haustechnik#200), which are rules like any
 * other, with a source and the time they are in force: `month_day` is a day
 * that comes back every year, written as the month times a hundred and the
 * day (1003 is the third of October), and `days_from_easter` a day that moves
 * with Easter, counted from Easter Sunday (-2 is Good Friday, 1 Easter
 * Monday). `ruleDayIn` makes a day of a year of either.
 */
export const ruleUnits = [
  'basis_points',
  'cents',
  'days',
  'flag',
  'minutes',
  'years',
  'kiloohms',
  'milliseconds',
  'volts',
  'factor',
  'months',
  'decidegrees_celsius',
  'kilowatts',
  'kilograms_co2e',
  'tonnes_co2e',
  'count_per_100_ml',
  'month_day',
  'days_from_easter',
] as const

export type RuleUnit = (typeof ruleUnits)[number]

/**
 * The federal states, by their codes in ISO 3166-2, in the order of the
 * statistical offices. A rule of a state's own law applies there and nowhere
 * else: building law is state law, and a test one state prescribes does not
 * exist in the next.
 */
export const federalStates = [
  'DE-SH',
  'DE-HH',
  'DE-NI',
  'DE-HB',
  'DE-NW',
  'DE-HE',
  'DE-RP',
  'DE-BW',
  'DE-BY',
  'DE-SL',
  'DE-BE',
  'DE-BB',
  'DE-MV',
  'DE-SN',
  'DE-ST',
  'DE-TH',
] as const

export type FederalState = (typeof federalStates)[number]

/** Where a rule applies: in the whole country, or in one federal state. */
export const nationwide = 'DE'

export type RuleScope = typeof nationwide | FederalState

export const ruleScopes: readonly RuleScope[] = [nationwide, ...federalStates]

/** What a person reads for a scope, after "für" or on its own. */
export const ruleScopeNames: Readonly<Record<RuleScope, string>> = {
  DE: 'bundesweit',
  'DE-SH': 'Schleswig-Holstein',
  'DE-HH': 'Hamburg',
  'DE-NI': 'Niedersachsen',
  'DE-HB': 'Bremen',
  'DE-NW': 'Nordrhein-Westfalen',
  'DE-HE': 'Hessen',
  'DE-RP': 'Rheinland-Pfalz',
  'DE-BW': 'Baden-Württemberg',
  'DE-BY': 'Bayern',
  'DE-SL': 'Saarland',
  'DE-BE': 'Berlin',
  'DE-BB': 'Brandenburg',
  'DE-MV': 'Mecklenburg-Vorpommern',
  'DE-SN': 'Sachsen',
  'DE-ST': 'Sachsen-Anhalt',
  'DE-TH': 'Thüringen',
}

/**
 * One legal parameter, for the time it was in force.
 *
 * `validUntil` is inclusive, the way a law reads: in force until the thirty
 * first of December means the thirty first of December counts. Empty means it
 * is still in force.
 *
 * `source` is not decoration. It is the difference between a number somebody
 * can check and a number somebody has to believe.
 *
 * `scope` says where it applies, the whole country when left out. Every
 * package written before scopes existed is a package of federal law, and
 * stays exactly what it was.
 */
export interface RuleRecord {
  readonly key: string
  readonly scope?: RuleScope
  readonly validFrom: IsoDate
  readonly validUntil: IsoDate | null
  readonly unit: RuleUnit
  readonly value: number
  readonly source: string
  /** German, because whoever reads it is deciding whether it is right. */
  readonly note?: string
}

export class RuleError extends Error {}

/**
 * The questions a set of rules answers. Each names a day, and may name a
 * federal state: with one, a rule of that state or of the whole country
 * answers; without one, only a rule of the whole country does. A rule of
 * Baden-Württemberg is never the answer for Bayern.
 */
export interface RuleSet {
  /** The record in force on that day, or nothing if none was. */
  readonly at: (key: string, on: IsoDate, state?: FederalState) => RuleRecord | null
  readonly valueAt: (key: string, unit: RuleUnit, on: IsoDate, state?: FederalState) => number
  readonly keys: () => readonly string[]
  readonly all: () => readonly RuleRecord[]
}

/** Where a record applies, the whole country when it does not say. */
export function scopeOf(record: RuleRecord): RuleScope {
  return record.scope ?? nationwide
}

function covers(record: RuleRecord, on: IsoDate): boolean {
  // ISO dates sort the same way as the days they name, so a string comparison
  // is a date comparison, and there is no time zone anywhere near it.
  return record.validFrom <= on && (record.validUntil === null || on <= record.validUntil)
}

/** The records grouped by a function of each record, each group in order of its start. */
function runs(
  records: readonly RuleRecord[],
  groupOf: (record: RuleRecord) => string,
): RuleRecord[][] {
  const grouped = new Map<string, RuleRecord[]>()

  for (const record of records) {
    const group = groupOf(record)
    grouped.set(group, [...(grouped.get(group) ?? []), record])
  }

  return [...grouped.values()].map((sharing) =>
    [...sharing].sort((left, right) => left.validFrom.localeCompare(right.validFrom)),
  )
}

/** Whether a record that starts no later than another is still in force on that one's first day. */
function overlap(earlier: RuleRecord, later: RuleRecord): boolean {
  return earlier.validUntil === null || later.validFrom <= earlier.validUntil
}

function overlapping(records: readonly RuleRecord[]): [RuleRecord, RuleRecord] | null {
  for (const ordered of runs(records, (record) => `${record.key}:${scopeOf(record)}`)) {
    for (let index = 1; index < ordered.length; index += 1) {
      const earlier = ordered[index - 1]
      const later = ordered[index]

      if (earlier && later && overlap(earlier, later)) {
        return [earlier, later]
      }
    }
  }

  return null
}

/**
 * A rule of the whole country and one of a state for the same key on the
 * same day, or null when there is none.
 *
 * Either could be meant, and an answer from either would be a guess: that the
 * state's rule replaces the federal one, or that the federal one still holds
 * because the state's was never entered. A key is answered for the whole
 * country or state by state on any one day, and not both.
 */
function mixed(records: readonly RuleRecord[]): [RuleRecord, RuleRecord] | null {
  for (const ordered of runs(records, (record) => record.key)) {
    const federal = ordered.filter((record) => scopeOf(record) === nationwide)
    const ofStates = ordered.filter((record) => scopeOf(record) !== nationwide)

    for (const whole of federal) {
      for (const state of ofStates) {
        const [earlier, later] =
          whole.validFrom <= state.validFrom ? [whole, state] : [state, whole]

        if (overlap(earlier, later)) {
          return [whole, state]
        }
      }
    }
  }

  return null
}

/**
 * A set of rules, and the only way to ask what applied when.
 *
 * Every lookup needs a date, and there is deliberately no way to ask without
 * one. That single missing convenience is what makes the historical
 * application from section 1.7 hold: an invoice from 2027 cannot accidentally
 * be judged by the rates of 2030, because nothing in here knows what today is.
 *
 * Overlapping periods are refused when the set is built, not when somebody
 * looks something up. Two rates in force on the same day is not a question
 * with an answer, and finding out during a month end close would be the worst
 * possible moment.
 */
export function ruleSet(records: readonly RuleRecord[]): RuleSet {
  for (const record of records) {
    // A package is JSON, and a scope there is any string until it is checked.
    if (!ruleScopes.includes(scopeOf(record))) {
      throw new RuleError(
        `Die Regel ${record.key} ab ${record.validFrom} nennt einen unbekannten Geltungsbereich: ${String(record.scope)}.`,
      )
    }
  }

  const clash = overlapping(records)

  if (clash) {
    const scope = scopeOf(clash[0])
    const where = scope === nationwide ? '' : ` in ${ruleScopeNames[scope]}`

    throw new RuleError(
      `Zwei Regeln zu ${clash[0].key} gelten gleichzeitig${where}: ab ${clash[0].validFrom} und ab ${clash[1].validFrom}.`,
    )
  }

  const both = mixed(records)

  if (both) {
    const [whole, state] = both

    throw new RuleError(
      `Die Regel ${whole.key} gilt ab ${whole.validFrom} bundesweit und ab ${state.validFrom} in ${ruleScopeNames[scopeOf(state)]}. An einem Tag gilt ein Schlüssel bundesweit oder je Land, nicht beides.`,
    )
  }

  for (const record of records) {
    if (record.validUntil !== null && record.validUntil < record.validFrom) {
      throw new RuleError(`Die Regel ${record.key} ab ${record.validFrom} endet vor ihrem Beginn.`)
    }

    if (!Number.isInteger(record.value)) {
      throw new RuleError(
        `Die Regel ${record.key} ab ${record.validFrom} hat keinen ganzzahligen Wert.`,
      )
    }

    // A day that comes back every year has to be in every year: the 29th of
    // February is not.
    if (record.unit === 'month_day' && !isMonthDay(record.value)) {
      throw new RuleError(
        `Die Regel ${record.key} ab ${record.validFrom} nennt keinen Tag, den jedes Jahr hat: ${String(record.value)}.`,
      )
    }
  }

  // Which records may answer for a state: its own and those of the whole
  // country. Never another state's, which is the whole point of a scope.
  const answers = (record: RuleRecord, state: FederalState | undefined): boolean => {
    const scope = scopeOf(record)

    return scope === nationwide || (state !== undefined && scope === state)
  }

  const find = (key: string, on: IsoDate, state: FederalState | undefined) =>
    records.find((record) => record.key === key && answers(record, state) && covers(record, on))

  return {
    at: (key, on, state) => find(key, on, state) ?? null,
    valueAt: (key, unit, on, state) => {
      const record = find(key, on, state)

      if (!record) {
        // Refused rather than guessed. A missing rule means nobody has said
        // what applied on that day, and inventing an answer is how a wrong
        // invoice leaves the house looking right.
        throw new RuleError(
          state === undefined
            ? `Zum ${on} ist keine Regel ${key} hinterlegt.`
            : `Zum ${on} ist für ${ruleScopeNames[state]} keine Regel ${key} hinterlegt.`,
        )
      }

      if (record.unit !== unit) {
        throw new RuleError(
          `Die Regel ${key} ist in ${record.unit} angegeben, gefragt war ${unit}.`,
        )
      }

      return record.value
    },
    keys: () => [...new Set(records.map((record) => record.key))].sort(),
    all: () => records,
  }
}

/** Whether a value of the unit `month_day` is a day every year has. */
function isMonthDay(value: number): boolean {
  const month = Math.floor(value / 100)
  const day = value % 100
  // The days of each month in a year that is no leap year.
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0)
}

/**
 * The day a rule of a day names in a year: the day itself for `month_day`,
 * counted from Easter Sunday for `days_from_easter`, and none for a rule in
 * any other unit.
 */
export function ruleDayIn(rule: Pick<RuleRecord, 'unit' | 'value'>, year: number): IsoDate | null {
  if (rule.unit === 'days_from_easter') {
    return addDays(easterSunday(year), rule.value)
  }

  if (rule.unit === 'month_day' && isMonthDay(rule.value)) {
    const month = String(Math.floor(rule.value / 100)).padStart(2, '0')
    const day = String(rule.value % 100).padStart(2, '0')

    return `${String(year)}-${month}-${day}` as IsoDate
  }

  return null
}

/** The day after, without a time zone anywhere near it. */
function dayAfter(on: IsoDate): IsoDate {
  const at = new Date(`${on}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + 1)

  return at.toISOString().slice(0, 10)
}

/** Days nobody has said anything about, between two rules of one key and scope. */
export interface RuleHole {
  readonly key: string
  readonly scope: RuleScope
  /** The last day of the earlier rule. */
  readonly after: IsoDate
  /** The first day of the later one. */
  readonly before: IsoDate
}

/**
 * The holes inside the runs of a set of records, each run being one key in
 * one scope.
 *
 * A hole at the end of a run is allowed, it is where knowledge stops. One in
 * the middle is a maintenance slip, and it would show up as a question that
 * cannot be answered on one particular day. Scopes are runs of their own: a
 * state whose rule begins in 2026 has no hole because the whole country had a
 * rule before, and the whole country has none because a state has one.
 */
export function ruleHoles(records: readonly RuleRecord[]): readonly RuleHole[] {
  const holes: RuleHole[] = []

  for (const ordered of runs(records, (record) => `${record.key}:${scopeOf(record)}`)) {
    for (let index = 1; index < ordered.length; index += 1) {
      const earlier = ordered[index - 1]
      const later = ordered[index]

      if (earlier?.validUntil && later && dayAfter(earlier.validUntil) < later.validFrom) {
        holes.push({
          key: later.key,
          scope: scopeOf(later),
          after: earlier.validUntil,
          before: later.validFrom,
        })
      }
    }
  }

  return holes
}

/**
 * Zero, and never minus zero.
 *
 * `Math.sign` hands back a signed zero, so an amount of nothing on the credit
 * side comes out as `-0`. It compares equal to `0` with `==` and `===`, which
 * is why it goes unnoticed, and unequal with `Object.is`, which is what a test
 * uses and what `Map` keys and `includes` use. A bookkeeping figure has no
 * signed nothing, so it is taken out where it appears rather than worked
 * around wherever it lands.
 */
export function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value
}

/**
 * A rate applied to an amount, rounded the way a merchant rounds: half a cent
 * goes up, and away from zero, so a credit note mirrors the invoice it
 * corrects instead of drifting a cent away from it.
 */
export function applyRate(cents: number, basisPoints: number): number {
  const exact = cents * basisPoints

  return withoutNegativeZero(Math.sign(exact) * Math.round(Math.abs(exact) / 10_000))
}
