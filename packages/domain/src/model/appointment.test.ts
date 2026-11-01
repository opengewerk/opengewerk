import type { IsoDate } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import {
  appointmentProblem,
  berlinInstant,
  isConfirmed,
  isSeriesDay,
  nextOccurrence,
  occurrencesBetween,
  parseRule,
  ruleOf,
  ruleProblem,
  ruleText,
} from './appointment.js'

const day = (text: string) => text as IsoDate

function series(
  startsAt: string,
  endsAt: string,
  rrule: string | null,
  exdates: readonly string[] = [],
) {
  return {
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    rrule,
    exdates: exdates.map(day),
  }
}

function days(appointment: ReturnType<typeof series>, from: string, to: string) {
  return occurrencesBetween(appointment, day(from), day(to)).map(
    (occurrence) => occurrence.firstDay,
  )
}

describe('berlinInstant', () => {
  it('finds the moment a clock in Germany shows, in winter, in summer and on both days the time changes', () => {
    expect(berlinInstant(day('2026-01-15'), 7 * 60).toISOString()).toBe('2026-01-15T06:00:00.000Z')
    expect(berlinInstant(day('2026-07-15'), 7 * 60).toISOString()).toBe('2026-07-15T05:00:00.000Z')
    expect(berlinInstant(day('2026-03-29'), 7 * 60).toISOString()).toBe('2026-03-29T05:00:00.000Z')
    expect(berlinInstant(day('2026-10-25'), 7 * 60).toISOString()).toBe('2026-10-25T06:00:00.000Z')
    expect(berlinInstant(day('2026-12-31'), 23 * 60 + 30).toISOString()).toBe(
      '2026-12-31T22:30:00.000Z',
    )
  })
})

