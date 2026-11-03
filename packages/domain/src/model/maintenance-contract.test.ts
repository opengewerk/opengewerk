import { type IsoDate, ruleSet } from '@opengewerk/platform-domain'
import { describe, expect, it } from 'vitest'

import { shippedRules } from '../rules/shipped.js'
import {
  consumerTermsNotice,
  contractStanding,
  type ContractTerms,
  endAfterNotice,
  lastNoticeDay,
  lastServiceDay,
  maintenanceContractProblems,
  nextVisitOn,
  termEndOn,
  visitDescription,
} from './maintenance-contract.js'

const day = (value: string) => value as IsoDate

/** Two years from the 1st of January 2026, renewing for a year, three months notice. */
const terms: ContractTerms = {
  startsOn: day('2026-01-01'),
  termMonths: 24,
  renewal: 'fixed',
  renewalMonths: 12,
  noticeMonths: 3,
}

describe('the term of a maintenance contract (#294)', () => {
  it('ends on the last day of its months, and renews term by term', () => {
    expect(termEndOn(terms, day('2026-05-01'))).toBe('2027-12-31')
    expect(termEndOn(terms, day('2027-12-31'))).toBe('2027-12-31')
    expect(termEndOn(terms, day('2028-01-01'))).toBe('2028-12-31')
    expect(termEndOn(terms, day('2030-06-30'))).toBe('2030-12-31')
  })

  it('stays at the end of the first term for a contract that does not renew, and has none after it for one without end', () => {
    expect(termEndOn({ ...terms, renewal: 'none', renewalMonths: null }, day('2029-01-01'))).toBe(
      '2027-12-31',
    )
    expect(
      termEndOn({ ...terms, renewal: 'indefinite', renewalMonths: null }, day('2028-01-01')),
    ).toBeNull()
  })

  it('takes a notice up to the last day before the notice period', () => {
    expect(lastNoticeDay(day('2027-12-31'), 3)).toBe('2027-09-30')
    expect(lastNoticeDay(day('2027-12-31'), 0)).toBe('2027-12-31')
    expect(lastNoticeDay(day('2028-02-28'), 1)).toBe('2028-01-28')
    // A term to the end of November leaves the whole of it: the notice comes by the end of October.
    expect(lastNoticeDay(day('2027-11-30'), 1)).toBe('2027-10-31')
  })

  it('ends after a notice with the term the notice was in time for', () => {
    expect(endAfterNotice(terms, day('2027-09-30'))).toBe('2027-12-31')
    expect(endAfterNotice(terms, day('2027-10-01'))).toBe('2028-12-31')
    expect(
      endAfterNotice({ ...terms, renewal: 'none', renewalMonths: null }, day('2027-11-01')),
    ).toBe('2027-12-31')
  })

  it('ends a contract without end after the notice period from the day the notice came', () => {
    const indefinite = {
      ...terms,
      renewal: 'indefinite' as const,
      renewalMonths: null,
      noticeMonths: 1,
    }

    expect(endAfterNotice(indefinite, day('2027-11-30'))).toBe('2027-12-31')
    expect(endAfterNotice(indefinite, day('2028-03-15'))).toBe('2028-04-15')
  })

  it('says where it stands', () => {
    expect(contractStanding({ ...terms, endsOn: null }, day('2026-11-03'))).toEqual({
      text: 'Läuft bis 31.12.2027',
      tone: 'running',
    })
    expect(contractStanding({ ...terms, endsOn: day('2027-12-31') }, day('2026-11-03'))).toEqual({
      text: 'Gekündigt zum 31.12.2027',
      tone: 'ending',
    })
    expect(contractStanding({ ...terms, endsOn: day('2027-12-31') }, day('2028-01-01')).tone).toBe(
      'over',
    )
  })
})

