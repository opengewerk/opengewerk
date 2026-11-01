import { describe, expect, it } from 'vitest'

import { shippedRules } from '../rules/shipped.js'
import {
  type AbsenceKind,
  absenceProblems,
  type AbsenceState,
  countAbsence,
  dayCount,
  entitlementProblems,
  halvesOn,
  leaveYear,
  overlaps,
} from './absence.js'
import { holidayCalendar } from './holiday.js'

const week = (from: string, hours: readonly number[]) => ({
  validFrom: from,
  deletedAt: null,
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

const absence = (
  kind: AbsenceKind,
  state: AbsenceState,
  firstDay: string,
  lastDay: string,
  halves: { startsAtNoon?: boolean; endsAtNoon?: boolean } = {},
) => ({
  kind,
  state,
  firstDay,
  lastDay,
  startsAtNoon: halves.startsAtNoon ?? false,
  endsAtNoon: halves.endsAtNoon ?? false,
})

// The year of Anna Weber on the board "Abwesenheiten einer Person".
const anna = [
  absence('vacation', 'approved', '2026-02-24', '2026-02-27'),
  absence('vacation', 'approved', '2026-03-30', '2026-04-10'),
  absence('sickness', 'approved', '2026-05-18', '2026-05-20'),
  absence('vacation', 'rejected', '2026-07-13', '2026-07-17'),
  absence('vacation', 'approved', '2026-08-10', '2026-08-21'),
  absence('sickness', 'approved', '2026-08-13', '2026-08-14'),
  absence('vacation', 'requested', '2026-12-02', '2026-12-04'),
]

describe('a day of leave (#288)', () => {
  it('is a working day of the agreed working time that is no holiday', () => {
    // 30.03. to 10.04.2026: ten weekdays, Good Friday and Easter Monday among them.
    const easter = countAbsence(absence('vacation', 'approved', '2026-03-30', '2026-04-10'), {
      others: [],
      times,
      isHoliday,
    })

    expect(easter).toEqual({ workingHalfDays: 16, leaveHalfDays: 16, sickHalfDays: 0 })
  })

  it('is not taken on a day the person is sick, even within approved leave (section 9 BUrlG)', () => {
    const august = countAbsence(anna[4] ?? absence('vacation', 'approved', '', ''), {
      others: anna,
      times,
      isHoliday,
    })

    expect(august).toEqual({ workingHalfDays: 20, leaveHalfDays: 16, sickHalfDays: 4 })
  })

  it('follows the working time of the day it falls on', () => {
    // A week in 2027: Friday is no working day any more.
    const count = countAbsence(absence('vacation', 'approved', '2027-03-01', '2027-03-05'), {
      others: [],
      times,
      isHoliday,
    })

    expect(count.leaveHalfDays).toBe(8)
  })

  it('counts half for a first day from noon or a last day until noon', () => {
    const silvester = absence('vacation', 'requested', '2026-12-28', '2026-12-31', {
      endsAtNoon: true,
    })

    expect(countAbsence(silvester, { others: [], times, isHoliday }).leaveHalfDays).toBe(7)
    expect(
      halvesOn(
        absence('vacation', 'approved', '2026-12-28', '2026-12-31', { startsAtNoon: true }),
        '2026-12-28',
      ),
    ).toBe(1)
    expect(halvesOn(silvester, '2026-12-30')).toBe(2)
    expect(halvesOn(silvester, '2027-01-01')).toBe(0)
  })
})

describe('the year of a person', () => {
  it('adds up as on the board: 30 and 3 entitled, 20 approved, 3 asked for, 13 left, 5 sick', () => {
    const year = leaveYear({
      year: 2026,
      entitlement: { entitledHalfDays: 60, carriedHalfDays: 6 },
      absences: anna,
      times,
      isHoliday,
    })

    expect(year).toEqual({
      year: 2026,
      entitledHalfDays: 60,
      carriedHalfDays: 6,
      approvedHalfDays: 40,
      requestedHalfDays: 6,
      restHalfDays: 26,
      sickHalfDays: 10,
    })
  })

  it('counts leave across the turn of a year in each year with its own days', () => {
    // 30.12.2026 to 05.01.2027: two days in 2026; in 2027 New Year is a holiday and the 4th and 5th are left.
    const turn = [absence('vacation', 'approved', '2026-12-30', '2027-01-05')]
    const in2026 = leaveYear({ year: 2026, entitlement: null, absences: turn, times, isHoliday })
    const in2027 = leaveYear({ year: 2027, entitlement: null, absences: turn, times, isHoliday })

    expect(in2026.approvedHalfDays).toBe(4)
    expect(in2027.approvedHalfDays).toBe(4)
  })

  it('takes nothing off for a rejected request, and leaves the rest below zero when too much was approved', () => {
    const year = leaveYear({
      year: 2026,
      entitlement: { entitledHalfDays: 4, carriedHalfDays: 0 },
      absences: [
        absence('vacation', 'rejected', '2026-07-13', '2026-07-17'),
        absence('vacation', 'approved', '2026-02-23', '2026-02-25'),
      ],
      times,
      isHoliday,
    })

    expect(year.approvedHalfDays).toBe(6)
    expect(year.restHalfDays).toBe(-2)
  })
})

describe('the days of an absence', () => {
  it('overlap where they share a half day, and not where morning meets afternoon', () => {
    const morning = absence('vacation', 'approved', '2026-12-28', '2026-12-31', {
      endsAtNoon: true,
    })
    const afternoon = absence('vacation', 'approved', '2026-12-31', '2027-01-02', {
      startsAtNoon: true,
    })

    expect(overlaps(morning, afternoon)).toBe(false)
    expect(overlaps(afternoon, morning)).toBe(false)
    expect(overlaps(morning, absence('sickness', 'approved', '2026-12-31', '2026-12-31'))).toBe(
      true,
    )
    expect(overlaps(morning, absence('vacation', 'approved', '2027-01-01', '2027-01-02'))).toBe(
      false,
    )
    expect(
      overlaps(
        absence('vacation', 'approved', '2026-12-31', '2026-12-31', { endsAtNoon: true }),
        absence('vacation', 'approved', '2026-12-31', '2027-01-04', { startsAtNoon: true }),
      ),
    ).toBe(false)
  })

  it('are refused out of order, half twice over on one day, or with a note on a sickness', () => {
    expect(
      absenceProblems({ kind: 'vacation', firstDay: '2026-12-04', lastDay: '2026-12-02' }),
    ).toHaveProperty('lastDay')
    expect(
      absenceProblems({
        kind: 'vacation',
        firstDay: '2026-12-04',
        lastDay: '2026-12-04',
        startsAtNoon: true,
        endsAtNoon: true,
      }),
    ).toHaveProperty('endsAtNoon')
    expect(
      absenceProblems({
        kind: 'sickness',
        firstDay: '2026-12-04',
        lastDay: '2026-12-04',
        note: 'Grippe',
      }),
    ).toHaveProperty('note')
    expect(
      absenceProblems({
        kind: 'vacation',
        firstDay: '2026-12-04',
        lastDay: '2026-12-04',
        note: 'Hochzeit',
      }),
    ).toEqual({})
  })

  it('stand for a year in whole half days, never below zero', () => {
    expect(entitlementProblems({ year: 2026, entitledHalfDays: 60, carriedHalfDays: 5 })).toEqual(
      {},
    )
    expect(
      entitlementProblems({ year: 2026, entitledHalfDays: 59.5, carriedHalfDays: 0 }),
    ).toHaveProperty('entitledHalfDays')
    expect(
      entitlementProblems({ year: 2026, entitledHalfDays: 60, carriedHalfDays: -1 }),
    ).toHaveProperty('carriedHalfDays')
  })

  it('read as days on the screens', () => {
    expect([dayCount(60), dayCount(7), dayCount(0), dayCount(-1), dayCount(-3)]).toEqual([
      '30',
      '3,5',
      '0',
      '-0,5',
      '-1,5',
    ])
  })
})