describe('the rule of a series', () => {
  it('reads what OpenGewerk understands and writes it back the same', () => {
    const rule = parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TH,MO;COUNT=6')

    expect(rule).toEqual({
      frequency: 'weekly',
      interval: 2,
      weekdays: [0, 3],
      until: null,
      count: 6,
    })
    expect(ruleOf(rule!)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=6')
    expect(parseRule('FREQ=DAILY')).toEqual({
      frequency: 'daily',
      interval: 1,
      weekdays: [],
      until: null,
      count: null,
    })
  })

  it('writes the end of a series as the last second of its day in Germany, and reads either form back to the day', () => {
    const rule = parseRule('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221')

    expect(ruleOf(rule!)).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221T225959Z')
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221T225959Z')?.until).toBe('2026-12-21')
    expect(parseRule('FREQ=DAILY;UNTIL=20260721T215959Z')?.until).toBe('2026-07-21')
  })

  it('does not understand what it would get wrong', () => {
    expect(parseRule('FREQ=HOURLY')).toBeNull()
    expect(parseRule('FREQ=MONTHLY;BYDAY=1MO')).toBeNull()
    expect(parseRule('FREQ=MONTHLY;BYMONTHDAY=-1')).toBeNull()
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO,MO')).toBeNull()
    expect(parseRule('FREQ=DAILY;COUNT=3;UNTIL=20261221')).toBeNull()
    expect(parseRule('FREQ=DAILY;INTERVAL=0')).toBeNull()
    expect(parseRule('FREQ=DAILY;WKST=SU')).toBeNull()
    expect(parseRule('FREQ=DAILY;FREQ=WEEKLY')).toBeNull()
    expect(parseRule('')).toBeNull()
  })

  it('wants the first appointment on a weekday of the week and the end not before it', () => {
    const weekly = parseRule('FREQ=WEEKLY;BYDAY=TU,TH')!

    expect(ruleProblem(weekly, day('2026-11-02'))).toBe(
      'Der erste Termin liegt auf einem der gewählten Wochentage.',
    )
    expect(ruleProblem(weekly, day('2026-11-03'))).toBeNull()
    expect(ruleProblem(parseRule('FREQ=DAILY;UNTIL=20261101')!, day('2026-11-02'))).toBe(
      'Eine Serie endet nicht vor ihrem ersten Termin.',
    )
    expect(ruleProblem(parseRule('FREQ=DAILY;COUNT=501')!, day('2026-11-02'))).not.toBeNull()
    expect(ruleProblem(parseRule('FREQ=DAILY;INTERVAL=100')!, day('2026-11-02'))).not.toBeNull()
  })

  it('says a series in words', () => {
    const on = day('2026-11-05')

    expect(ruleText(parseRule('FREQ=WEEKLY;UNTIL=20261221')!, day('2026-10-26'))).toBe(
      'Jeden Montag, bis 21.12.2026',
    )
    expect(ruleText(parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH')!, on)).toBe(
      'Alle 2 Wochen am Montag und Donnerstag',
    )
    expect(ruleText(parseRule('FREQ=MONTHLY;COUNT=10')!, on)).toBe('Monatlich am 5., 10 Mal')
    expect(ruleText(parseRule('FREQ=YEARLY')!, on)).toBe('Jährlich am 05.11.')
    expect(ruleText(parseRule('FREQ=DAILY;INTERVAL=3')!, on)).toBe('Alle 3 Tage')
  })
})

describe('the times an appointment takes place', () => {
  it('has a single appointment once, on the days it touches', () => {
    const single = series('2026-11-02T06:30:00Z', '2026-11-04T15:00:00Z', null)

    expect(days(single, '2026-11-04', '2026-11-08')).toEqual(['2026-11-02'])
    expect(occurrencesBetween(single, day('2026-11-02'), day('2026-11-02'))[0]?.lastDay).toBe(
      '2026-11-04',
    )
    expect(days(single, '2026-11-05', '2026-11-08')).toEqual([])
  })

  it('repeats a week on its weekday without the days taken out, at seven also after the clocks change', () => {
    // Monday 23.03.2026 at seven in winter time; the clocks go forward on the 29th.
    const monday = series('2026-03-23T06:00:00Z', '2026-03-23T07:00:00Z', 'FREQ=WEEKLY', [
      '2026-04-06',
    ])
    const times = occurrencesBetween(monday, day('2026-03-23'), day('2026-04-13'))

    expect(times.map((time) => time.firstDay)).toEqual(['2026-03-23', '2026-03-30', '2026-04-13'])
    expect(times.map((time) => time.startsAt.toISOString())).toEqual([
      '2026-03-23T06:00:00.000Z',
      '2026-03-30T05:00:00.000Z',
      '2026-04-13T05:00:00.000Z',
    ])
    expect(times[1]?.endsAt.toISOString()).toBe('2026-03-30T06:00:00.000Z')
  })

  it('ends a series with its last day or its count', () => {
    const until = series(
      '2026-10-26T06:00:00Z',
      '2026-10-26T07:00:00Z',
      'FREQ=WEEKLY;UNTIL=20261116',
    )
    const counted = series(
      '2026-11-02T07:00:00Z',
      '2026-11-02T08:00:00Z',
      'FREQ=DAILY;INTERVAL=2;COUNT=3',
    )

    expect(days(until, '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ])
    expect(days(counted, '2026-11-01', '2026-12-31')).toEqual([
      '2026-11-02',
      '2026-11-04',
      '2026-11-06',
    ])
    // A day taken out still counts towards the count, as in RFC 5545.
    expect(days({ ...counted, exdates: [day('2026-11-04')] }, '2026-11-01', '2026-12-31')).toEqual([
      '2026-11-02',
      '2026-11-06',
    ])
  })

  it('repeats a week on several weekdays every second week, never before its first day', () => {
    const twice = series(
      '2026-11-05T07:00:00Z',
      '2026-11-05T08:00:00Z',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH',
    )

    expect(days(twice, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-05',
      '2026-11-16',
      '2026-11-19',
      '2026-11-30',
    ])
  })

  it('skips a month without the day and a year without the 29th of February', () => {
    const monthly = series('2026-01-31T07:00:00Z', '2026-01-31T08:00:00Z', 'FREQ=MONTHLY;COUNT=4')
    const yearly = series('2028-02-29T07:00:00Z', '2028-02-29T08:00:00Z', 'FREQ=YEARLY')

    expect(days(monthly, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ])
    expect(days(yearly, '2028-01-01', '2033-12-31')).toEqual(['2028-02-29', '2032-02-29'])
  })

  it('finds a time of several days from a day in its middle, and one of a series long begun', () => {
    const three = series('2026-11-02T06:30:00Z', '2026-11-04T15:00:00Z', 'FREQ=WEEKLY')
    const daily = series('2020-01-01T07:00:00Z', '2020-01-01T08:00:00Z', 'FREQ=DAILY')

    expect(days(three, '2026-11-11', '2026-11-11')).toEqual(['2026-11-09'])
    expect(days(daily, '2026-11-05', '2026-11-06')).toEqual(['2026-11-05', '2026-11-06'])
  })

  it('knows the days a series may take out, and the next time not over yet', () => {
    const monday = series('2026-10-26T06:00:00Z', '2026-10-26T07:00:00Z', 'FREQ=WEEKLY', [
      '2026-11-09',
    ])

    expect(isSeriesDay(monday, day('2026-11-09'))).toBe(true)
    expect(isSeriesDay(monday, day('2026-11-10'))).toBe(false)
    expect(
      isSeriesDay(series('2026-11-09T06:00:00Z', '2026-11-09T07:00:00Z', null), day('2026-11-09')),
    ).toBe(false)
    expect(nextOccurrence(monday, new Date('2026-11-02T06:30:00Z'))?.firstDay).toBe('2026-11-02')
    expect(nextOccurrence(monday, new Date('2026-11-02T07:30:00Z'))?.firstDay).toBe('2026-11-16')
    expect(
      nextOccurrence(
        series('2026-11-02T06:00:00Z', '2026-11-02T07:00:00Z', null),
        new Date('2026-11-03T00:00:00Z'),
      ),
    ).toBeNull()
  })
})

describe('appointmentProblem', () => {
  const fine = {
    startsAt: new Date('2026-11-06T07:00:00Z'),
    endsAt: new Date('2026-11-06T15:00:00Z'),
    note: null,
    rrule: null,
    exdates: [],
    userIds: ['user-1'],
  }

  it('takes an appointment that ends after it begins, with somebody who goes', () => {
    expect(appointmentProblem(fine)).toBeNull()
    expect(appointmentProblem({ ...fine, endsAt: fine.startsAt })).toBe(
      'Ein Termin endet nach seinem Beginn.',
    )
    expect(appointmentProblem({ ...fine, userIds: [] })).toBe(
      'Ein Termin braucht mindestens eine Person.',
    )
    expect(appointmentProblem({ ...fine, startsAt: new Date('nonsense') })).toBe(
      'Ein Termin braucht Beginn und Ende.',
    )
  })

  it('refuses one too long, a long note, a rule it does not understand and days taken out of no series', () => {
    expect(appointmentProblem({ ...fine, endsAt: new Date('2027-01-07T15:00:00Z') })).toBe(
      'Ein Termin dauert höchstens 62 Tage.',
    )
    expect(appointmentProblem({ ...fine, endsAt: new Date('2027-01-05T15:00:00Z') })).toBeNull()
    expect(appointmentProblem({ ...fine, note: 'x'.repeat(501) })).not.toBeNull()
    expect(appointmentProblem({ ...fine, rrule: 'FREQ=HOURLY' })).toBe(
      'Diese Wiederholung versteht OpenGewerk nicht.',
    )
    expect(appointmentProblem({ ...fine, rrule: 'FREQ=WEEKLY;BYDAY=MO' })).toBe(
      'Der erste Termin liegt auf einem der gewählten Wochentage.',
    )
    expect(appointmentProblem({ ...fine, exdates: [day('2026-11-13')] })).toBe(
      'Nur eine Serie nimmt Tage aus.',
    )
    expect(
      appointmentProblem({ ...fine, rrule: 'FREQ=WEEKLY', exdates: [day('2026-11-13')] }),
    ).toBeNull()
  })
})

describe('isConfirmed', () => {
  it('holds for the version a person confirmed and not for a later one', () => {
    expect(isConfirmed({ confirmedRevision: 2 }, { revision: 2 })).toBe(true)
    expect(isConfirmed({ confirmedRevision: 1 }, { revision: 2 })).toBe(false)
    expect(isConfirmed({ confirmedRevision: null }, { revision: 1 })).toBe(false)
  })
})