describe('the maintenances of a contract (#294)', () => {
  const contract = { firstVisitOn: day('2026-01-31'), intervalMonths: 6 }

  it('fall on the first day and every interval after it, each counted from the first', () => {
    const window = { lastMadeOn: null, notBefore: day('2026-01-01'), lastDay: null }

    expect(nextVisitOn(contract, window)).toBe('2026-01-31')
    expect(nextVisitOn(contract, { ...window, lastMadeOn: day('2026-01-31') })).toBe('2026-07-31')
    expect(nextVisitOn(contract, { ...window, lastMadeOn: day('2026-07-31') })).toBe('2027-01-31')
  })

  it('start no earlier than the day the contract was entered', () => {
    expect(
      nextVisitOn(contract, { lastMadeOn: null, notBefore: day('2026-11-03'), lastDay: null }),
    ).toBe('2027-01-31')
  })

  it('end with the last day of a contract given notice or ending with its term', () => {
    const window = { lastMadeOn: day('2027-07-31'), notBefore: day('2026-01-01') }

    expect(nextVisitOn(contract, { ...window, lastDay: day('2027-12-31') })).toBeNull()
    expect(nextVisitOn(contract, { ...window, lastDay: day('2028-01-31') })).toBe('2028-01-31')
    expect(lastServiceDay({ ...terms, renewal: 'none', renewalMonths: null, endsOn: null })).toBe(
      '2027-12-31',
    )
    expect(lastServiceDay({ ...terms, endsOn: null })).toBeNull()
  })

  it('name the contract, the day and the services in their service job', () => {
    expect(
      visitDescription(
        { number: 'WV-2026-0003', services: 'Sichtprüfung\n\n  Thermografie  ' },
        day('2027-01-15'),
      ),
    ).toBe(
      'Wartung nach dem Wartungsvertrag WV-2026-0003, fällig am 15.01.2027.\n\n' +
        'Enthaltene Leistungen:\n- Sichtprüfung\n- Thermografie',
    )
  })
})

describe('the terms towards a consumer (§ 309 Nr. 9 BGB, #294)', () => {
  it('say nothing about a contract within the limits', () => {
    expect(
      consumerTermsNotice(shippedRules, {
        ...terms,
        termMonths: 24,
        renewal: 'indefinite',
        renewalMonths: null,
        noticeMonths: 1,
      }),
    ).toBeNull()
  })

  it('name a first term over two years, a renewal for a fixed time and a notice over a month', () => {
    expect(consumerTermsNotice(shippedRules, { ...terms, termMonths: 36 })).toBe(
      'Gegenüber einem Verbraucher in Allgemeinen Geschäftsbedingungen unwirksam (§ 309 Nr. 9 BGB): ' +
        'eine Laufzeit über 24 Monate (Buchst. a); eine stillschweigende Verlängerung um eine feste Zeit; ' +
        'zulässig ist nur eine auf unbestimmte Zeit, danach jederzeit kündbar (Buchst. b); ' +
        'eine Kündigungsfrist über 1 Monat (Buchst. b und c). Einzeln ausgehandelt darf es so stehen.',
    )
  })

  it('hold a contract that began before the 1st of March 2022 to the law of its time', () => {
    const before = { ...terms, startsOn: day('2021-06-01') }

    expect(consumerTermsNotice(shippedRules, before)).toBeNull()
    expect(consumerTermsNotice(shippedRules, { ...before, renewalMonths: 24 })).toContain(
      'eine stillschweigende Verlängerung um mehr als 12 Monate (Buchst. b)',
    )
  })

  it('say nothing where the rules have no limit', () => {
    expect(consumerTermsNotice(ruleSet([]), { ...terms, termMonths: 60 })).toBeNull()
  })
})

describe('the values of a maintenance contract (#294)', () => {
  const valid = {
    designation: 'Wartung PV-Anlage',
    services: null,
    installationIds: [],
    startsOn: '2026-12-01',
    firstVisitOn: '2027-06-01',
    intervalMonths: 12,
    termMonths: 24,
    renewal: 'indefinite',
    renewalMonths: null,
    noticeMonths: 1,
    priceKind: 'flat',
    flatCents: 18_900,
    paymentRhythm: 'visit',
  }

  it('are fine as they come from the form', () => {
    expect(maintenanceContractProblems(valid)).toEqual({})
  })

  it('refuse what does not fit together', () => {
    expect(maintenanceContractProblems({ ...valid, renewal: 'fixed' })).toEqual({
      renewalMonths: 'Die Verlängerung sind ganze Monate, 1 bis 60.',
    })
    expect(maintenanceContractProblems({ ...valid, priceKind: 'effort' })).toEqual({
      flatCents: 'Nach Aufwand hat keine Pauschale.',
    })
    expect(
      maintenanceContractProblems({
        ...valid,
        priceKind: 'effort',
        flatCents: null,
        paymentRhythm: 'yearly',
      }),
    ).toEqual({ paymentRhythm: 'Eine Rechnung je Zeitraum braucht eine Pauschale.' })
    expect(maintenanceContractProblems({ ...valid, startsOn: '2026-02-30' })).toMatchObject({
      startsOn: 'Der Beginn ist ein Tag.',
    })
    expect(maintenanceContractProblems({ ...valid, installationIds: ['a', 'a'] })).toEqual({
      installationIds: 'Höchstens 50 Anlagen, jede einmal.',
    })
  })
})
