import 'fake-indexeddb/auto'

import type { RecordState } from '@opengewerk/domain'
import { SyncProvider, openLocalStore } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import {
  asFundingProgram,
  FundingProgramList,
  FundingProgramScreen,
  NewFundingProgramScreen,
} from './funding-programs.js'
import { InstallationScreen } from './installations.js'
import { asInstallation, installationCheck, installationForForm, ratingOf } from './sites.js'

/**
 * Wallbox and battery in the office (#307): the funding programmes as
 * templates with their proofs, the card "Förderunterlagen" at an installation,
 * and the capacity and power in the form of an installation.
 */

let server: TestServer
let counter = 0
let roles: readonly string[] = ['office']
const posted: { path: string; body: unknown }[] = []

const programmes = [
  {
    id: 'f-1',
    name: 'Ladeinfrastruktur 2026',
    sponsor: 'Stadtwerke Neckartal',
    url: null,
    kinds: ['wallbox'],
    evidence: [
      { source: 'invoice', label: 'Rechnung' },
      { source: 'operator', label: 'Kontoauszug' },
    ],
    declaration: null,
  },
  {
    id: 'f-2',
    name: 'Batteriespeicher 2026',
    sponsor: null,
    url: null,
    kinds: ['battery'],
    evidence: [{ source: 'invoice', label: 'Rechnung' }],
    declaration: null,
  },
]

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Weber' }],
  sites: [{ id: 's-1', customerId: 'c-1', designation: 'Wohnhaus' }],
  installations: [
    {
      id: 'w-1',
      siteId: 's-1',
      kind: 'wallbox',
      designation: 'Wallbox Garage',
      ratedPowerW: 11_000,
    },
    {
      id: 'b-1',
      siteId: 's-1',
      kind: 'battery',
      designation: 'Speicher Keller',
      usableCapacityWh: 7680,
      ratedPowerW: 5000,
    },
    { id: 'm-1', siteId: 's-1', kind: 'meter', designation: 'Zähler' },
  ],
}

