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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { PlanningScreen } from './planning.js'

/**
 * The planning board in the office (#290): the appointments of the device in
 * the rows of the people, who is away, the jobs that wait, and the form that
 * makes, changes and takes out a day, with the version the board read.
 * Moving with the pointer is the same request as the form's and is held by
 * the routes; here the form is the way, as it is the way without dragging.
 */

let server: TestServer
let answers: Map<string, { status: number; body: unknown }>
let sent: { method: string; path: string; body: unknown }[]
let counter = 0

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [
    { id: 'c-weber', kind: 'private', name: 'Familie Weber' },
    { id: 'c-lutz', kind: 'business', name: 'Schreinerei Lutz' },
  ],
  jobs: [
    {
      id: 'j-wallbox',
      customerId: 'c-weber',
      kind: 'service',
      status: 'active',
      number: 'AU-2026-0212',
      designation: 'Wallbox Garage',
    },
    {
      id: 'j-licht',
      customerId: 'c-lutz',
      kind: 'service',
      status: 'active',
      number: 'AU-2026-0221',
      designation: 'Beleuchtung Werkstatt',
    },
    {
      id: 'j-kita',
      customerId: 'c-lutz',
      kind: 'project',
      status: 'active',
      number: 'AU-2026-0207',
      designation: 'Baustrom prüfen',
    },
  ],
  appointments: [
    {
      id: 'a-wallbox',
      jobId: 'j-wallbox',
      startsAt: '2026-11-05T06:20:00.000Z',
      endsAt: '2026-11-05T11:00:00.000Z',
      note: null,
      rrule: null,
      exdates: '[]',
      revision: 1,
      version: 3,
      deletedAt: null,
    },
    {
      id: 'a-kita',
      jobId: 'j-kita',
      startsAt: '2026-10-26T06:00:00.000Z',
      endsAt: '2026-10-26T07:00:00.000Z',
      note: null,
      rrule: 'FREQ=WEEKLY',
      exdates: '[]',
      revision: 1,
      version: 1,
      deletedAt: null,
    },
  ],
  appointment_people: [
    {
      id: 'p-anna',
      appointmentId: 'a-wallbox',
      userId: 'anna',
      confirmedRevision: 1,
      confirmedAt: '2026-11-03T17:12:00.000Z',
      deletedAt: null,
    },
    {
      id: 'p-lena',
      appointmentId: 'a-kita',
      userId: 'lena',
      confirmedRevision: null,
      confirmedAt: null,
      deletedAt: null,
    },
  ],
}

function signedInAs(...roles: RoleKey[]) {
  answer('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'britta@nord.example.de', name: 'Britta' },
    session: { activeTenantId: 't-1' },
  })
  answer('GET', '/auth/tenants', [aTenantChoice(roles)])
}

function answer(method: string, path: string, body: unknown, status = 200) {
  answers.set(`${method} ${path}`, { status, body })
}

