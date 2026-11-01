import { federalStates, type FederalState } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { shippedRules } from '../rules/shipped.js'
import { holidayCalendar, holidaysIn, localHolidaysOf } from './holiday.js'

const of = (state: FederalState, local: readonly string[] = []) => ({ state, local })

const keys = (state: FederalState, year: number, local: readonly string[] = []) =>
  holidaysIn(shippedRules, of(state, local), year).map((holiday) =>
    holiday.key.replace(/^(local_)?holiday\./, ''),
  )

describe('the public holidays of a business (#288)', () => {
  it('are the twelve of Baden-Württemberg in 2026, on their days', () => {
    expect(
      holidaysIn(shippedRules, of('DE-BW'), 2026).map((holiday) => `${holiday.on} ${holiday.name}`),
    ).toEqual([
      '2026-01-01 Neujahr',
      '2026-01-06 Heilige Drei Könige',
      '2026-04-03 Karfreitag',
      '2026-04-06 Ostermontag',
      '2026-05-01 1. Mai',
      '2026-05-14 Christi Himmelfahrt',
      '2026-05-25 Pfingstmontag',
      '2026-06-04 Fronleichnam',
      '2026-10-03 Tag der Deutschen Einheit',
      '2026-11-01 Allerheiligen',
      '2026-12-25 1. Weihnachtstag',
      '2026-12-26 2. Weihnachtstag',
    ])
  })

  it('hold the nine every state has, in every state', () => {
    const everywhere = [
      'new_year',
      'good_friday',
      'easter_monday',
      'labour_day',
      'ascension_day',
      'whit_monday',
      'unity_day',
      'christmas_day',
      'second_christmas_day',
    ]

    for (const state of federalStates) {
      expect(keys(state, 2026)).toEqual(expect.arrayContaining(everywhere))
    }
  })

  it('count as many in 2026 as the laws name, without the local ones', () => {
    const counted = Object.fromEntries(
      federalStates.map((state) => [state, keys(state, 2026).length]),
    )

    expect(counted).toEqual({
      'DE-SH': 10,
      'DE-HH': 10,
      'DE-NI': 10,
      'DE-HB': 10,
      'DE-NW': 11,
      'DE-HE': 10,
      'DE-RP': 11,
      'DE-BW': 12,
      'DE-BY': 12,
      'DE-SL': 12,
      'DE-BE': 10,
      'DE-BB': 12,
      'DE-MV': 11,
      'DE-SN': 11,
      'DE-ST': 11,
      'DE-TH': 11,
    })
  })

  it('take a local holiday only once the business has switched it on', () => {
    expect(keys('DE-BY', 2026)).not.toContain('assumption_day')
    expect(keys('DE-BY', 2026, ['local_holiday.assumption_day'])).toContain('assumption_day')
    // Switched on in Bavaria, it does not follow the business to Hessen.
    expect(keys('DE-HE', 2026, ['local_holiday.assumption_day'])).not.toContain('assumption_day')
  })

  it('offer the local holidays of a state with where they hold', () => {
    expect(localHolidaysOf(shippedRules, 'DE-BY').map((holiday) => holiday.name)).toEqual([
      'Augsburger Friedensfest',
      'Mariä Himmelfahrt',
    ])
    expect(localHolidaysOf(shippedRules, 'DE-BY')[0]?.where).toBe('nur in der Stadt Augsburg.')
    expect(localHolidaysOf(shippedRules, 'DE-SN').map((holiday) => holiday.key)).toEqual([
      'local_holiday.corpus_christi',
    ])
    expect(localHolidaysOf(shippedRules, 'DE-BW')).toEqual([])
  })

  it('know the day of repentance and prayer in Saxony and nowhere else', () => {
    const saxony = holidayCalendar(shippedRules, of('DE-SN'))
    const thuringia = holidayCalendar(shippedRules, of('DE-TH'))

    expect(saxony('2026-11-18')).toBe(true)
    expect(saxony('2027-11-17')).toBe(true)
    expect(thuringia('2026-11-18')).toBe(false)
  })

  it('begin a later holiday on the day it first held', () => {
    const mecklenburg = holidayCalendar(shippedRules, of('DE-MV'))
    const lowerSaxony = holidayCalendar(shippedRules, of('DE-NI'))

    expect(mecklenburg('2022-03-08')).toBe(false)
    expect(mecklenburg('2023-03-08')).toBe(true)
    expect(lowerSaxony('2017-10-31')).toBe(false)
    expect(lowerSaxony('2018-10-31')).toBe(true)
  })

  it('hold a holiday of one year only in that year', () => {
    const berlin = holidayCalendar(shippedRules, of('DE-BE'))

    expect(berlin('2027-06-17')).toBe(false)
    expect(berlin('2028-06-17')).toBe(true)
    expect(berlin('2029-06-17')).toBe(false)
  })

  it('make every Sunday a holiday in Hessen, and no Sunday elsewhere', () => {
    const hessen = holidayCalendar(shippedRules, of('DE-HE'))
    const bavaria = holidayCalendar(shippedRules, of('DE-BY'))

    // The 8th of November 2026 is a Sunday and no holiday of its own.
    expect(hessen('2026-11-08')).toBe(true)
    expect(hessen('2026-11-09')).toBe(false)
    expect(bavaria('2026-11-08')).toBe(false)
  })
})