async function mount(path: string) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`office-funding${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
      'inverters',
      'pv_strings',
      'pv_modules',
    ],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/anlagen/$installationId',
        component: InstallationScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/foerderprogramme',
        component: FundingProgramList,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/foerderprogramme/neu',
        component: NewFundingProgramScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/foerderprogramme/$fundingProgramId',
        component: FundingProgramScreen,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
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

  return { client, router }
}

beforeEach(() => {
  server = new TestServer()
  posted.length = 0
  roles = ['office']

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const answer = (status: number, body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    if (path === '/api/auth/get-session') {
      return answer(200, {
        user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Jonas Brandt' },
        session: { activeTenantId: 't-1' },
      })
    }

    if (path === '/auth/tenants') {
      return answer(200, [aTenantChoice([...roles])])
    }

    if (path === '/funding-programs' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>

      posted.push({ path, body })

      return answer(201, { ...body, id: 'f-9' })
    }

    if (path === '/funding-programs') {
      return answer(200, programmes)
    }

    if (path === '/funding-programs/f-1') {
      return answer(200, programmes[0])
    }

    if (path.endsWith('/grid-operator')) {
      return answer(200, { operator: null, reference: null })
    }

    if (path.endsWith('/handovers')) {
      return answer(200, [])
    }

    return answer(404, {})
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the card "Förderunterlagen" at an installation (#307)', () => {
  it('offers the programmes for its kind and leads to their papers', async () => {
    const user = userEvent.setup()

    await mount('/anlagen/w-1')

    const card = await screen.findByRole('region', { name: 'Förderunterlagen' })
    const choice = await within(card).findByLabelText('Förderprogramm')

    expect(
      within(choice as HTMLElement)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Ladeinfrastruktur 2026, Stadtwerke Neckartal'])
    expect(within(card).getByRole('link', { name: 'Förderunterlagen' }).getAttribute('href')).toBe(
      '/installations/w-1/funding/f-1',
    )

    await user.selectOptions(choice, 'f-1')
    expect(within(card).getByRole('link', { name: 'Förderunterlagen' }).getAttribute('href')).toBe(
      '/installations/w-1/funding/f-1',
    )
  })

  it('says where a programme comes from when none is for the kind yet', async () => {
    programmes.splice(1, 1)

    try {
      await mount('/anlagen/b-1')

      const card = await screen.findByRole('region', { name: 'Förderunterlagen' })

      expect(
        await within(card).findByText(/Noch kein Förderprogramm für einen Speicher/),
      ).toBeTruthy()
      expect(within(card).queryByRole('link', { name: 'Förderunterlagen' })).toBeNull()
    } finally {
      programmes.push({
        id: 'f-2',
        name: 'Batteriespeicher 2026',
        sponsor: null,
        url: null,
        kinds: ['battery'],
        evidence: [{ source: 'invoice', label: 'Rechnung' }],
        declaration: null,
      })
    }
  })

  it('stands not at a meter', async () => {
    await mount('/anlagen/m-1')

    expect(await screen.findByRole('heading', { name: 'Zähler' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Förderunterlagen' })).toBeNull()
  })

  it('stands not for a technician, who has no right to the programmes', async () => {
    roles = ['technician']

    await mount('/anlagen/w-1')

    expect(await screen.findByRole('heading', { name: 'Wallbox Garage' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Förderunterlagen' })).toBeNull()
  })
})

describe('the capacity and the power of an installation (#307)', () => {
  it('stand in its facts in kilowatt hours and kilowatts', async () => {
    await mount('/anlagen/b-1')

    const facts = await screen.findByRole('region', { name: 'Anlage' })

    expect(await within(facts).findByText('7,68 kWh')).toBeTruthy()
    expect(within(facts).getByText('5 kW')).toBeTruthy()
  })

  it('are typed in kilowatt hours and kilowatts and kept in watt hours and watts', () => {
    expect(ratingOf('7,68')).toBe(7680)
    expect(ratingOf('11')).toBe(11_000)
    expect(ratingOf('1.5')).toBe(1500)
    expect(ratingOf(' ')).toBeNull()
    expect(ratingOf('elf')).toBeUndefined()
    expect(ratingOf('1,2345')).toBeUndefined()
    expect(
      asInstallation({
        designation: 'Speicher',
        kind: 'battery',
        usableCapacityWh: '7,68',
        ratedPowerW: '5',
      }),
    ).toMatchObject({ usableCapacityWh: 7680, ratedPowerW: 5000 })
    // A field the kind does not show comes back empty and goes as nothing.
    expect(asInstallation({ designation: 'Zähler', kind: 'meter', ratedPowerW: '' })).toMatchObject(
      {
        usableCapacityWh: null,
        ratedPowerW: null,
      },
    )
    expect(
      installationForForm({ id: 'b-1', usableCapacityWh: 7680, ratedPowerW: 11_000 }),
    ).toMatchObject({
      usableCapacityWh: '7,68',
      ratedPowerW: '11',
    })
  })

  it('are refused before the sync is asked when they are no number above none', () => {
    expect(installationCheck({ kind: 'battery', usableCapacityWh: 'viel' })).toBe(
      'Die nutzbare Speicherkapazität ist eine Zahl in kWh über null, etwa 7,68.',
    )
    expect(installationCheck({ kind: 'wallbox', ratedPowerW: '0' })).toBe(
      'Die Bemessungsleistung ist eine Zahl in kW über null, etwa 11.',
    )
    expect(installationCheck({ kind: 'wallbox', ratedPowerW: '11' })).toBeNull()
  })
})

describe('the funding programmes of the business (#307)', () => {
  it('list the name, who funds it, what it is for and how many proofs it asks', async () => {
    await mount('/foerderprogramme')

    const table = await screen.findByRole('table')

    expect(await within(table).findByText('Ladeinfrastruktur 2026')).toBeTruthy()
    expect(within(table).getByText('Wallbox')).toBeTruthy()
    expect(within(table).getByText('Speicher')).toBeTruthy()
  })

  it('send each proof with its name trimmed, a page with https before a bare host', () => {
    expect(
      asFundingProgram({
        name: ' Ladeinfrastruktur ',
        sponsor: ' ',
        url: 'stadtwerke.example.org/foerderung',
        kinds: ['wallbox'],
        evidence: [{ source: 'operator', label: ' Kontoauszug ' }],
        declaration: '  ',
      }),
    ).toEqual({
      name: 'Ladeinfrastruktur',
      sponsor: null,
      url: 'https://stadtwerke.example.org/foerderung',
      kinds: ['wallbox'],
      evidence: [{ source: 'operator', label: 'Kontoauszug' }],
      declaration: null,
    })
  })

  it('send the proofs in the order they are put in, and refuse a declaration without its text', async () => {
    const user = userEvent.setup()

    await mount('/foerderprogramme/neu')

    const who = await screen.findByRole('region', { name: 'Förderprogramm' })

    await user.type(within(who).getByLabelText(/^Name/), 'Ladeinfrastruktur 2026')
    await user.click(within(who).getByLabelText('Wallbox'))

    const proofs = screen.getByRole('region', { name: 'Nachweise' })

    await user.click(within(proofs).getByRole('button', { name: 'Nachweis hinzufügen' }))

    const names = within(proofs).getAllByLabelText('Wie das Programm ihn nennt')

    await user.type(names[1] as HTMLElement, 'Kontoauszug')
    await user.selectOptions(
      within(proofs).getAllByLabelText('Kommt aus')[0] as HTMLElement,
      'declaration',
    )
    await user.click(screen.getByRole('button', { name: 'Förderprogramm anlegen' }))

    expect(
      await screen.findByText('Eine Fachunternehmererklärung braucht ihren Text.'),
    ).toBeTruthy()
    expect(posted).toEqual([])

    await user.click(within(proofs).getByRole('button', { name: 'Kontoauszug nach oben' }))
    await user.type(screen.getByLabelText(/^Text der Erklärung/), 'Hiermit bestätigt {{betrieb} …')
    await user.click(screen.getByRole('button', { name: 'Förderprogramm anlegen' }))

    await vi.waitFor(() => {
      expect(posted).toEqual([
        {
          path: '/funding-programs',
          body: expect.objectContaining({
            name: 'Ladeinfrastruktur 2026',
            kinds: ['wallbox'],
            evidence: [
              { source: 'operator', label: 'Kontoauszug' },
              { source: 'declaration', label: 'Rechnung' },
            ],
            declaration: 'Hiermit bestätigt {betrieb} …',
          }) as unknown,
        },
      ])
    })
  })
})