async function mount() {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`plantafel${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet',
    entities: ['customers', 'jobs', 'appointments', 'appointment_people'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute({ component: PlanningScreen })
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

beforeEach(() => {
  server = new TestServer()
  answers = new Map()
  sent = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-05T10:00:00Z'))
  answer('GET', '/tasks/assignees', [
    { userId: 'anna', name: 'Anna Weber', active: true },
    { userId: 'lena', name: 'Lena Hoffmann', active: true },
    { userId: 'max', name: 'Max Becker', active: true },
  ])
  answer('GET', '/appointments/board?from=2026-11-02&to=2026-11-08', {
    absences: [
      {
        userId: 'max',
        kind: 'sickness',
        firstDay: '2026-11-02',
        lastDay: '2026-11-06',
        startsAtNoon: false,
        endsAtNoon: false,
      },
    ],
    holidays: [],
  })
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    if (method !== 'GET') {
      sent.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null })
    }

    const found = answers.get(`${method} ${path}`)

    return Promise.resolve(
      found === undefined
        ? new Response(method === 'GET' ? '{}' : JSON.stringify({}), {
            status: method === 'GET' ? 404 : 201,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify(found.body), {
            status: found.status,
            headers: { 'Content-Type': 'application/json' },
          }),
    )
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the planning board', () => {
  it('shows the appointments in the rows of the people, who is away, and the jobs that wait', async () => {
    signedInAs('office')
    await mount()

    const board = await screen.findByRole('region', { name: 'Plantafel' })

    expect(
      await within(board).findByRole('button', {
        name: 'Wallbox Garage, AU-2026-0212, Donnerstag, 05.11., 07:20 bis 12:00, bestätigt',
      }),
    ).toBeTruthy()
    expect(
      within(board).getByRole('button', {
        name: 'Baustrom prüfen, AU-2026-0207, Montag, 02.11., 07:00 bis 08:00, noch nicht bestätigt, Serie',
      }),
    ).toBeTruthy()
    expect(await within(board).findByText('Krank bis 06.11.')).toBeTruthy()
    expect(screen.getByText('Woche vom 02.11.2026 bis 08.11.2026')).toBeTruthy()

    // The job without an appointment from today on waits at the edge.
    const waiting = screen.getByRole('heading', { name: 'Ohne Termin (1)' }).closest('section')

    expect(within(waiting!).getByText('Beleuchtung Werkstatt')).toBeTruthy()
  })

  it('makes an appointment in the form, and warns of somebody who is away', async () => {
    signedInAs('office')
    answer('GET', '/appointments/board?from=2026-11-06&to=2026-11-06', {
      absences: [
        {
          userId: 'max',
          kind: 'sickness',
          firstDay: '2026-11-02',
          lastDay: '2026-11-06',
          startsAtNoon: false,
          endsAtNoon: false,
        },
      ],
      holidays: [],
    })
    await mount()

    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Termin anlegen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Termin anlegen' })

    await user.selectOptions(within(dialog).getByLabelText('Auftrag', { exact: false }), 'j-licht')
    await user.click(within(dialog).getByLabelText('Max Becker'))
    await user.clear(within(dialog).getByLabelText('Beginn am'))
    await user.type(within(dialog).getByLabelText('Beginn am'), '2026-11-06')
    await user.clear(within(dialog).getByLabelText('Ende am'))
    await user.type(within(dialog).getByLabelText('Ende am'), '2026-11-06')

    expect(await within(dialog).findByText('Max Becker ist am 06.11.2026 abwesend.')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(sent).toEqual([
        {
          method: 'POST',
          path: '/appointments',
          body: {
            jobId: 'j-licht',
            startsAt: '2026-11-06T07:00:00.000Z',
            endsAt: '2026-11-06T15:00:00.000Z',
            note: null,
            rrule: null,
            exdates: [],
            userIds: ['max'],
          },
        },
      ])
    })
  })

  it('changes an appointment with the version it read, and says when somebody else was quicker', async () => {
    signedInAs('office')
    answer(
      'PUT',
      '/appointments/a-wallbox',
      { message: 'Den Termin hat inzwischen jemand anders geändert.' },
      409,
    )
    await mount()

    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^Wallbox Garage, AU-2026-0212/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Termin bearbeiten' })

    expect(within(dialog).getByText('Anna Weber, am 03.11.2026')).toBeTruthy()

    await user.clear(within(dialog).getByLabelText('Beginn am'))
    await user.type(within(dialog).getByLabelText('Beginn am'), '2026-11-06')
    await user.clear(within(dialog).getByLabelText('Ende am'))
    await user.type(within(dialog).getByLabelText('Ende am'), '2026-11-06')
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      'Den Termin hat inzwischen jemand anders geändert.',
    )
    expect(sent).toEqual([
      {
        method: 'PUT',
        path: '/appointments/a-wallbox',
        body: {
          jobId: 'j-wallbox',
          startsAt: '2026-11-06T06:20:00.000Z',
          endsAt: '2026-11-06T11:00:00.000Z',
          note: null,
          rrule: null,
          exdates: [],
          userIds: ['anna'],
          version: 3,
        },
      },
    ])
  })

  it('takes the day a series was opened from out of it, and changes nothing else', async () => {
    signedInAs('office')
    await mount()

    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^Baustrom prüfen, AU-2026-0207/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Serientermin bearbeiten' })

    expect(within(dialog).getByText('Montag, 02.11.2026')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Diesen Tag ausnehmen' }))

    await waitFor(() => {
      expect(sent).toEqual([
        {
          method: 'PUT',
          path: '/appointments/a-kita',
          body: {
            jobId: 'j-kita',
            startsAt: '2026-10-26T06:00:00.000Z',
            endsAt: '2026-10-26T07:00:00.000Z',
            note: null,
            rrule: 'FREQ=WEEKLY',
            exdates: ['2026-11-02'],
            userIds: ['lena'],
            version: 1,
          },
        },
      ])
    })
  })

  it('offers no appointment to make to whoever does not plan', async () => {
    signedInAs('technician')
    await mount()

    await screen.findByRole('region', { name: 'Plantafel' })

    expect(screen.queryByRole('button', { name: 'Termin anlegen' })).toBeNull()
  })
})
