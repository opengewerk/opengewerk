import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { shippedRules } from '../rules/shipped.js'
import type { AbsenceKind, AbsenceState } from './absence.js'
import { holidayCalendar } from './holiday.js'
import {
  accountDays,
  accountStart,
  balanceOf,
  balanceText,
  countedUntil,
  targetOn,
  workedByDay,
} from './time-account.js'
import type { TimeEntryKind } from './time-entry.js'

const week = (from: string, hours: readonly number[], deletedAt: Date | null = null) => ({
  validFrom: from as IsoDate,
  deletedAt,
  mondayMinutes: (hours[0] ?? 0) * 60,
  tuesdayMinutes: (hours[1] ?? 0) * 60,
  wednesdayMinutes: (hours[2] ?? 0) * 60,
  thursdayMinutes: (hours[3] ?? 0) * 60,
  fridayMinutes: (hours[4] ?? 0) * 60,
  saturdayMinutes: (hours[5] ?? 0) * 60,
  sundayMinutes: (hours[6] ?? 0) * 60,
})

// Anna Weber of the boards: Monday to Friday until the end of 2026, Monday to Thursday from 2027.
const times = [
  week('2023-03-01', [8, 8, 8, 8, 8, 0, 0]),
  week('2027-01-01', [7.5, 7.5, 7.5, 7.5, 0, 0, 0]),
]
const isHoliday = holidayCalendar(shippedRules, { state: 'DE-BW', local: [] })
const noHoliday = () => false

const absence = (
  kind: AbsenceKind,
  state: AbsenceState,
  firstDay: string,
  lastDay: string,
  halves: { startsAtNoon?: boolean; endsAtNoon?: boolean } = {},
) => ({
  kind,
  state,
  firstDay: firstDay as IsoDate,
  lastDay: lastDay as IsoDate,
  startsAtNoon: halves.startsAtNoon ?? false,
  endsAtNoon: halves.endsAtNoon ?? false,
})

// The year of Anna Weber on the boards of #288.
const away = [
  absence('vacation', 'approved', '2026-02-24', '2026-02-27'),
  absence('vacation', 'approved', '2026-03-30', '2026-04-10'),
  absence('sickness', 'approved', '2026-05-18', '2026-05-20'),
  absence('vacation', 'rejected', '2026-07-13', '2026-07-17'),
  absence('vacation', 'approved', '2026-08-10', '2026-08-21'),
  absence('sickness', 'approved', '2026-08-13', '2026-08-14'),
  absence('vacation', 'requested', '2026-12-02', '2026-12-04'),
]

let next = 0

const entry = (
  kind: TimeEntryKind,
  from: string,
  to: string,
  more: { id?: string; correctsEntryId?: string; withdrawn?: boolean } = {},
) => ({
  id: more.id ?? `entry-${String((next += 1))}`,
  kind,
  startedAt: new Date(from),
  endedAt: new Date(to),
  correctsEntryId: more.correctsEntryId ?? null,
  withdrawn: more.withdrawn ?? false,
})

const target = (on: string, withAway = away, holidays = isHoliday) =>
  targetOn(times, withAway, holidays, on as IsoDate)

describe('the target of a day (#289)', () => {
  it('is the agreed working time of that weekday', () => {
    expect([target('2026-11-02'), target('2026-11-07'), target('2026-11-08')]).toEqual([480, 0, 0])
  })

  it('follows a changed working time from its day, and the weeks before stay as they were', () => {
    expect([target('2026-12-31'), target('2027-01-04'), target('2027-01-08')]).toEqual([
      480, 450, 0,
    ])
  })

  it('is nothing on a public holiday', () => {
    expect([
      target('2026-10-05'),
      target('2026-06-04'),
      target('2026-06-04', away, noHoliday),
    ]).toEqual([480, 0, 480])
  })

  it('is nothing on a day of approved leave, and full on a day only asked for or turned down', () => {
    expect([target('2026-02-24'), target('2026-07-14'), target('2026-12-03')]).toEqual([
      0, 480, 480,
    ])
  })

  it('is nothing on a day somebody is sick', () => {
    expect([target('2026-05-19'), target('2026-05-21')]).toEqual([0, 480])
  })

  it('is half on half a day away, and nothing when leave and a sickness share it', () => {
    const afternoon = [
      absence('vacation', 'approved', '2026-11-02', '2026-11-03', { startsAtNoon: true }),
    ]
    const both = [
      absence('vacation', 'approved', '2026-11-02', '2026-11-02', { endsAtNoon: true }),
      absence('sickness', 'approved', '2026-11-02', '2026-11-02'),
    ]

    expect([
      target('2026-11-02', afternoon),
      target('2026-11-03', afternoon),
      target('2026-11-02', both),
    ]).toEqual([240, 0, 0])
  })

  it('adds up to the months of the board "Zeiterfassung mit Zeitkonto"', () => {
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((month) => {
      const days = accountDays({
        times,
        away,
        isHoliday,
        worked: new Map(),
        startsOn: '2023-03-01' as IsoDate,
        leftOn: null,
        until: '2026-11-04' as IsoDate,
        from: `2026-${month}-01` as IsoDate,
        to: `2026-${month}-${new Date(Date.UTC(2026, Number(month), 0)).getUTCDate()}` as IsoDate,
      })

      return balanceOf(days).targetMinutes / 60
    })

    expect(months).toEqual([160, 128, 160, 112, 120, 168, 184, 88, 176, 176])
  })
})

