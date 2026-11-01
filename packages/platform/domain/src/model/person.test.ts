import { describe, expect, it } from 'vitest'

import {
  personLimits,
  personProblems,
  personStanding,
  weekMinutes,
  workingTimeHasBegun,
  workingTimeOn,
  workingTimeProblems,
} from './person.js'

/**
 * The people of a tenant as a building block of the foundation (ADR 0016):
 * what a person and a working time have to carry, how a person stands on a
 * day, and which working time holds on a day.
 */

const week = (minutes: readonly number[]) => ({
  mondayMinutes: minutes[0] ?? 0,
  tuesdayMinutes: minutes[1] ?? 0,
  wednesdayMinutes: minutes[2] ?? 0,
  thursdayMinutes: minutes[3] ?? 0,
  fridayMinutes: minutes[4] ?? 0,
  saturdayMinutes: minutes[5] ?? 0,
  sundayMinutes: minutes[6] ?? 0,
})

const time = (validFrom: string, deletedAt: Date | null = null) => ({ validFrom, deletedAt })

describe('how a person stands on a day', () => {
  it('has not joined before the day of joining, works through the day of leaving and is gone after it', () => {
    const person = { joinedOn: '2026-10-01', leftOn: '2027-03-31' }

    expect(personStanding(person, '2026-09-30')).toBe('joining')
    expect(personStanding(person, '2026-10-01')).toBe('employed')
    expect(personStanding(person, '2027-03-31')).toBe('employed')
    expect(personStanding(person, '2027-04-01')).toBe('left')
  })

  it('works without either day', () => {
    expect(personStanding({ joinedOn: null, leftOn: null }, '2026-11-01')).toBe('employed')
  })
})

describe('which working time holds on a day', () => {
  it('is the one with the latest day on or before it, the earlier one holds until the day before', () => {
    const times = [time('2023-03-01'), time('2027-01-01')]

    expect(workingTimeOn(times, '2026-12-31')?.validFrom).toBe('2023-03-01')
    expect(workingTimeOn(times, '2027-01-01')?.validFrom).toBe('2027-01-01')
    expect(workingTimeOn(times, '2023-02-28')).toBeNull()
  })

  it('leaves out one taken out of the records', () => {
    const times = [time('2023-03-01'), time('2026-06-01', new Date('2026-05-20T10:00:00Z'))]

    expect(workingTimeOn(times, '2026-11-01')?.validFrom).toBe('2023-03-01')
  })

  it('has begun on its own day and stays as it is from then on', () => {
    expect(workingTimeHasBegun({ validFrom: '2026-11-01' }, '2026-10-31')).toBe(false)
    expect(workingTimeHasBegun({ validFrom: '2026-11-01' }, '2026-11-01')).toBe(true)
  })

  it('counts the minutes of all seven days', () => {
    expect(weekMinutes(week([480, 480, 480, 480, 480, 0, 0]))).toBe(2400)
    expect(weekMinutes(week([450, 450, 450, 450, 0, 0, 0]))).toBe(1800)
  })
})

describe('what a person carries', () => {
  it('needs a name within its bound', () => {
    expect(personProblems({ name: 'Tim Schäfer' })).toEqual({})
    expect(personProblems({ name: '  ' })).toEqual({ name: 'Der Name fehlt.' })
    expect(personProblems({ name: 'x'.repeat(personLimits.name + 1) })).toEqual({
      name: 'Höchstens 120 Zeichen.',
    })
  })

  it('has an account or none', () => {
    expect(personProblems({ name: 'Anna Weber', userId: 'u-1' })).toEqual({})
    expect(personProblems({ name: 'Anna Weber', userId: null })).toEqual({})
    expect(personProblems({ name: 'Anna Weber', userId: '' })).toEqual({
      userId: 'Wählen Sie einen Zugang oder keinen.',
    })
  })

  it('takes days that are days and no leaving before joining', () => {
    expect(personProblems({ name: 'A', joinedOn: '2026-10-01', leftOn: '2026-10-01' })).toEqual({})
    expect(personProblems({ name: 'A', joinedOn: '2026-02-30' })).toEqual({
      joinedOn: 'Der Eintritt ist ein Tag, geschrieben 2026-10-03, oder leer.',
    })
    expect(personProblems({ name: 'A', joinedOn: '2026-10-01', leftOn: '2026-09-30' })).toEqual({
      leftOn: 'Der Austritt liegt nicht vor dem Eintritt.',
    })
  })
})

describe('what a working time carries', () => {
  it('needs a day and whole minutes from none to the whole day for every weekday', () => {
    expect(workingTimeProblems({ validFrom: '2027-01-01', ...week([450, 450, 450, 450]) })).toEqual(
      {},
    )
    expect(workingTimeProblems({ validFrom: '2027-01-01', ...week([1440, 0, 0, 0]) })).toEqual({})
    expect(workingTimeProblems({ validFrom: '01.01.2027', ...week([1441, -1, 7.5, 0]) })).toEqual({
      validFrom: 'Gültig ab ist ein Tag, geschrieben 2026-10-03.',
      mondayMinutes: 'Montag: von 0 bis 24 Stunden.',
      tuesdayMinutes: 'Dienstag: von 0 bis 24 Stunden.',
      wednesdayMinutes: 'Mittwoch: von 0 bis 24 Stunden.',
    })
  })

  it('names a missing weekday', () => {
    const { sundayMinutes: _left, ...withoutSunday } = week([480, 480, 480, 480, 480])

    expect(workingTimeProblems({ validFrom: '2027-01-01', ...withoutSunday })).toEqual({
      sundayMinutes: 'Sonntag: von 0 bis 24 Stunden.',
    })
  })
})
