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
 */
export const ruleUnits = ['basis_points', 'cents', 'days', 'flag'] as const

export type RuleUnit = (typeof ruleUnits)[number]

/**
 * One legal parameter, for the time it was in force.
 *
 * `validUntil` is inclusive, the way a law reads: in force until the thirty
 * first of December means the thirty first of December counts. Empty means it
 * is still in force.
 *
 * `source` is not decoration. It is the difference between a number somebody
 * can check and a number somebody has to believe.
 */
export interface RuleRecord {
  readonly key: string
  readonly validFrom: IsoDate
  readonly validUntil: IsoDate | null
  readonly unit: RuleUnit
  readonly value: number
  readonly source: string
  /** German, because whoever reads it is deciding whether it is right. */
  readonly note?: string
}

export class RuleError extends Error {}

export interface RuleSet {
  /** The record in force on that day, or nothing if none was. */
  readonly at: (key: string, on: IsoDate) => RuleRecord | null
  readonly valueAt: (key: string, unit: RuleUnit, on: IsoDate) => number
  readonly keys: () => readonly string[]
  readonly all: () => readonly RuleRecord[]
}

function covers(record: RuleRecord, on: IsoDate): boolean {
  // ISO dates sort the same way as the days they name, so a string comparison
  // is a date comparison, and there is no time zone anywhere near it.
  return record.validFrom <= on && (record.validUntil === null || on <= record.validUntil)
}

function overlapping(records: readonly RuleRecord[]): [RuleRecord, RuleRecord] | null {
  const byKey = new Map<string, RuleRecord[]>()

  for (const record of records) {
    byKey.set(record.key, [...(byKey.get(record.key) ?? []), record])
  }

  for (const sharing of byKey.values()) {
    const ordered = [...sharing].sort((left, right) =>
      left.validFrom.localeCompare(right.validFrom),
    )

    for (let index = 1; index < ordered.length; index += 1) {
      const earlier = ordered[index - 1]
      const later = ordered[index]

      if (
        earlier &&
        later &&
        (earlier.validUntil === null || later.validFrom <= earlier.validUntil)
      ) {
        return [earlier, later]
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
  const clash = overlapping(records)

  if (clash) {
    throw new RuleError(
      `Zwei Regeln zu ${clash[0].key} gelten gleichzeitig: ab ${clash[0].validFrom} und ab ${clash[1].validFrom}.`,
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
  }

  return {
    at: (key, on) => records.find((record) => record.key === key && covers(record, on)) ?? null,
    valueAt: (key, unit, on) => {
      const record = records.find((entry) => entry.key === key && covers(entry, on))

      if (!record) {
        // Refused rather than guessed. A missing rule means nobody has said
        // what applied on that day, and inventing an answer is how a wrong
        // invoice leaves the house looking right.
        throw new RuleError(`Zum ${on} ist keine Regel ${key} hinterlegt.`)
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
