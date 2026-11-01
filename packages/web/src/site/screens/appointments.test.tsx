import 'fake-indexeddb/auto'

import type { RecordState, RoleKey } from '@opengewerk/domain'
import { openLocalStore, SyncProvider } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { AppointmentsCard, SiteAppointmentsScreen } from './appointments.js'

/**
 * One's own appointments on site (#290): from the device, day by day, a time
 * over several days on each of them and nobody else's; a new one confirmed
 * with the version the person saw, and not without a network.
 */

let server: TestServer
let answers: Map<string, { status: number; body: unknown }>
let sent: { method: string; path: string; body: unknown }[]
let counter = 0

function appointment(id: string, jobId: string, startsAt: string, endsAt: string, revision = 1) {
  return {
    id,
    jobId,
    startsAt,
    endsAt,
    note: null,
    rrule: null,
    exdates: [],
    revision,
    version: 1,
    deletedAt: null,
  }
}

function person(
  id: string,
  appointmentId: string,
  userId: string,
  confirmedRevision: number | null,
) {
  return {
    id,
    appointmentId,
    userId,
    confirmedRevision,
    confirmedAt: confirmedRevision === null ? null : '2026-11-04T17:00:00.000Z',
    deletedAt: null,
  }
}

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-weber', kind: 'private', name: 'Familie Weber' }],
  sites: [
    {
      id: 's-weber',
      customerId: 'c-weber',
      designation: 'Wohnhaus',
      street: 'Am Wingertsberg',
      houseNumber: '8',
      postalCode: '69214',
      city: 'Eppelheim',
    },
  ],
  jobs: [
    {
      id: 'j-wallbox',
      customerId: 'c-weber',
      siteId: 's-weber',
      kind: 'service',
      status: 'active',
      number: 'AU-2026-0212',
      designation: 'Wallbox Garage',
    },
    {
      id: 'j-pv',
      customerId: 'c-weber',
      siteId: null,
      kind: 'project',
      status: 'active',
      number: 'AU-2026-0215',
      designation: 'PV-Anlage Ladenburg',
    },
  ],
  appointments: [
    appointment('a-wallbox', 'j-wallbox', '2026-11-05T06:20:00.000Z', '2026-11-05T11:00:00.000Z'),
    // Moved by the office: revision 2, confirmed was the first.
    appointment('a-pv', 'j-pv', '2026-11-06T06:00:00.000Z', '2026-11-06T15:00:00.000Z', 2),
    appointment('a-neubau', 'j-pv', '2026-11-09T06:30:00.000Z', '2026-11-11T15:00:00.000Z'),
    appointment('a-fremd', 'j-wallbox', '2026-11-05T05:00:00.000Z', '2026-11-05T06:00:00.000Z'),
  ],
  appointment_people: [
    person('p-1', 'a-wallbox', 'u-1', 1),
    person('p-2', 'a-pv', 'u-1', 1),
    person('p-3', 'a-neubau', 'u-1', 1),
    person('p-4', 'a-fremd', 'u-2', null),
  ],
}

function answer(method: string, path: string, body: unknown, status = 200) {
  answers.set(`${method} ${path}`, { status, body })
}

async function mount(content: ReactNode) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`termine${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet',
    entities: ['customers', 'sites', 'jobs', 'appointments', 'appointment_people'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute({ component: () => content })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SyncProvider client={client}>
        <RouterProvider router={router} />
      </SyncProvider>
    </QueryClientProvider>,
  )
}

function signedInAs(...roles: RoleKey[]) {
  answer('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'anna@nord.example.de', name: 'Anna Weber' },
    session: { activeTenantId: 't-1' },
  })
  answer('GET', '/auth/tenants', [aTenantChoice(roles)])
}

beforeEach(() => {
  server = new TestServer()
  answers = new Map()
  sent = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-05T05:30:00Z'))
  signedInAs('technician')
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (method !== 'GET') {
      sent.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null })
    }

    const found = answers.get(`${method} ${path}`)

    return Promise.resolve(
      new Response(JSON.stringify(found?.body ?? {}), {
        status: found?.status ?? (method === 'GET' ? 404 : 201),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Meine Termine', () => {
  it('lists the own appointments day by day, one over several days on each, and nobody else’s', async () => {
    await mount(<SiteAppointmentsScreen />)

    expect(await screen.findByRole('heading', { name: 'Heute, Donnerstag, 05.11.' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Morgen, Freitag, 06.11.' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Montag, 09.11.' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Dienstag, 10.11.' })).toBeTruthy()

    const cards = screen.getAllByRole('article')

    expect(cards.map((card) => card.textContent?.slice(0, 40))).toEqual([
      expect.stringContaining('07:20 bis 12:00Bestätigt'),
      expect.stringContaining('07:00 bis 16:00Neu'),
      expect.stringContaining('Tag 1 von 3, ab 07:30Bestätigt'),
      expect.stringContaining('Tag 2 von 3, ganztagsBestätigt'),
      expect.stringContaining('Tag 3 von 3, bis 16:00Bestätigt'),
    ])
    expect(within(cards[0]!).getByText('Am Wingertsberg 8, 69214 Eppelheim')).toBeTruthy()
    expect(within(cards[2]!).getByText('Bis Mittwoch, 11.11., 16:00')).toBeTruthy()
  })

  it('confirms the version the person sees', async () => {
    await mount(<SiteAppointmentsScreen />)

    const user = userEvent.setup()
    const moved = (await screen.findAllByRole('article'))[1]!

    await user.click(within(moved).getByRole('button', { name: 'Termin bestätigen' }))

    await waitFor(() => {
      expect(sent).toEqual([
        { method: 'POST', path: '/appointments/a-pv/confirm', body: { revision: 2 } },
      ])
    })
  })

  it('says when the office changed it in the meantime', async () => {
    answer('POST', '/appointments/a-pv/confirm', { message: 'Konflikt' }, 409)
    await mount(<SiteAppointmentsScreen />)

    const user = userEvent.setup()
    const moved = (await screen.findAllByRole('article'))[1]!

    await user.click(within(moved).getByRole('button', { name: 'Termin bestätigen' }))

    expect(await within(moved).findByRole('alert')).toHaveProperty(
      'textContent',
      'Das Büro hat den Termin inzwischen geändert. Sieh ihn dir noch einmal an.',
    )
  })

  it('confirms nothing without a network, and says so', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await mount(<SiteAppointmentsScreen />)

    const moved = (await screen.findAllByRole('article'))[1]!

    expect(within(moved).getByRole('button', { name: 'Termin bestätigen' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(within(moved).getByText('Zum Bestätigen braucht es Netz.')).toBeTruthy()
  })
})

describe('Deine Termine', () => {
  it('shows today and tomorrow over the open jobs, and what waits for a confirmation', async () => {
    await mount(<AppointmentsCard />)

    const card = (await screen.findByRole('heading', { name: 'Deine Termine' })).closest('section')!

    expect(
      within(card)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Heute 07:20 Wallbox Garage',
      'Morgen 07:00 PV-Anlage LadenburgNoch nicht bestätigt',
    ])
    expect(within(card).getByRole('link', { name: 'Alle Termine' })).toBeTruthy()
  })
})
