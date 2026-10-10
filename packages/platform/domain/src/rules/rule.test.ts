import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { easterSunday } from '../model/calendar.js'
import type { IsoDate } from '../model/identifier.js'
import {
  federalStates,
  type FederalState,
  nationwide,
  RuleError,
  ruleHoles,
  type RuleRecord,
  type RuleScope,
  ruleScopeNames,
  ruleScopes,
  ruleSet,
  ruleDayIn,
  ruleUnits,
  scopeOf,
} from './rule.js'

// The rule engine, with rules that belong to no application: a test interval
// in months and a water temperature, once for the whole country and once for
// a state. The packages of an application hold their own rules against it.

function record(over: Partial<RuleRecord> & Pick<RuleRecord, 'key' | 'validFrom'>): RuleRecord {
  return {
    validUntil: null,
    unit: 'months',
    value: 36,
    source: 'Probevorschrift § 1',
    ...over,
  }
}

const day = (value: string) => value as IsoDate

describe('the scope of a rule', () => {
  const rules = ruleSet([
    record({ key: 'interval.state', scope: 'DE-BW', validFrom: day('2020-01-01'), value: 12 }),
    record({ key: 'interval.state', scope: 'DE-NW', validFrom: day('2020-01-01'), value: 24 }),
    record({ key: 'interval.federal', validFrom: day('2020-01-01'), value: 36 }),
  ])

  it('finds a rule of Baden-Württemberg for Baden-Württemberg and not for Bayern', () => {
    expect(rules.valueAt('interval.state', 'months', day('2026-10-03'), 'DE-BW')).toBe(12)
    expect(rules.at('interval.state', day('2026-10-03'), 'DE-BY')).toBeNull()
    expect(() => rules.valueAt('interval.state', 'months', day('2026-10-03'), 'DE-BY')).toThrow(
      'Zum 2026-10-03 ist für Bayern keine Regel interval.state hinterlegt.',
    )
  })

  it('finds a rule of the whole country in every state', () => {
    for (const state of federalStates) {
      expect(rules.valueAt('interval.federal', 'months', day('2026-10-03'), state)).toBe(36)
    }
  })

  it('answers a question without a state from the whole country only', () => {
    expect(rules.valueAt('interval.federal', 'months', day('2026-10-03'))).toBe(36)
    expect(rules.at('interval.state', day('2026-10-03'))).toBeNull()
    expect(() => rules.valueAt('interval.state', 'months', day('2026-10-03'))).toThrow(
      'Zum 2026-10-03 ist keine Regel interval.state hinterlegt.',
    )
  })

  it('takes a record without a scope for one of the whole country', () => {
    const [federal] = rules.all().filter((entry) => entry.key === 'interval.federal')

    expect(federal?.scope).toBeUndefined()
    expect(federal && scopeOf(federal)).toBe(nationwide)
  })

  it('names every state and the whole country in words', () => {
    expect(ruleScopes).toEqual([nationwide, ...federalStates])
    expect(federalStates).toHaveLength(16)
    expect(new Set(federalStates).size).toBe(16)
    expect(ruleScopeNames['DE-BW']).toBe('Baden-Württemberg')
    expect(ruleScopeNames.DE).toBe('bundesweit')
    expect(Object.keys(ruleScopeNames).sort()).toEqual([...ruleScopes].sort())
  })
})

