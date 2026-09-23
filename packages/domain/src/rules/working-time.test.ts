import { describe, expect, it } from 'vitest'

import type { IsoDate } from '../model/identifier.js'
import {
  correctionProblem,
  effectiveEntries,
  locationProblem,
  minutesBetween,
  timeEntryProblem,
} from '../model/time-entry.js'
import { shippedRules } from './shipped.js'
import {
  berlinDay,
  hoursText,
  lateRecordingText,
  recordDeadline,
  retentionEndsOn,
  type TimedEntry,
  workingTimeWarnings,
} from './working-time.js'

/** A stretch on a September day in Germany, summer time, by clock times. */
function at(kind: string, day: string, from: string, to: string): TimedEntry {
  return {
    kind,
    startedAt: `${day}T${from}:00+02:00`,
    endedAt: `${day}T${to}:00+02:00`,
  }
}

const monday = '2026-09-21' as IsoDate
const tuesday = '2026-09-22' as IsoDate

function kinds(entries: readonly TimedEntry[], on: IsoDate = monday) {
  return workingTimeWarnings(entries, on, shippedRules).map((warning) => warning.kind)
}

describe('the day of an entry', () => {
  it('is the day in Germany, not in Greenwich', () => {
    expect(berlinDay('2026-09-21T23:30:00+02:00')).toBe('2026-09-21')
    expect(berlinDay('2026-09-21T22:30:00Z')).toBe('2026-09-22')
    expect(berlinDay('2026-01-15T23:30:00Z')).toBe('2026-01-16')
  })

  it('is counted in whole minutes and written as hours', () => {
    expect(minutesBetween('2026-09-21T07:00:00+02:00', '2026-09-21T15:30:00+02:00')).toBe(510)
    expect(hoursText(510)).toBe('8:30 Std.')
    expect(hoursText(5)).toBe('0:05 Std.')
  })
})

describe('the warnings of the Working Hours Act', () => {
  it('say nothing about an ordinary day with its break', () => {
    expect(
      kinds([at('work', monday, '07:00', '12:00'), at('work', monday, '12:30', '16:00')]),
    ).toEqual([])
  })

  it('count a gap as a break only from fifteen minutes on', () => {
    // Ten minutes are no break under § 4 Satz 2, so this is almost nine hours
    // without one.
    expect(
      kinds([at('work', monday, '07:00', '13:30'), at('work', monday, '13:40', '16:00')]),
    ).toEqual(['break', 'without_break'])
  })

  it('want 45 minutes past nine hours, and warn past ten', () => {
    expect(
      kinds([at('work', monday, '06:00', '12:00'), at('work', monday, '12:30', '17:30')]),
    ).toEqual(['daily_maximum', 'break'])
    expect(
      kinds([at('work', monday, '06:00', '11:00'), at('work', monday, '11:45', '16:30')]),
    ).toEqual([])
  })

  it('count travel as working time and a recorded break as none', () => {
    expect(
      kinds([
        at('travel', monday, '06:00', '07:00'),
        at('work', monday, '07:00', '13:00'),
        at('break', monday, '13:00', '13:30'),
        at('work', monday, '13:30', '15:00'),
      ]),
    ).toEqual(['without_break'])
  })

  it('measure the rest back to the last end of work, on the day before', () => {
    const late = at('work', monday, '14:00', '22:00')

    expect(kinds([late, at('work', tuesday, '06:00', '10:00')], tuesday)).toEqual(['rest'])
    expect(kinds([late, at('work', tuesday, '09:00', '13:00')], tuesday)).toEqual([])
  })

  it('name two entries that overlap', () => {
    expect(
      kinds([at('work', monday, '07:00', '12:00'), at('travel', monday, '11:30', '12:30')]),
    ).toEqual(['overlap'])
  })

  it('say it in words with the paragraph', () => {
    const [warning] = workingTimeWarnings(
      [at('work', monday, '06:00', '12:00'), at('work', monday, '12:15', '17:30')],
      monday,
      shippedRules,
    )

    expect(warning?.text).toBe(
      '11:15 Std. Arbeit am 21.09.2026. Erlaubt sind höchstens 10:00 Std. (§ 3 ArbZG).',
    )
  })
})

describe('the entries that count', () => {
  it('are the corrections in place of what they correct, and nothing withdrawn', () => {
    const entries = [
      { id: 'a', correctsEntryId: null, withdrawn: false },
      { id: 'b', correctsEntryId: 'a', withdrawn: false },
      { id: 'c', correctsEntryId: null, withdrawn: false },
      { id: 'd', correctsEntryId: 'c', withdrawn: true },
      { id: 'e', correctsEntryId: null, withdrawn: false },
    ]

    expect(effectiveEntries(entries).map((entry) => entry.id)).toEqual(['b', 'e'])
  })
})

describe('what an entry must say', () => {
  it('has an end after its beginning, and lasts at most a day', () => {
    expect(
      timeEntryProblem({ startedAt: '2026-09-21T07:00:00Z', endedAt: '2026-09-21T08:00:00Z' }),
    ).toBeNull()
    expect(
      timeEntryProblem({ startedAt: '2026-09-21T08:00:00Z', endedAt: '2026-09-21T08:00:00Z' }),
    ).toMatch(/nicht nach dem Beginn/)
    expect(
      timeEntryProblem({ startedAt: '2026-09-21T07:00:00Z', endedAt: '2026-09-22T07:01:00Z' }),
    ).toMatch(/höchstens 24 Stunden/)
    expect(timeEntryProblem({ startedAt: 'gestern', endedAt: null })).toMatch(/Zeitpunkte/)
  })

  it('gives a reason for a correction, and withdraws only what it corrects', () => {
    expect(correctionProblem({ correctsEntryId: 'a', note: 'Ende vergessen' })).toBeNull()
    expect(correctionProblem({ correctsEntryId: 'a', note: '  ' })).toMatch(/Grund/)
    expect(correctionProblem({ withdrawn: true })).toMatch(/Zurückziehen/)
    expect(correctionProblem({})).toBeNull()
  })

  it('carries a place as latitude and longitude on the earth, or none', () => {
    expect(locationProblem({})).toBeNull()
    expect(
      locationProblem({ startLatitudeMicro: 49_487_459, startLongitudeMicro: 8_466_039 }),
    ).toBeNull()
    expect(locationProblem({ startLatitudeMicro: 49_487_459 })).toMatch(/Breite und Länge/)
    expect(locationProblem({ endLatitudeMicro: 91_000_000, endLongitudeMicro: 0 })).toMatch(/Erde/)
    expect(locationProblem({ startLatitudeMicro: 49.48, startLongitudeMicro: 8.46 })).toMatch(
      /millionstel/,
    )
  })
})

describe('the record under the minimum wage act', () => {
  it('is due by the seventh day after the work, and a late one is said, not refused', () => {
    expect(recordDeadline('2026-09-10' as IsoDate, shippedRules)).toBe('2026-09-17')
    expect(
      lateRecordingText('2026-09-10' as IsoDate, '2026-09-17' as IsoDate, shippedRules),
    ).toBeNull()
    expect(
      lateRecordingText('2026-09-10' as IsoDate, '2026-09-18' as IsoDate, shippedRules),
    ).toMatch(/nach dem 17\.09\.2026/)
  })

  it('is kept two years from that day, and may go the day after', () => {
    // The two years of § 17 MiLoG, from the package and not from the code.
    expect(shippedRules.valueAt('minimum_wage.record_retention', 'years', '2026-09-23')).toBe(2)
    expect(retentionEndsOn('2026-09-23' as IsoDate, shippedRules)).toBe('2028-10-01')
  })
})
