import { type IsoDate, type RoleKey, shippedRules } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { claimableTransitions, nextStart, TaxScreen } from './taxes.js'

/**
 * The statement of the transition of 2027. The owner makes it, the office
 * reads it, and the engine judges every invoice for work of 2027 by it, so
 * the day it begins is as much the point as the statement itself.
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

  it('leaves the other settings of the business out of this history', async () => {
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
    expect(screen.queryByText('Verlauf')).toBeNull()
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
    expect(screen.queryByRole('button')).toBeNull()
  })
})