describe('a set of rules with scopes', () => {
  it('refuses a scope it does not know', () => {
    expect(() =>
      ruleSet([
        record({ key: 'interval', scope: 'DE-XX' as RuleScope, validFrom: day('2020-01-01') }),
      ]),
    ).toThrow('Die Regel interval ab 2020-01-01 nennt einen unbekannten Geltungsbereich: DE-XX.')
  })

  it('refuses two rules of one key in force in the same state on the same day', () => {
    expect(() =>
      ruleSet([
        record({ key: 'interval', scope: 'DE-BW', validFrom: day('2020-01-01') }),
        record({ key: 'interval', scope: 'DE-BW', validFrom: day('2024-01-01') }),
      ]),
    ).toThrow(
      'Zwei Regeln zu interval gelten gleichzeitig in Baden-Württemberg: ab 2020-01-01 und ab 2024-01-01.',
    )
  })

  it('takes one key in force in two states on the same day, each with its own value', () => {
    const rules = ruleSet([
      record({ key: 'interval', scope: 'DE-BW', validFrom: day('2020-01-01'), value: 12 }),
      record({ key: 'interval', scope: 'DE-BY', validFrom: day('2020-01-01'), value: 60 }),
    ])

    expect(rules.valueAt('interval', 'months', day('2026-10-03'), 'DE-BW')).toBe(12)
    expect(rules.valueAt('interval', 'months', day('2026-10-03'), 'DE-BY')).toBe(60)
  })

  it('refuses a key in force for the whole country and in a state on the same day', () => {
    expect(() =>
      ruleSet([
        record({ key: 'interval', validFrom: day('2020-01-01'), validUntil: day('2025-12-31') }),
        record({ key: 'interval', scope: 'DE-BW', validFrom: day('2025-07-01') }),
      ]),
    ).toThrow(
      'Die Regel interval gilt ab 2020-01-01 bundesweit und ab 2025-07-01 in Baden-Württemberg. An einem Tag gilt ein Schlüssel bundesweit oder je Land, nicht beides.',
    )
    expect(() =>
      ruleSet([
        record({ key: 'interval', scope: 'DE-BW', validFrom: day('2020-01-01') }),
        record({ key: 'interval', validFrom: day('2026-01-01') }),
      ]),
    ).toThrow(RuleError)
  })

  it('takes a key that goes from the whole country to the states, on different days', () => {
    const rules = ruleSet([
      record({
        key: 'interval',
        validFrom: day('2020-01-01'),
        validUntil: day('2025-12-31'),
        value: 36,
      }),
      record({ key: 'interval', scope: 'DE-BW', validFrom: day('2026-01-01'), value: 12 }),
    ])

    expect(rules.valueAt('interval', 'months', day('2025-12-31'), 'DE-BY')).toBe(36)
    expect(rules.valueAt('interval', 'months', day('2026-01-01'), 'DE-BW')).toBe(12)
    expect(rules.at('interval', day('2026-01-01'), 'DE-BY')).toBeNull()
  })

  it('counts in the units the duties of a building are written in', () => {
    const rules = ruleSet([
      record({ key: 'interval', validFrom: day('2020-01-01'), unit: 'months', value: 36 }),
      record({
        key: 'hot_water',
        validFrom: day('2020-01-01'),
        unit: 'decidegrees_celsius',
        value: 600,
      }),
      record({ key: 'boiler', validFrom: day('2020-01-01'), unit: 'kilowatts', value: 70 }),
      record({ key: 'leak_check', validFrom: day('2020-01-01'), unit: 'tonnes_co2e', value: 5 }),
      record({ key: 'charge', validFrom: day('2020-01-01'), unit: 'kilograms_co2e', value: 5000 }),
      record({
        key: 'legionella',
        validFrom: day('2020-01-01'),
        unit: 'count_per_100_ml',
        value: 100,
      }),
    ])

    expect(rules.valueAt('hot_water', 'decidegrees_celsius', day('2026-10-03'))).toBe(600)
    expect(rules.valueAt('legionella', 'count_per_100_ml', day('2026-10-03'))).toBe(100)
    expect(() => rules.valueAt('hot_water', 'kilowatts', day('2026-10-03'))).toThrow(
      'Die Regel hot_water ist in decidegrees_celsius angegeben, gefragt war kilowatts.',
    )
    expect(ruleUnits).toEqual(
      expect.arrayContaining([
        'months',
        'decidegrees_celsius',
        'kilowatts',
        'kilograms_co2e',
        'tonnes_co2e',
        'count_per_100_ml',
      ]),
    )
  })
})

