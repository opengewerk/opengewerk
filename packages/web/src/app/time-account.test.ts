import type { AccountDay, IsoDate } from '@opengewerk/domain'
import { addDays } from '@opengewerk/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TimeAccount } from '../session/time-account.js'
import {
  countedText,
  countingText,
  monthsOf,
  standingText,
  weekBalanceText,
} from './time-account.js'

/**
 * What the screens of the time account (#289) make of the server's days: the
 * months of a year with where the account stood at the end of each, the
 * balance of a week up to yesterday, and until when it counts.
 */

beforeEach(() => {
  // Thursday, 05.11.2026, as on the boards: the account counts up to the 4th.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T10:00:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
})

function days(from: string, to: string, until: string, day: (on: IsoDate) => [number, number]) {
  const all: AccountDay[] = []

  for (let on = from as IsoDate; on <= to; on = addDays(on, 1)) {
    const [target, worked] = day(on)

    all.push({ on, targetMinutes: target, workedMinutes: worked, counted: on <= until })
  }

  return all
}

const account = (over: Partial<TimeAccount>): TimeAccount => ({
  hasFile: true,
  startsOn: '2023-03-01' as IsoDate,
  countedUntil: '2026-11-04' as IsoDate,
  state: 'DE-BW',
  balanceBeforeMinutes: 390,
  balanceMinutes: 1485,
  days: [],
  ...over,
})

describe('the months of a year', () => {
  it('stand at what came over plus each month, and the last one says until when', () => {
    const year = account({
      // Every day of the year 480 agreed, 485 recorded on the 1st of a month.
      days: days('2026-01-01', '2026-12-31', '2026-11-04', (on) => [
        480,
        on.endsWith('-01') ? 485 : 480,
      ]),
    })
    const months = monthsOf(year)

    expect(
      months.map((month) => [month.label, month.balanceMinutes, month.standingMinutes]),
    ).toEqual([
      ['Januar', 5, 395],
      ['Februar', 5, 400],
      ['März', 5, 405],
      ['April', 5, 410],
      ['Mai', 5, 415],
      ['Juni', 5, 420],
      ['Juli', 5, 425],
      ['August', 5, 430],
      ['September', 5, 435],
      ['Oktober', 5, 440],
      ['November, bis 04.11.', 5, 445],
    ])
  })

  it('leave out a month nothing counted in', () => {
    const late = account({
      startsOn: '2026-10-15' as IsoDate,
      days: days('2026-01-01', '2026-12-31', '2026-11-04', (on) =>
        on < '2026-10-15' ? [0, 0] : [480, 480],
      ).map((day) => ({ ...day, counted: day.counted && day.on >= '2026-10-15' })),
    })

    expect(monthsOf(late).map((month) => month.label)).toEqual(['Oktober', 'November, bis 04.11.'])
  })
})

describe('a week', () => {
  it('counts up to yesterday while it holds today, and says when today counts', () => {
    const week = account({
      days: days('2026-11-02', '2026-11-08', '2026-11-04', (on) =>
        on > '2026-11-06'
          ? [0, 0]
          : [480, on === '2026-11-02' ? 510 : on === '2026-11-03' ? 525 : 450],
      ),
    })

    expect(weekBalanceText(week)).toBe(
      'Bis gestern Soll 24:00 Std., Ist 24:45 Std., Saldo +0:45 Std. Heute zählt erst ab morgen.',
    )
  })

  it('counts all of a week gone by, and nothing of a week to come', () => {
    const gone = account({
      days: days('2026-10-26', '2026-11-01', '2026-11-04', () => [480, 450]),
    })
    const coming = account({
      days: days('2026-11-09', '2026-11-15', '2026-11-04', () => [480, 0]),
    })

    expect([weekBalanceText(gone), weekBalanceText(coming)]).toEqual([
      'Soll 56:00 Std., Ist 52:30 Std., Saldo −3:30 Std.',
      null,
    ])
  })

  it('says nothing without a file or a working time', () => {
    expect([
      weekBalanceText(account({ hasFile: false })),
      weekBalanceText(account({ startsOn: null })),
    ]).toEqual([null, null])
  })
})

describe('where an account stands', () => {
  it('up to yesterday, or up to the day somebody left', () => {
    expect([
      standingText(account({})),
      countedText(account({ countedUntil: '2026-06-30' as IsoDate })),
      countedText(account({ countedUntil: null })),
    ]).toEqual([
      'Stand bis gestern, 04.11.2026: +24:45 Std.',
      'Stand am 30.06.2026',
      'Noch kein Tag gezählt',
    ])
  })

  it('says that no day is a holiday while the business has no state', () => {
    expect(countingText(account({ state: null }))).toContain('Ohne Bundesland zählt kein Feiertag')
    expect(countingText(account({}))).not.toContain('Bundesland')
  })
})
