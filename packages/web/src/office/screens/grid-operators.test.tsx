import 'fake-indexeddb/auto'

import { addDays, type IsoDate, type RecordState } from '@opengewerk/domain'
import { today } from '@opengewerk/platform-web/format'
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
import { asGridOperatorLink } from './grid-documents.js'
import {
  asGridOperator,
  GridOperatorList,
  GridOperatorScreen,
  NewGridOperatorScreen,
  registrationState,
} from './grid-operators.js'
import { InstallationScreen } from './installations.js'

/**
 * The grid operators in the office (#306): their list with the state of the
 * entry of the business, their form, the card with the papers at a PV system
 * and at a wallbox of its own, and the grid operator in the form of an
 * installation.
 */

let server: TestServer
let counter = 0
const posted: { path: string; body: unknown }[] = []

const soon = addDays(today(), 30)
const operators = [
  {
    id: 'g-1',
    name: 'Stadtwerke Neckartal Netze GmbH',
    portalUrl: 'https://netzportal.neckartal-netze.de',
    requirements: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    registrationNumber: 'IV-2023-0417',
    registeredUntil: soon,
    responsibleElectrician: 'Moritz Kohm',
    installations: 1,
  },
  {
    id: 'g-2',
    name: 'Netze Bergstraße GmbH',
    portalUrl: null,
    requirements: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    registrationNumber: 'NB-77',
    registeredUntil: '2020-12-31',
    responsibleElectrician: null,
    installations: 0,
  },
  {
    id: 'g-3',
    name: 'Netz ohne Eintragung',
    portalUrl: null,
    requirements: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    registrationNumber: null,
    registeredUntil: null,
    responsibleElectrician: null,
    installations: 0,
  },
]

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Weber' }],
  sites: [{ id: 's-1', customerId: 'c-1', designation: 'Wohnhaus' }],
  installations: [
    {
      id: 'i-1',
      siteId: 's-1',
      kind: 'pv_system',
      designation: 'PV-Anlage Dach',
      gridOperatorId: 'g-1',
      gridOperatorReference: 'SNN-2026-04711',
    },
    { id: 'w-1', siteId: 's-1', kind: 'wallbox', designation: 'Wallbox Hof' },
    { id: 'b-1', siteId: 's-1', kind: 'battery', designation: 'Speicher', pvSystemId: 'i-1' },
  ],
}

