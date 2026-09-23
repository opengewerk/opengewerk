import 'fake-indexeddb/auto'

import type { RecordState, RoleKey } from '@opengewerk/domain'
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

import { consentQuery } from '../../app/time.js'
import { TimeScreen } from '../../office/screens/time.js'
import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { JobTime, SiteTimeScreen, StopwatchBar } from './time.js'

/**
 * The working time of #76 on screen: started at a job and stopped into one
 * entry without a network, a place only with consent, a break that remembers
 * what it interrupted, corrections and withdrawals as new entries, and the
 * Working Hours Act as a warning that stops nothing.
 */

let server: TestServer
let answers: Map<string, unknown>
let counter = 0
let located: ReturnType<typeof vi.fn>

const job = {
  id: 'j-1',
  customerId: 'c-1',
  siteId: 's-1',
  installationId: null,
  kind: 'service',
  status: 'active',
  designation: 'Zählerschrank',
}

function signedInAs(...roles: RoleKey[]) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'max@nord.example.de', name: 'Max' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

/** A moment on the 21st of September 2026, in Germany. */
function at(clock: string, day = '2026-09-21'): Date {
  return new Date(`${day}T${clock}:00+02:00`)
}

async function mount(content: ReactNode, rows: Readonly<Record<string, RecordState[]>> = {}) {
  server.put('jobs', job)

  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`zeiten${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'geraet',
    entities: ['jobs', 'time_entries'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  // Under a router, because the screens link to jobs and to the list of the day.
  const router = createRouter({
    routeTree: createRootRoute({ component: () => content }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <QueryClientProvider client={queries}>
      <SyncProvider client={client}>
        <RouterProvider router={router} />
      </SyncProvider>
    </QueryClientProvider>,
  )

  return { client, queries }
}

function created() {
  return server
    .operations()
    .filter((operation) => operation.kind === 'create' && operation.entity === 'time_entries')
    .map((operation) =>
      Object.fromEntries(operation.patches.map((patch) => [patch.field, patch.to])),
    )
}

beforeEach(() => {
  server = new TestServer()
  answers = new Map()
  located = vi.fn((found: (position: GeolocationPosition) => void) => {
    found({ coords: { latitude: 49.487459, longitude: 8.466039 } } as GeolocationPosition)
  })
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: { getCurrentPosition: located },
    configurable: true,
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('07:00'))
  vi.stubGlobal('fetch', (path: string) => {
    const answer = answers.get(path)

    return Promise.resolve(
      answer === undefined
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json' } }),
    )
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the stopwatch', () => {
  it('starts at a job and stops into one entry, without a network and without a place', async () => {
    signedInAs('technician')
    const { client } = await mount(
      <>
        <StopwatchBar />
        <JobTime job={job} />
      </>,
    )
    const user = userEvent.setup()
    server.offline = true

    await user.click(await screen.findByRole('button', { name: 'Arbeit hier beginnen' }))

    const bar = await screen.findByRole('region', { name: 'Zeitnehmer' })

    expect(bar.textContent).toContain('Arbeit, Zählerschrank seit 07:00')

    vi.setSystemTime(at('11:30'))
    await user.click(within(bar).getByRole('button', { name: 'Stopp' }))

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Zeitnehmer' })).toBeNull()
    })
    expect(client.status().pending).toBe(1)

    server.offline = false
    await client.synchronise()

    // No consent, so the device was never asked where it is.
    expect(created()).toEqual([
      {
        kind: 'work',
        jobId: 'j-1',
        startedAt: '2026-09-21T05:00:00.000Z',
        endedAt: '2026-09-21T09:30:00.000Z',
      },
    ])
    expect(located).not.toHaveBeenCalled()
    expect(await screen.findByText('4:30 Std. Arbeit, 0:00 Std. Fahrt.')).toBeDefined()
  })

  it('records the place at start and at stop, and only with consent', async () => {
    signedInAs('technician')
    answers.set('/time/consent', { given: true, since: '2026-09-01T08:00:00.000Z' })
    const { client, queries } = await mount(
      <>
        <StopwatchBar />
        <JobTime job={job} />
      </>,
    )
    const user = userEvent.setup()

    await waitFor(() => {
      expect(queries.getQueryData(consentQuery.queryKey)).toMatchObject({ given: true })
    })
    await user.click(await screen.findByRole('button', { name: 'Arbeit hier beginnen' }))
    await screen.findByRole('region', { name: 'Zeitnehmer' })

    vi.setSystemTime(at('08:00'))
    await user.click(screen.getByRole('button', { name: 'Stopp' }))
    expect(await screen.findByText('1:00 Std. Arbeit, 0:00 Std. Fahrt.')).toBeDefined()
    await client.synchronise()

    expect(located).toHaveBeenCalledTimes(2)
    expect(created()[0]).toMatchObject({
      startLatitudeMicro: 49_487_459,
      startLongitudeMicro: 8_466_039,
      endLatitudeMicro: 49_487_459,
      endLongitudeMicro: 8_466_039,
    })
  })

  it('takes a break that knows what it interrupted, and goes on with it', async () => {
    signedInAs('technician')
    const { client } = await mount(
      <>
        <StopwatchBar />
        <JobTime job={job} />
      </>,
    )
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Arbeit hier beginnen' }))
    vi.setSystemTime(at('09:00'))
    await user.click(await screen.findByRole('button', { name: 'Pause' }))

    expect((await screen.findByText(/^Pause$/)).closest('p')?.textContent).toContain(
      'Pause seit 09:00',
    )

    vi.setSystemTime(at('09:30'))
    await user.click(screen.getByRole('button', { name: 'Weiter arbeiten' }))

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Zeitnehmer' }).textContent).toContain(
        'Arbeit, Zählerschrank seit 09:30',
      )
    })
    await client.synchronise()

    expect(created()).toEqual([
      expect.objectContaining({
        kind: 'work',
        jobId: 'j-1',
        endedAt: '2026-09-21T07:00:00.000Z',
      }),
      expect.objectContaining({
        kind: 'break',
        startedAt: '2026-09-21T07:00:00.000Z',
        endedAt: '2026-09-21T07:30:00.000Z',
      }),
    ])
    // The break belongs to no job; what it interrupted is only on the device.
    expect(created()[1]).not.toHaveProperty('jobId')
  })

  it('writes nothing for less than a minute', async () => {
    signedInAs('technician')
    const { client } = await mount(
      <>
        <StopwatchBar />
        <JobTime job={job} />
      </>,
    )
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Arbeit hier beginnen' }))
    vi.setSystemTime(new Date(at('07:00').getTime() + 20_000))
    await user.click(await screen.findByRole('button', { name: 'Stopp' }))

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Zeitnehmer' })).toBeNull()
    })
    expect(client.status().pending).toBe(0)
  })
})

describe('the day on site', () => {
  const long: RecordState[] = [
    {
      id: 'e-1',
      kind: 'work',
      jobId: 'j-1',
      startedAt: '2026-09-21T05:00:00.000Z',
      endedAt: '2026-09-21T10:00:00.000Z',
      note: null,
      correctsEntryId: null,
      withdrawn: false,
    },
    {
      id: 'e-2',
      kind: 'work',
      jobId: 'j-1',
      startedAt: '2026-09-21T10:30:00.000Z',
      endedAt: '2026-09-21T16:45:00.000Z',
      note: null,
      correctsEntryId: null,
      withdrawn: false,
    },
  ]

  it('warns about the Working Hours Act and keeps every entry', async () => {
    signedInAs('technician')
    vi.setSystemTime(at('20:00'))
    await mount(<SiteTimeScreen />, { time_entries: long })

    expect(await screen.findByText(/^11:15 Std\. Arbeit am 21\.09\.2026\. Erlaubt/)).toBeDefined()
    expect(screen.getByText(/30 Minuten Pause bei 11:15 Std\. Arbeit/)).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'Korrigieren' })).toHaveLength(2)
  })

  it('corrects an entry with a new one that names it, and says what it replaced', async () => {
    signedInAs('technician')
    vi.setSystemTime(at('20:00'))
    const { client } = await mount(<SiteTimeScreen />, { time_entries: long })
    const user = userEvent.setup()

    const first = (await screen.findByText('07:00 bis 12:00')).closest('li')

    if (!first) {
      throw new Error('no entry')
    }

    await user.click(within(first).getByRole('button', { name: 'Korrigieren' }))
    await user.clear(within(first).getByLabelText('Ende'))
    await user.type(within(first).getByLabelText('Ende'), '11:00')
    await user.type(within(first).getByLabelText('Grund der Korrektur'), 'Ende falsch getippt')
    await user.click(within(first).getByRole('button', { name: 'Korrektur sichern' }))

    expect(
      await screen.findByText('Korrigiert, vorher 07:00 bis 12:00. Grund: Ende falsch getippt'),
    ).toBeDefined()

    await client.synchronise()

    expect(created()).toEqual([
      {
        kind: 'work',
        jobId: 'j-1',
        startedAt: '2026-09-21T05:00:00.000Z',
        endedAt: '2026-09-21T09:00:00.000Z',
        note: 'Ende falsch getippt',
        correctsEntryId: 'e-1',
      },
    ])
  })

  it('takes an entry back with a reason, and shows it as taken back', async () => {
    signedInAs('technician')
    vi.setSystemTime(at('20:00'))
    const { client } = await mount(<SiteTimeScreen />, { time_entries: long })
    const user = userEvent.setup()

    const second = (await screen.findByText('12:30 bis 18:45')).closest('li')

    if (!second) {
      throw new Error('no entry')
    }

    await user.click(within(second).getByRole('button', { name: 'Streichen' }))
    await user.type(
      within(second).getByLabelText('Warum dieser Eintrag nicht gilt'),
      'Doppelt erfasst',
    )
    await user.click(within(second).getByRole('button', { name: 'Eintrag streichen' }))

    expect(
      await screen.findByText('Gestrichen: 12:30 bis 18:45, Arbeit. Grund: Doppelt erfasst'),
    ).toBeDefined()
    expect(screen.queryByText('12:30 bis 18:45')).toBeNull()

    await client.synchronise()

    expect(created()).toEqual([
      expect.objectContaining({
        correctsEntryId: 'e-2',
        withdrawn: true,
        note: 'Doppelt erfasst',
        startedAt: '2026-09-21T10:30:00.000Z',
      }),
    ])
  })

  it('takes a late entry and says that it is late, a night past midnight included', async () => {
    signedInAs('technician')
    vi.setSystemTime(at('09:00', '2026-09-21'))
    const { client } = await mount(<SiteTimeScreen />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Zeit nachtragen' }))

    const day = screen.getByLabelText('Tag')

    await user.clear(day)
    await user.type(day, '2026-09-08')
    await user.type(screen.getByLabelText('Beginn'), '22:00')
    await user.type(screen.getByLabelText('Ende'), '02:00')

    expect(screen.getByText('Das Ende liegt am nächsten Tag.')).toBeDefined()
    expect(screen.getByText(/Nachgetragen nach dem 15\.09\.2026/)).toBeDefined()

    await user.click(screen.getByRole('button', { name: 'Nachtragen' }))
    await screen.findByRole('button', { name: 'Zeit nachtragen' })
    await client.synchronise()

    expect(created()).toEqual([
      {
        kind: 'work',
        startedAt: '2026-09-08T20:00:00.000Z',
        endedAt: '2026-09-09T00:00:00.000Z',
      },
    ])
  })
})

describe('the week in the office', () => {
  it('shows one person at a time by name, with the warnings of each day', async () => {
    signedInAs('office')
    answers.set('/time/people', [
      { userId: 'u-2', name: 'Jonas Beispiel', active: true },
      { userId: 'u-3', name: 'Anna Muster', active: true },
    ])
    vi.setSystemTime(at('20:00'))
    await mount(<TimeScreen />, {
      time_entries: [
        {
          id: 'e-1',
          userId: 'u-2',
          kind: 'work',
          jobId: 'j-1',
          startedAt: '2026-09-21T04:00:00.000Z',
          endedAt: '2026-09-21T15:30:00.000Z',
          note: null,
          correctsEntryId: null,
          withdrawn: false,
        },
        {
          id: 'e-2',
          userId: 'u-3',
          kind: 'work',
          jobId: 'j-1',
          startedAt: '2026-09-22T06:00:00.000Z',
          endedAt: '2026-09-22T10:00:00.000Z',
          note: null,
          correctsEntryId: null,
          withdrawn: false,
        },
      ],
    })
    const user = userEvent.setup()

    const person = await screen.findByLabelText('Person')

    await waitFor(() => {
      expect(within(person).getByRole('option', { name: 'Jonas Beispiel' })).toBeDefined()
    })
    await user.selectOptions(person, 'Jonas Beispiel')

    expect(await screen.findByText(/^11:30 Std\. Arbeit am 21\.09\.2026\. Erlaubt/)).toBeDefined()
    expect(screen.getByText('Arbeit und Fahrt in dieser Woche: 11:30 Std.')).toBeDefined()

    await user.selectOptions(person, 'Anna Muster')

    expect(await screen.findByText('Arbeit und Fahrt in dieser Woche: 4:00 Std.')).toBeDefined()
    expect(screen.queryAllByText(/11:30 Std\. Arbeit am/)).toHaveLength(0)
  })

  it('is not offered to a role that does not read the time of others', async () => {
    signedInAs('technician')
    await mount(<TimeScreen />)

    expect(await screen.findByText('Die Zeiten der anderen sieht deine Rolle nicht.')).toBeDefined()
  })
})