describe('what was recorded on a day', () => {
  it('is work and travel, not breaks, on the day an entry begins in Germany', () => {
    const worked = workedByDay([
      entry('travel', '2026-11-02T06:20:00Z', '2026-11-02T06:50:00Z'),
      entry('work', '2026-11-02T06:50:00Z', '2026-11-02T11:00:00Z'),
      entry('break', '2026-11-02T11:00:00Z', '2026-11-02T11:20:00Z'),
      // Half past midnight in Germany, still the evening before in Greenwich.
      entry('work', '2026-11-03T23:30:00Z', '2026-11-04T01:00:00Z'),
    ])

    expect([...worked]).toEqual([
      ['2026-11-02', 280],
      ['2026-11-04', 90],
    ])
  })

  it('takes a correction in the place of what it corrects, on the day its own time lies', () => {
    const wrong = entry('work', '2026-11-02T07:00:00Z', '2026-11-02T19:15:00Z', { id: 'wrong' })
    const moved = entry('work', '2026-11-03T07:00:00Z', '2026-11-03T15:00:00Z', {
      correctsEntryId: 'wrong',
    })

    expect([...workedByDay([wrong])]).toEqual([['2026-11-02', 735]])
    expect([...workedByDay([wrong, moved])]).toEqual([['2026-11-03', 480]])
  })

  it('counts nothing of a withdrawn entry', () => {
    const gone = entry('work', '2026-11-02T07:00:00Z', '2026-11-02T15:00:00Z', { id: 'gone' })
    const withdrawal = entry('work', '2026-11-02T07:00:00Z', '2026-11-02T15:00:00Z', {
      correctsEntryId: 'gone',
      withdrawn: true,
    })

    expect([...workedByDay([gone, withdrawal])]).toEqual([])
  })
})

describe('an account', () => {
  it('begins with the first agreed working time, not before joining', () => {
    expect([
      accountStart(times, '2023-03-01' as IsoDate),
      accountStart(times, '2024-01-15' as IsoDate),
      accountStart(times, null),
      accountStart([week('2022-01-01', [8], new Date('2026-01-01T00:00:00Z')), ...times], null),
      accountStart([], '2023-03-01' as IsoDate),
    ]).toEqual(['2023-03-01', '2024-01-15', '2023-03-01', '2023-03-01', null])
  })

  it('counts up to yesterday, or up to the day somebody left', () => {
    const start = '2023-03-01' as IsoDate
    const today = '2026-11-05' as IsoDate

    expect([
      countedUntil(start, null, today),
      countedUntil(start, '2026-06-30' as IsoDate, today),
      countedUntil(start, '2026-12-31' as IsoDate, today),
      countedUntil('2026-11-05' as IsoDate, null, today),
      countedUntil(null, null, today),
    ]).toEqual(['2026-11-04', '2026-06-30', '2026-11-04', null, null])
  })

  it('has no target before it begins or after it ends, and counts no day after the last', () => {
    const days = accountDays({
      times,
      away: [],
      isHoliday: noHoliday,
      worked: new Map([
        ['2026-10-30' as IsoDate, 300],
        ['2026-11-02' as IsoDate, 500],
        ['2026-11-04' as IsoDate, 200],
      ]),
      startsOn: '2026-11-02' as IsoDate,
      leftOn: '2026-11-05' as IsoDate,
      until: '2026-11-03' as IsoDate,
      from: '2026-10-30' as IsoDate,
      to: '2026-11-06' as IsoDate,
    })

    expect(days.map((day) => [day.on, day.targetMinutes, day.workedMinutes, day.counted])).toEqual([
      ['2026-10-30', 0, 0, false],
      ['2026-10-31', 0, 0, false],
      ['2026-11-01', 0, 0, false],
      ['2026-11-02', 480, 500, true],
      ['2026-11-03', 480, 0, true],
      ['2026-11-04', 480, 200, false],
      ['2026-11-05', 480, 0, false],
      ['2026-11-06', 0, 0, false],
    ])
    expect(balanceOf(days)).toEqual({
      targetMinutes: 960,
      workedMinutes: 500,
      balanceMinutes: -460,
    })
  })

  it('writes a balance with its sign, the minus a real one', () => {
    expect([balanceText(1485), balanceText(-90), balanceText(0)]).toEqual([
      '+24:45 Std.',
      '−1:30 Std.',
      '+0:00 Std.',
    ])
  })
})