describe('the holes in a set of rules', () => {
  it('finds a hole inside the run of one key in one scope', () => {
    expect(
      ruleHoles([
        record({
          key: 'interval',
          scope: 'DE-BW',
          validFrom: day('2020-01-01'),
          validUntil: day('2022-12-31'),
        }),
        record({ key: 'interval', scope: 'DE-BW', validFrom: day('2023-02-01') }),
      ]),
    ).toEqual([{ key: 'interval', scope: 'DE-BW', after: '2022-12-31', before: '2023-02-01' }])
  })

  it('finds none where one rule ends the day before the next begins, or at the end of a run', () => {
    expect(
      ruleHoles([
        record({ key: 'interval', validFrom: day('2020-01-01'), validUntil: day('2022-12-31') }),
        record({ key: 'interval', validFrom: day('2023-01-01'), validUntil: day('2024-12-31') }),
      ]),
    ).toEqual([])
  })

  it('counts every scope as a run of its own', () => {
    // The whole country until 2025, a state from 2027: two runs, and each of
    // them is whole. A question for the state in 2026 has no answer, which is
    // the engine refusing, not a slip in a package.
    expect(
      ruleHoles([
        record({ key: 'interval', validFrom: day('2020-01-01'), validUntil: day('2025-12-31') }),
        record({ key: 'interval', scope: 'DE-BW', validFrom: day('2027-01-01') }),
        record({ key: 'interval', scope: 'DE-BY', validFrom: day('2027-01-01') }),
      ]),
    ).toEqual([])
  })
})

// Properties over whole sets: periods and scopes drawn at random, every
// question answered by the set and by a plain search through the records, and
// the two compared.

const base = Date.UTC(2020, 0, 1)

function dayAt(offset: number): IsoDate {
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10)
}

const keys = ['a', 'b', 'c'] as const

/** A run of consecutive rules of one key in one scope. */
const runArbitrary = fc.record({
  key: fc.constantFrom(...keys),
  state: fc.constantFrom(...federalStates),
  start: fc.integer({ min: 0, max: 400 }),
  lengths: fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 4 }),
  open: fc.boolean(),
})

/** Whether a key is answered for the whole country (true) or state by state. */
const modesArbitrary = fc.record({ a: fc.boolean(), b: fc.boolean(), c: fc.boolean() })

type Run = typeof runArbitrary extends fc.Arbitrary<infer Drawn> ? Drawn : never

function recordsOf(
  runs: readonly Run[],
  modes: Readonly<Record<(typeof keys)[number], boolean>>,
): RuleRecord[] {
  const taken = new Set<string>()
  const records: RuleRecord[] = []

  for (const run of runs) {
    const scope: RuleScope = modes[run.key] ? nationwide : run.state
    const name = `${run.key}:${scope}`

    // One run per key and scope; a second would overlap the first.
    if (taken.has(name)) {
      continue
    }

    taken.add(name)
    let from = run.start

    run.lengths.forEach((length, index) => {
      const last = index === run.lengths.length - 1

      records.push({
        key: run.key,
        ...(scope === nationwide ? {} : { scope }),
        validFrom: dayAt(from),
        validUntil: last && run.open ? null : dayAt(from + length - 1),
        unit: 'days',
        value: from,
        source: 'Probevorschrift',
      })
      from += length
    })
  }

  return records
}

/** The answer by a plain search: the key, a scope that may answer, the day inside the period. */
function searched(
  records: readonly RuleRecord[],
  key: string,
  on: IsoDate,
  state: FederalState | undefined,
): RuleRecord | null {
  return (
    records.find(
      (entry) =>
        entry.key === key &&
        (scopeOf(entry) === nationwide || scopeOf(entry) === state) &&
        entry.validFrom <= on &&
        (entry.validUntil === null || on <= entry.validUntil),
    ) ?? null
  )
}

