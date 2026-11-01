import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { aTenantChoice } from '../../session/test-tenants.js'
import { AbsencesScreen, halvesFrom } from './absences.js'
import { HolidaysScreen } from './holidays.js'

/**
 * The screens of leave and sickness (#288): the requests decided from the
 * list, a sickness entered without a field for its reason, and the holidays
 * of the business, set by the owner and only read by the office.
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

  return (
    <QueryClientProvider client={client}>
      <InRouter>{node}</InRouter>
    </QueryClientProvider>
  )
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [aTenantChoice(roles)])
}

const leave = (approved: number, requested: number, rest: number) => ({
  year: 2026,
  entitledHalfDays: 60,
  carriedHalfDays: 6,
  approvedHalfDays: approved,
  requestedHalfDays: requested,
  restHalfDays: rest,
  sickHalfDays: 10,
})

const overview = {
  year: 2026,
  state: 'DE-BW',
  people: [
    { id: 'p-anna', name: 'Anna Weber', leave: leave(40, 6, 26), awayToday: null },
    { id: 'p-lena', name: 'Lena Hoffmann', leave: leave(30, 0, 36), awayToday: null },
  ],
  requests: [
    {
      id: 'a-1',
      personId: 'p-anna',
      name: 'Anna Weber',
      kind: 'vacation',
      state: 'requested',
      firstDay: '2026-12-02',
      lastDay: '2026-12-04',
      startsAtNoon: false,
      endsAtNoon: false,
      note: 'Hochzeit',
      answer: null,
      decidedAt: null,
      workingHalfDays: 6,
      leaveHalfDays: 6,
      sickHalfDays: 0,
      holidays: 0,
      restAfterHalfDays: 20,
      alsoAway: [{ name: 'Jonas Brandt', firstDay: '2026-12-03', lastDay: '2026-12-03' }],
    },
  ],
}

beforeEach(() => {
  calls = []
  answers = new Map()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T10:00:00Z') })

  serverSays('GET', '/absences?year=2026', overview)

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

describe('the absences of the business', () => {
  it('list the open requests with what is left after them and who is away then, and approve one', async () => {
    signedInAs('office')
    render(inQueries(<AbsencesScreen />))

    expect(await screen.findByText('3 Arbeitstage · Rest danach 10')).toBeTruthy()
    expect(screen.getByText('Jonas Brandt ist am 03.12.2026 abwesend.')).toBeTruthy()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Freigeben' }))

    await waitFor(() => {
      expect(
        calls.some((call) => call.method === 'POST' && call.path === '/absences/a-1/approve'),
      ).toBe(true)
    })
  })

  it('show the year of everybody in days, with the rest', async () => {
    signedInAs('office')
    render(inQueries(<AbsencesScreen />))

    const table = await screen.findByRole('table', { name: 'Urlaub 2026, in Arbeitstagen' })
    const anna = within(table).getByRole('row', { name: /Anna Weber/ })

    expect(
      within(anna)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Anna Weber', '30', '3', '20', '3', '13', '5'])
  })

  it('enter a sickness with no field for its reason, and send none', async () => {
    signedInAs('office')
    render(inQueries(<AbsencesScreen />))

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Abwesenheit eintragen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Abwesenheit eintragen' })

    expect(within(dialog).getByLabelText('Notiz')).toBeTruthy()
    await user.click(within(dialog).getByRole('radio', { name: /Krankheit/ }))
    expect(within(dialog).queryByLabelText('Notiz')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Eintragen' }))

    await waitFor(() => {
      const sent = calls.find((call) => call.method === 'POST' && call.path === '/absences')

      expect(sent?.body).toMatchObject({ personId: 'p-anna', kind: 'sickness', note: null })
    })
  })

  it('read days as half days: whole and half, nothing else', () => {
    expect([
      halvesFrom('30'),
      halvesFrom('27,5'),
      halvesFrom('2.5'),
      halvesFrom('2,3'),
      halvesFrom(''),
    ]).toEqual([60, 55, 5, null, null])
  })
})

describe('the holidays of the business', () => {
  const view = {
    state: 'DE-BY',
    local: [],
    shown: 'DE-BY',
    options: [
      {
        key: 'local_holiday.assumption_day',
        name: 'Mariä Himmelfahrt',
        where: 'nur in Gemeinden mit überwiegend katholischer Bevölkerung (Art. 1 Abs. 3 FTG).',
        source: 'Art. 1 Abs. 1 Satz 2 FTG',
        on: '2026-08-15',
      },
    ],
    holidays: [
      {
        on: '2026-01-01',
        key: 'holiday.new_year',
        name: 'Neujahr',
        source: 'Art. 1 Abs. 1 Satz 1 FTG',
        local: false,
      },
    ],
  }

  it('are set by the owner, with the local ones switched on', async () => {
    signedInAs('owner')
    serverSays('GET', '/holidays?year=2026', view)
    render(inQueries(<HolidaysScreen />))

    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: /Mariä Himmelfahrt/ }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        state: 'DE-BY',
        local: ['local_holiday.assumption_day'],
      })
    })
  })

  it('are only read by the office: nothing to save, nothing to switch', async () => {
    signedInAs('office')
    serverSays('GET', '/holidays?year=2026', view)
    render(inQueries(<HolidaysScreen />))

    expect(await screen.findByRole('checkbox', { name: /Mariä Himmelfahrt/ })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })
})
