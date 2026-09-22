import { type IsoDate, type RoleKey, shippedRules } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cashAccountingStatementFrom,
  claimableTransitions,
  earliestFrom,
  limitOn,
  nextStart,
  proposedFrom,
  TaxScreen,
} from './taxes.js'

/**
 * What a business states about its own taxation: the small business rule,
 * cash accounting and the transition of 2027. The owner makes each statement,
 * the office reads it, and the engine judges documents by it on their own
 * dates, so the day a statement begins is as much the point as the statement.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, { status: number; body: unknown }>

function serverSays(method: string, path: string, body: unknown, status = 200): void {
  answers.set(`${method} ${path}`, { status, body })
}

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

/** One section of the screen, by the heading it carries. */
function region(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

/** A day to stand on, so that the screen does not change with the calendar. */
function itIs(day: string) {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${day}T10:00:00Z`) })
}

const claimed = {
  id: 'p-1',
  key: 'e_invoice.transition_claimed',
  validFrom: '2027-01-01',
  validUntil: null,
  value: 1,
  note: 'Umsatz laut Steuerberater',
}

beforeEach(() => {
  calls = []
  answers = new Map()
  itIs('2026-09-22')

  serverSays('GET', '/settings/parameters', [])

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    })

    const answer = answers.get(`${method} ${path}`) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the transitions a business states for itself', () => {
  it('come out of the rule package, and there is one: 2027, up to 800.000 euros', () => {
    expect(claimableTransitions(shippedRules)).toEqual([
      {
        from: '2027-01-01',
        until: '2027-12-31',
        limitCents: 80_000_000,
        source: expect.stringContaining('§ 27 Abs. 38 Satz 1 Nr. 2 UStG') as string,
      },
    ])
  })
})

describe('the day a new period of the statement begins', () => {
  const transition = { from: '2027-01-01' as IsoDate }

  it('is the first day of the transition for the first statement, made before it', () => {
    expect(nextStart([], transition, '2026-09-22' as IsoDate)).toBe('2027-01-01')
  })

  it('is still the first day for the first statement made during the transition', () => {
    // The turnover of the year before is a fact for the whole year. January
    // work that is still a draft in March is judged by it as well.
    expect(nextStart([], transition, '2027-03-10' as IsoDate)).toBe('2027-01-01')
  })

  it('is today for a later statement', () => {
    const periods = [{ validFrom: '2027-01-01' as IsoDate }]

    expect(nextStart(periods, transition, '2027-03-10' as IsoDate)).toBe('2027-03-10')
  })

  it('is never on or before the start of the last period', () => {
    expect(
      nextStart([{ validFrom: '2027-01-01' as IsoDate }], transition, '2026-11-30' as IsoDate),
    ).toBe('2027-01-02')
    expect(
      nextStart([{ validFrom: '2027-03-10' as IsoDate }], transition, '2027-03-10' as IsoDate),
    ).toBe('2027-03-11')
  })
})

describe('the tax screen for the owner', () => {
  it('states the transition from its first day, with what the statement rests on', async () => {
    signedInAs('owner')
    serverSays('POST', '/settings/parameters', { ...claimed, note: 'Umsatz 2026: 412.000 Euro' })
    render(inQueries(<TaxScreen />))

    expect(await screen.findByText(/Nicht erklärt: für Leistungen aus 2027/)).toBeTruthy()
    expect(
      await screen.findByText('Die Erklärung gilt für Leistungen ab dem 01.01.2027.'),
    ).toBeTruthy()

    const person = userEvent.setup()
    await person.type(
      await screen.findByLabelText('Grundlage der Erklärung'),
      'Umsatz 2026: 412.000 Euro',
    )
    await person.click(await screen.findByRole('button', { name: 'Übergang erklären' }))

    expect(await screen.findByText('Gespeichert.')).toBeTruthy()
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      key: 'e_invoice.transition_claimed',
      from: '2027-01-01',
      value: 1,
      note: 'Umsatz 2026: 412.000 Euro',
    })
  })

  it('takes a statement back no earlier than the day after its period began', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/parameters', [claimed])
    serverSays('POST', '/settings/parameters', { ...claimed, id: 'p-2', validFrom: '2027-01-02' })
    render(inQueries(<TaxScreen />))

    expect(
      await screen.findByText(
        'Erklärt ab dem 01.01.2027: der Gesamtumsatz 2026 lag nicht über 800.000 Euro.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('Ab 01.01.2027: erklärt. Grundlage: Umsatz laut Steuerberater'),
    ).toBeTruthy()
    expect(
      await screen.findByText('Für Leistungen ab dem 02.01.2027 gilt dann wieder die Pflicht.'),
    ).toBeTruthy()

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Erklärung zurücknehmen' }))

    expect(await screen.findByText('Gespeichert.')).toBeTruthy()
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      key: 'e_invoice.transition_claimed',
      from: '2027-01-02',
      value: 0,
      note: null,
    })
  })

  it('says a statement taken back before the year began is taken back', async () => {
    // Taken back in November 2026, the new period can only begin on the second
    // of January, so the first day stays stated. What the business states from
    // now on is the latest period, and the screen has to say that one.
    signedInAs('owner')
    serverSays('GET', '/settings/parameters', [
      { ...claimed, validUntil: '2027-01-01' },
      {
        id: 'p-2',
        key: 'e_invoice.transition_claimed',
        validFrom: '2027-01-02',
        validUntil: null,
        value: 0,
        note: null,
      },
    ])
    render(inQueries(<TaxScreen />))

    expect(
      await screen.findByText(
        'Zurückgenommen ab dem 02.01.2027: für Leistungen ab diesem Tag gilt die Pflicht zur ' +
          'E-Rechnung.',
      ),
    ).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Übergang erklären' })).toBeTruthy()
    expect(screen.getByText('Die Erklärung gilt für Leistungen ab dem 03.01.2027.')).toBeTruthy()
  })

  it('names the transition and its paragraph out of the rule package', async () => {
    signedInAs('owner')
    render(inQueries(<TaxScreen />))

    expect(
      await screen.findByRole('heading', { name: 'E-Rechnung für Leistungen aus 2027' }),
    ).toBeTruthy()
    expect(screen.getByText(/bis zum 31\.12\.2027 übermittelt werden/)).toBeTruthy()
    expect(screen.getByText(/2026 nicht über 800\.000 Euro gelegen haben/)).toBeTruthy()
    expect(screen.getByText(/§ 27 Abs\. 38 Satz 1 Nr\. 2 UStG/)).toBeTruthy()
  })

  it('keeps the history of each setting in its own section', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/parameters', [
      {
        id: 'p-9',
        key: 'small_business.claimed',
        validFrom: '2025-01-01',
        validUntil: null,
        value: 1,
        note: null,
      },
    ])
    render(inQueries(<TaxScreen />))

    expect(await screen.findByText(/Nicht erklärt: für Leistungen aus 2027/)).toBeTruthy()
    expect(within(region('E-Rechnung für Leistungen aus 2027')).queryByText('Verlauf')).toBeNull()
    expect(
      within(region('Kleinunternehmerregelung')).getByText(
        'Ab 01.01.2025: Kleinunternehmerregelung',
      ),
    ).toBeTruthy()
  })

  it('shows the reason the server gives when it refuses', async () => {
    signedInAs('owner')
    serverSays(
      'POST',
      '/settings/parameters',
      {
        message:
          'Für e_invoice.transition_claimed gilt bereits ein Wert ab 2027-01-01. Ein neuer Wert ' +
          'kann nur später beginnen.',
      },
      400,
    )
    render(inQueries(<TaxScreen />))

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Übergang erklären' }))

    expect((await screen.findByRole('alert')).textContent).toContain('nur später beginnen')
  })
})

describe('the tax screen for the office', () => {
  it('shows the statement and nothing that would change it', async () => {
    signedInAs('office')
    serverSays('GET', '/settings/parameters', [claimed])
    render(inQueries(<TaxScreen />))

    expect(
      await screen.findByText(
        'Erklärt ab dem 01.01.2027: der Gesamtumsatz 2026 lag nicht über 800.000 Euro.',
      ),
    ).toBeTruthy()
    expect(await screen.findByText('Erklären kann das nur der Inhaber.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the tax screen after the transition', () => {
  it('says how it ended and offers nothing more', async () => {
    itIs('2028-02-01')
    signedInAs('owner')
    serverSays('GET', '/settings/parameters', [claimed])
    render(inQueries(<TaxScreen />))

    expect(
      await screen.findByText('Der Übergang endete am 31.12.2027. Zuletzt war er erklärt.'),
    ).toBeTruthy()
    // Only once the roles are known is the missing button worth anything.
    await waitFor(() => {
      expect(screen.queryByText('Erklären kann das nur der Inhaber.')).toBeNull()
    })
    expect(within(region('E-Rechnung für Leistungen aus 2027')).queryByRole('button')).toBeNull()
  })
})

describe('the day a statement the business dates itself begins', () => {
  it('is the day wanted, when nothing was stated before', () => {
    expect(proposedFrom([], '2026-01-01' as IsoDate)).toBe('2026-01-01')
    expect(earliestFrom([])).toBeNull()
  })

  it('is never on or before the start of the newest period', () => {
    const periods = [{ validFrom: '2026-09-22' as IsoDate }]

    expect(earliestFrom(periods)).toBe('2026-09-23')
    expect(proposedFrom(periods, '2026-01-01' as IsoDate)).toBe('2026-09-23')
    expect(proposedFrom(periods, '2027-01-01' as IsoDate)).toBe('2027-01-01')
  })
})

describe('the figures the screen names', () => {
  it('come out of the rule packages: the limits, and 2028 for the statement on the invoice', () => {
    const on = '2026-09-22' as IsoDate

    expect(limitOn(shippedRules, 'small_business.previous_year_limit', on)).toMatchObject({
      cents: 2_500_000,
    })
    expect(limitOn(shippedRules, 'small_business.current_year_limit', on)).toMatchObject({
      cents: 10_000_000,
    })
    expect(limitOn(shippedRules, 'cash_accounting.previous_year_limit', on)).toEqual({
      cents: 80_000_000,
      source: expect.stringContaining('§ 20 Satz 1 Nr. 1 UStG') as string,
    })
    expect(cashAccountingStatementFrom(shippedRules)).toBe('2028-01-01')
  })
})

describe('the small business rule', () => {
  it('is stated from the first day of the year, with what it rests on', async () => {
    signedInAs('owner')
    serverSays('POST', '/settings/parameters', {
      id: 'p-3',
      key: 'small_business.claimed',
      validFrom: '2026-01-01',
      validUntil: null,
      value: 1,
      note: 'Umsatz 2025: 19.400 Euro',
    })
    render(inQueries(<TaxScreen />))

    const section = await screen.findByRole('region', { name: 'Kleinunternehmerregelung' })

    expect(
      within(section).getByText(
        'Nicht erklärt: neue Belege werden mit Umsatzsteuer vorgeschlagen.',
      ),
    ).toBeTruthy()
    expect(within(section).getByText(/nicht über 25\.000 Euro lag/)).toBeTruthy()
    expect(within(section).getByText(/100\.000 Euro nicht überschreitet/)).toBeTruthy()

    const start = await within(section).findByLabelText('Kleinunternehmerregelung ab')

    expect((start as HTMLInputElement).value).toBe('2026-01-01')

    const person = userEvent.setup()
    await person.type(
      within(section).getByLabelText('Grundlage zur Kleinunternehmerregelung'),
      'Umsatz 2025: 19.400 Euro',
    )
    await person.click(
      within(section).getByRole('button', { name: 'Kleinunternehmerregelung erklären' }),
    )

    expect(await within(section).findByText('Gespeichert.')).toBeTruthy()
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      key: 'small_business.claimed',
      from: '2026-01-01',
      value: 1,
      note: 'Umsatz 2025: 19.400 Euro',
    })
  })

  it('ends today unless another day is picked, and says what binds a waiver', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/parameters', [
      {
        id: 'p-3',
        key: 'small_business.claimed',
        validFrom: '2026-01-01',
        validUntil: null,
        value: 1,
        note: null,
      },
    ])
    serverSays('POST', '/settings/parameters', {})
    render(inQueries(<TaxScreen />))

    const section = await screen.findByRole('region', { name: 'Kleinunternehmerregelung' })

    expect(
      await within(section).findByText(
        'Erklärt ab dem 01.01.2026: neue Belege werden ohne Umsatzsteuer vorgeschlagen.',
      ),
    ).toBeTruthy()

    const end = await within(section).findByLabelText('Regelbesteuerung ab')

    expect((end as HTMLInputElement).value).toBe('2026-09-22')
    expect(
      within(section).getByText(/bindet mindestens fünf Jahre \(§ 19 Abs\. 3 UStG\)/),
    ).toBeTruthy()
    expect(within(section).queryByLabelText('Grundlage zur Kleinunternehmerregelung')).toBeNull()

    fireEvent.change(end, { target: { value: '2027-01-01' } })
    await userEvent
      .setup()
      .click(within(section).getByRole('button', { name: 'Kleinunternehmerregelung beenden' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        key: 'small_business.claimed',
        from: '2027-01-01',
        value: 0,
        note: null,
      })
    })
  })

  it('holds back a day the server would refuse, and says from when it may begin', async () => {
    signedInAs('owner')
    serverSays('GET', '/settings/parameters', [
      {
        id: 'p-3',
        key: 'small_business.claimed',
        validFrom: '2026-01-01',
        validUntil: null,
        value: 1,
        note: null,
      },
    ])
    render(inQueries(<TaxScreen />))

    const section = await screen.findByRole('region', { name: 'Kleinunternehmerregelung' })

    fireEvent.change(await within(section).findByLabelText('Regelbesteuerung ab'), {
      target: { value: '2026-01-01' },
    })

    expect(
      within(section).getByText(
        'Frühestens ab dem 02.01.2026, davor gilt, was zuletzt erklärt wurde.',
      ),
    ).toBeTruthy()

    const button = within(section).getByRole('button', {
      name: 'Kleinunternehmerregelung beenden',
    })

    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })
})

describe('cash accounting', () => {
  it('names the limit, the paragraph and the statement invoices carry from 2028', async () => {
    signedInAs('owner')
    render(inQueries(<TaxScreen />))

    const section = await screen.findByRole('region', { name: 'Ist-Versteuerung' })

    expect(
      within(section).getByText(
        'Nicht erklärt: der Betrieb versteuert nach vereinbarten Entgelten (Soll-Versteuerung).',
      ),
    ).toBeTruthy()
    expect(within(section).getByText(/nicht über 800\.000 Euro lag/)).toBeTruthy()
    expect(within(section).getByText(/§ 20 Satz 1 Nr\. 1 UStG/)).toBeTruthy()
    expect(
      within(section).getByText(
        /ab dem 01\.01\.2028 die Angabe „Versteuerung nach vereinnahmten Entgelten“/,
      ),
    ).toBeTruthy()
  })

  it('is stated from the day the tax office names', async () => {
    signedInAs('owner')
    serverSays('POST', '/settings/parameters', {})
    render(inQueries(<TaxScreen />))

    const section = await screen.findByRole('region', { name: 'Ist-Versteuerung' })

    fireEvent.change(await within(section).findByLabelText('Ist-Versteuerung ab'), {
      target: { value: '2026-07-01' },
    })
    await userEvent
      .setup()
      .click(within(section).getByRole('button', { name: 'Ist-Versteuerung erklären' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        key: 'cash_accounting.permitted',
        from: '2026-07-01',
        value: 1,
        note: null,
      })
    })
  })

  it('shows a statement to the office, and nothing to change it with', async () => {
    signedInAs('office')
    serverSays('GET', '/settings/parameters', [
      {
        id: 'p-4',
        key: 'cash_accounting.permitted',
        validFrom: '2026-01-01',
        validUntil: null,
        value: 1,
        note: 'Bescheid vom 12.01.2026',
      },
    ])
    render(inQueries(<TaxScreen />))

    const section = await screen.findByRole('region', { name: 'Ist-Versteuerung' })

    expect(
      await within(section).findByText(
        'Erklärt ab dem 01.01.2026: das Finanzamt hat die Ist-Versteuerung gestattet.',
      ),
    ).toBeTruthy()
    expect(
      within(section).getByText(
        'Ab 01.01.2026: Ist-Versteuerung. Grundlage: Bescheid vom 12.01.2026',
      ),
    ).toBeTruthy()
    expect(await screen.findByText('Erklären kann das nur der Inhaber.')).toBeTruthy()
    expect(within(section).queryByRole('button')).toBeNull()
  })
})