describe('a set of rules, whatever its periods and scopes', () => {
  it('answers every question as a plain search through its records does', () => {
    fc.assert(
      fc.property(
        fc.array(runArbitrary, { minLength: 1, maxLength: 8 }),
        modesArbitrary,
        fc.constantFrom(...keys),
        fc.integer({ min: 0, max: 1500 }),
        fc.option(fc.constantFrom(...federalStates), { nil: undefined }),
        (runs, modes, key, offset, state) => {
          const records = recordsOf(runs, modes)
          const rules = ruleSet(records)

          expect(rules.at(key, dayAt(offset), state)).toEqual(
            searched(records, key, dayAt(offset), state),
          )
        },
      ),
    )
  })

  it('never answers a question for one state with a rule of another', () => {
    fc.assert(
      fc.property(
        fc.array(runArbitrary, { minLength: 1, maxLength: 8 }),
        modesArbitrary,
        fc.constantFrom(...keys),
        fc.integer({ min: 0, max: 1500 }),
        fc.constantFrom(...federalStates),
        (runs, modes, key, offset, state) => {
          const found = ruleSet(recordsOf(runs, modes)).at(key, dayAt(offset), state)

          expect(found === null || [nationwide, state].includes(scopeOf(found))).toBe(true)
        },
      ),
    )
  })

  it('answers a question without a state the way it did before scopes existed', () => {
    // Every package written before scopes is federal law, and a question
    // without a state is the only question it was ever asked.
    fc.assert(
      fc.property(
        fc.array(runArbitrary, { minLength: 1, maxLength: 8 }),
        fc.constantFrom(...keys),
        fc.integer({ min: 0, max: 1500 }),
        (runs, key, offset) => {
          const records = recordsOf(runs, { a: true, b: true, c: true })
          const before =
            records.find(
              (entry) =>
                entry.key === key &&
                entry.validFrom <= dayAt(offset) &&
                (entry.validUntil === null || dayAt(offset) <= entry.validUntil),
            ) ?? null

          expect(ruleSet(records).at(key, dayAt(offset))).toEqual(before)
        },
      ),
    )
  })

  it('has no hole in runs that follow on day by day, and one where a rule is taken out', () => {
    fc.assert(
      fc.property(
        fc.array(runArbitrary, { minLength: 1, maxLength: 8 }),
        modesArbitrary,
        (runs, modes) => {
          const records = recordsOf(runs, modes)

          expect(ruleHoles(records)).toEqual([])

          // Take out a rule that has one before and one after it in its run.
          const inside = records.findIndex((entry, index) => {
            const before = records[index - 1]
            const after = records[index + 1]

            return (
              before !== undefined &&
              after !== undefined &&
              before.key === entry.key &&
              after.key === entry.key &&
              scopeOf(before) === scopeOf(entry) &&
              scopeOf(after) === scopeOf(entry)
            )
          })

          if (inside >= 0) {
            const without = records.filter((_, index) => index !== inside)
            const taken = records[inside]

            expect(ruleHoles(without)).toEqual([
              {
                key: taken?.key,
                scope: taken && scopeOf(taken),
                after: records[inside - 1]?.validUntil,
                before: records[inside + 1]?.validFrom,
              },
            ])
          }
        },
      ),
    )
  })
})

describe('a rule of a day', () => {
  const holiday = (unit: 'month_day' | 'days_from_easter', value: number): RuleRecord => ({
    key: 'day_off',
    scope: 'DE-BW',
    validFrom: '1995-05-08' as IsoDate,
    validUntil: null,
    unit,
    value,
    source: '§ 1 FTG',
  })

  it('names the same day every year, or a day counted from Easter Sunday', () => {
    expect(ruleDayIn(holiday('month_day', 1003), 2026)).toBe('2026-10-03')
    expect(ruleDayIn(holiday('month_day', 101), 2027)).toBe('2027-01-01')
    expect(ruleDayIn(holiday('days_from_easter', -2), 2026)).toBe('2026-04-03')
    expect(ruleDayIn(holiday('days_from_easter', 1), 2026)).toBe('2026-04-06')
    expect(ruleDayIn(holiday('days_from_easter', 60), 2026)).toBe('2026-06-04')
    expect(ruleDayIn({ unit: 'days', value: 3 }, 2026)).toBeNull()
  })

  it('moves with Easter by as many days as it says, in every year', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1583, max: 9999 }),
        fc.integer({ min: -60, max: 70 }),
        (year, days) => {
          const day = ruleDayIn(holiday('days_from_easter', days), year)
          const easter = new Date(`${easterSunday(year)}T00:00:00Z`).getTime()

          expect((new Date(`${String(day)}T00:00:00Z`).getTime() - easter) / 86_400_000).toBe(days)
        },
      ),
    )
  })

  it('is refused for a day that not every year has', () => {
    expect(() => ruleSet([holiday('month_day', 229)])).toThrow(RuleError)
    expect(() => ruleSet([holiday('month_day', 1301)])).toThrow(/keinen Tag, den jedes Jahr hat/)
    expect(() => ruleSet([holiday('month_day', 431)])).toThrow(RuleError)
    expect(() => ruleSet([holiday('month_day', 1231)])).not.toThrow()
    expect(() => ruleSet([holiday('days_from_easter', -2)])).not.toThrow()
  })
})