async function mount(path: string) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`office-grid-operators${String((counter += 1))}`),
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
        path: '/netzbetreiber',
        component: GridOperatorList,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/netzbetreiber/neu',
        component: NewGridOperatorScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/netzbetreiber/$gridOperatorId',
        component: GridOperatorScreen,
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
      return answer(200, [aTenantChoice(['office'])])
    }

    if (path === '/grid-operators' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>

      posted.push({ path, body })

      return answer(201, { ...operators[2], ...body, id: 'g-9', installations: 0 })
    }

    if (path === '/grid-operators') {
      return answer(200, operators)
    }

    if (path === '/grid-operators/g-1') {
      return answer(200, { ...operators[0], named: [] })
    }

    if (path === '/installations/i-1/grid-operator') {
      return answer(200, {
        operator: { id: 'g-1', name: operators[0]?.name, portalUrl: operators[0]?.portalUrl },
        reference: 'SNN-2026-04711',
      })
    }

    if (path === '/installations/w-1/grid-operator') {
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

describe('the card of the grid operator at an installation (#306)', () => {
  it('names the grid operator of a PV system and leads to its papers and the help for the register', async () => {
    await mount('/anlagen/i-1')

    const card = await screen.findByRole('region', {
      name: 'Netzbetreiber und Marktstammdatenregister',
    })

    expect(await within(card).findByText('Kennung SNN-2026-04711')).toBeTruthy()
    expect(within(card).getByRole('link', { name: 'Anmeldung' }).getAttribute('href')).toBe(
      '/installations/i-1/grid-application',
    )
    expect(within(card).getByRole('link', { name: 'Fertigmeldung' }).getAttribute('href')).toBe(
      '/installations/i-1/grid-completion',
    )
    expect(
      within(card)
        .getByRole('link', { name: 'Ausfüllhilfe Marktstammdatenregister' })
        .getAttribute('href'),
    ).toBe('/installations/i-1/market-register')
    expect(within(card).getByRole('link', { name: 'Portal öffnen' }).getAttribute('href')).toBe(
      'https://netzportal.neckartal-netze.de',
    )
  })

  it('asks for a grid operator at a wallbox that names none, and offers it no help for the register', async () => {
    await mount('/anlagen/w-1')

    const card = await screen.findByRole('region', {
      name: 'Netzbetreiber und Marktstammdatenregister',
    })

    expect(await within(card).findByText(/Noch kein Netzbetreiber/)).toBeTruthy()
    expect(within(card).queryByRole('link', { name: 'Anmeldung' })).toBeNull()
    expect(
      within(card).queryByRole('link', { name: 'Ausfüllhilfe Marktstammdatenregister' }),
    ).toBeNull()
  })

  it('stands not at a battery that belongs to a PV system', async () => {
    await mount('/anlagen/b-1')

    expect(await screen.findByRole('heading', { name: 'Speicher' })).toBeTruthy()
    expect(
      screen.queryByRole('region', { name: 'Netzbetreiber und Marktstammdatenregister' }),
    ).toBeNull()
  })
})

describe('the grid operator in the form of an installation', () => {
  it('is kept for a PV system and for a battery or wallbox of its own', () => {
    expect(
      asGridOperatorLink({
        kind: 'pv_system',
        gridOperatorId: 'g-1',
        gridOperatorReference: ' SNN ',
      }),
    ).toEqual({ gridOperatorId: 'g-1', gridOperatorReference: 'SNN' })
    expect(asGridOperatorLink({ kind: 'battery', pvSystemId: '', gridOperatorId: 'g-1' })).toEqual({
      gridOperatorId: 'g-1',
      gridOperatorReference: null,
    })
  })

  it('goes with a kind that names none, and with a PV system chosen', () => {
    expect(
      asGridOperatorLink({ kind: 'meter', gridOperatorId: 'g-1', gridOperatorReference: 'SNN' }),
    ).toEqual({ gridOperatorId: null, gridOperatorReference: null })
    expect(
      asGridOperatorLink({ kind: 'battery', pvSystemId: 'i-1', gridOperatorId: 'g-1' }),
    ).toEqual({ gridOperatorId: null, gridOperatorReference: null })
  })
})

describe('the grid operators of the business', () => {
  it('list the entry of the business with whether it runs out soon or ran out', async () => {
    await mount('/netzbetreiber')

    expect(await screen.findAllByText('Stadtwerke Neckartal Netze GmbH')).not.toHaveLength(0)
    expect(screen.getAllByText('läuft bald ab')).not.toHaveLength(0)
    expect(screen.getAllByText('abgelaufen')).not.toHaveLength(0)
    expect(screen.getAllByText('nicht eingetragen')).not.toHaveLength(0)
  })

  it('tell an entry that runs out within the lead of its deadline from one that holds', () => {
    const on = '2026-11-02' as IsoDate

    expect(
      registrationState({ registrationNumber: 'IV-1', registeredUntil: '2027-01-31' }, on),
    ).toBe('soon')
    expect(
      registrationState({ registrationNumber: 'IV-1', registeredUntil: '2027-02-01' }, on),
    ).toBe('holds')
    expect(
      registrationState({ registrationNumber: 'IV-1', registeredUntil: '2026-11-01' }, on),
    ).toBe('over')
    expect(registrationState({ registrationNumber: 'IV-1', registeredUntil: null }, on)).toBe(
      'holds',
    )
    expect(registrationState({ registrationNumber: null, registeredUntil: null }, on)).toBe('none')
  })

  it('send a portal typed as a bare host with https before it', () => {
    expect(
      asGridOperator({
        name: ' Netze Bergstraße GmbH ',
        portalUrl: 'netzportal.de',
        requirements: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        registrationNumber: '',
        registeredUntil: '',
        responsibleElectrician: '',
      }),
    ).toMatchObject({
      name: 'Netze Bergstraße GmbH',
      portalUrl: 'https://netzportal.de',
      requirements: null,
    })
  })

  it('refuse a last day without the number of the entry before anything is sent', async () => {
    const user = userEvent.setup()

    await mount('/netzbetreiber/neu')

    const who = await screen.findByRole('region', { name: 'Netzbetreiber' })

    await user.type(within(who).getByLabelText(/^Name/), 'Netze Bergstraße GmbH')
    await user.type(screen.getByLabelText(/^Gültig bis/), '2027-06-30')
    await user.click(screen.getByRole('button', { name: 'Netzbetreiber anlegen' }))

    expect(
      await screen.findByText('Ein letzter Tag gehört zu einer Eintragung mit Nummer.'),
    ).toBeTruthy()
    expect(posted).toEqual([])

    await user.type(screen.getByLabelText(/^Nummer/), 'NB-77')
    await user.click(screen.getByRole('button', { name: 'Netzbetreiber anlegen' }))

    await vi.waitFor(() => {
      expect(posted).toEqual([
        {
          path: '/grid-operators',
          body: expect.objectContaining({
            name: 'Netze Bergstraße GmbH',
            registrationNumber: 'NB-77',
            registeredUntil: '2027-06-30',
          }) as unknown,
        },
      ])
    })
  })
})
