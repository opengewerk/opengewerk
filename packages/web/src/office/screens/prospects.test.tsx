import 'fake-indexeddb/auto'

import { addDays, type IsoDate, type RecordState } from '@opengewerk/domain'
import { date, today } from '@opengewerk/platform-web/format'
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
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { SalesScreen } from './pipeline.js'
import { EditProspectScreen, NewProspectScreen, ProspectList, ProspectScreen } from './prospects.js'

/**
 * The leads and the pipeline in the office (#312): the list, a lead and
 * making a customer of it, the form, and the board "Vertrieb" read off the
 * leads and the documents.
 */

let server: TestServer
let counter = 0
let roles: readonly string[] = ['office']
let rights: readonly string[] | null = null
const posted: { path: string; method: string; body: unknown }[] = []
const on = today() as IsoDate

const lead = (
  values: Record<string, unknown> & { readonly id: string; readonly name: string },
) => ({
  tenantId: 't-1',
  kind: 'private',
  concern: null,
  email: null,
  phone: null,
  street: null,
  houseNumber: null,
  postalCode: null,
  city: null,
  country: 'DE',
  stage: 'new',
  lastContactOn: on,
  customerId: null,
  siteId: null,
  convertedAt: null,
  createdAt: '2026-10-28T09:00:00.000Z',
  updatedAt: '2026-10-28T09:00:00.000Z',
  ...values,
})

const brandt = lead({
  id: 'l-1',
  name: 'Brandt, Familie',
  concern: 'PV-Anlage mit Speicher auf dem Einfamilienhaus',
  phone: '06203 84 21 57',
  street: 'Kastanienweg',
  houseNumber: '9',
  postalCode: '68535',
  city: 'Edingen-Neckarhausen',
  source: 'phone',
  stage: 'qualified',
  lastContactOn: addDays(on, -1),
})
const yilmaz = lead({
  id: 'l-2',
  name: 'Yilmaz, Deniz',
  concern: 'Wallbox in der Garage',
  source: 'referral',
})
const schmitt = lead({ id: 'l-3', name: 'Schmitt, Paul', source: 'phone', stage: 'dismissed' })
const kaiser = lead({
  id: 'l-4',
  name: 'Kaiser, Lena',
  source: 'referral',
  stage: 'qualified',
  customerId: 'c-4',
  siteId: 's-4',
  convertedAt: '2026-10-30T09:00:00.000Z',
})
const leads = [brandt, yilmaz, schmitt, kaiser]

const issued = `${addDays(on, -10)}T09:00:00.000Z`
const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [
    { id: 'c-1', kind: 'private', name: 'Kern, Ingrid' },
    { id: 'c-2', kind: 'business', name: 'Praxis Dr. Lehmann' },
    { id: 'c-3', kind: 'private', name: 'Weber, Familie' },
    { id: 'c-4', kind: 'private', name: 'Kaiser, Lena' },
  ],
  sites: [{ id: 's-4', customerId: 'c-4', designation: 'Wiesenring 14' }],
  documents: [
    {
      id: 'q-1',
      customerId: 'c-1',
      kind: 'quote',
      status: 'issued',
      number: 'AN-2026-0450',
      subject: 'PV-Anlage mit Speicher',
      documentDate: addDays(on, -10),
      issuedAt: issued,
    },
    {
      id: 'q-2',
      customerId: 'c-2',
      kind: 'quote',
      status: 'issued',
      number: 'AN-2026-0440',
      subject: 'Sanierung der Elektroinstallation',
      documentDate: addDays(on, -20),
      issuedAt: `${addDays(on, -20)}T09:00:00.000Z`,
    },
    {
      id: 'ab-1',
      customerId: 'c-2',
      kind: 'order_confirmation',
      status: 'issued',
      number: 'AB-2026-0118',
      subject: 'Sanierung der Elektroinstallation',
      predecessorDocumentId: 'q-2',
      documentDate: addDays(on, -7),
      issuedAt: `${addDays(on, -7)}T09:00:00.000Z`,
    },
    {
      id: 'ab-2',
      customerId: 'c-3',
      kind: 'order_confirmation',
      status: 'issued',
      number: 'AB-2026-0101',
      subject: 'Zählerschrank erneuern',
      documentDate: addDays(on, -30),
      issuedAt: `${addDays(on, -30)}T09:00:00.000Z`,
    },
    {
      id: 're-1',
      customerId: 'c-3',
      kind: 'final_invoice',
      status: 'issued',
      number: 'RE-2026-0204',
      subject: 'Zählerschrank erneuern',
      predecessorDocumentId: 'ab-2',
      documentDate: addDays(on, -12),
      issuedAt: `${addDays(on, -12)}T09:00:00.000Z`,
    },
  ],
  document_lines: [],
  jobs: [],
}

async function mount(path: string) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`office-prospects${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office',
    entities: ['customers', 'sites', 'documents', 'document_lines', 'jobs'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/vertrieb', component: SalesScreen }),
      createRoute({ getParentRoute: () => root, path: '/leads', component: ProspectList }),
      createRoute({ getParentRoute: () => root, path: '/leads/neu', component: NewProspectScreen }),
      createRoute({
        getParentRoute: () => root,
        path: '/leads/$prospectId',
        component: ProspectScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/leads/$prospectId/bearbeiten',
        component: EditProspectScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/$customerId',
        component: () => <p>Kundenakte</p>,
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
  rights = null

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
      return answer(200, [
        aTenantChoice([...roles], rights === null ? {} : { rights: [...rights] }),
      ])
    }

    if (init?.method && init.method !== 'GET') {
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null

      posted.push({ path, method: init.method, body })

      if (path.endsWith('/conversion')) {
        return answer(201, {
          ...brandt,
          customerId: 'c-9',
          siteId: 's-9',
          convertedAt: `${on}T10:00:00.000Z`,
        })
      }

      return answer(init.method === 'POST' ? 201 : 200, {
        ...brandt,
        ...body,
        id: init.method === 'POST' ? 'l-9' : 'l-1',
      })
    }

    if (path === '/prospects') {
      return answer(200, leads)
    }

    const one = leads.find((entry) => path === `/prospects/${entry.id}`)

    if (one) {
      return answer(200, one)
    }

    if (path.startsWith('/deadlines?')) {
      return answer(200, {
        rows: [
          {
            id: 'd-1',
            kind: 'quote.follow_up',
            status: 'open',
            dueOn: on,
            source: {
              label: 'AN-2026-0450',
              documentId: 'q-1',
              installationId: null,
              contractId: null,
            },
          },
        ],
        total: 1,
        more: false,
      })
    }

    return answer(404, {})
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the leads of the office (#312)', () => {
  it('lists each with what they want, the source, the stage and the last contact', async () => {
    await mount('/leads')

    const row = (await screen.findByText('Brandt, Familie')).closest('tr') as HTMLElement

    expect(within(row).getByText('PV-Anlage mit Speicher auf dem Einfamilienhaus')).toBeTruthy()
    expect(within(row).getByText('Anruf')).toBeTruthy()
    expect(within(row).getByText('Qualifiziert')).toBeTruthy()
    expect(within(row).getByText(date(addDays(on, -1)))).toBeTruthy()

    const converted = screen.getByText('Kaiser, Lena').closest('tr') as HTMLElement

    expect(within(converted).getByText('Kunde geworden')).toBeTruthy()
  })

  it('makes the customer and the site out of a lead in one step', async () => {
    const user = userEvent.setup()
    const { router } = await mount('/leads/l-1')

    await user.click(await screen.findByRole('button', { name: 'Kunde anlegen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Kunde aus dem Lead anlegen' })

    expect(within(dialog).getByText('Kastanienweg 9, 68535 Edingen-Neckarhausen')).toBeTruthy()
    expect((within(dialog).getByLabelText(/Bezeichnung/) as HTMLInputElement).value).toBe(
      'Kastanienweg 9',
    )

    await user.click(within(dialog).getByRole('button', { name: 'Kunde und Objekt anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/kunden/c-9')
    })
    expect(posted).toEqual([
      {
        path: '/prospects/l-1/conversion',
        method: 'POST',
        body: { designation: 'Kastanienweg 9', address: null },
      },
    ])
  })

  it('puts the site at another address when the box is cleared', async () => {
    const user = userEvent.setup()
    await mount('/leads/l-1')

    await user.click(await screen.findByRole('button', { name: 'Kunde anlegen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Kunde aus dem Lead anlegen' })

    await user.clear(within(dialog).getByLabelText(/Bezeichnung/))
    await user.type(within(dialog).getByLabelText(/Bezeichnung/), 'Ferienhaus')
    await user.click(within(dialog).getByLabelText(/An der Anschrift des Kunden/))
    await user.type(within(dialog).getByLabelText('Straße'), 'Seeweg')
    await user.type(within(dialog).getByLabelText('Ort'), 'Hinterzarten')
    await user.click(within(dialog).getByRole('button', { name: 'Kunde und Objekt anlegen' }))

    await waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]?.body).toEqual({
      designation: 'Ferienhaus',
      address: {
        street: 'Seeweg',
        houseNumber: null,
        postalCode: null,
        city: 'Hinterzarten',
        country: 'DE',
      },
    })
  })

  it('offers no customer to whoever keeps no sites', async () => {
    rights = ['prospect.read', 'prospect.write', 'customer.create']
    await mount('/leads/l-1')

    expect(await screen.findByRole('link', { name: 'Bearbeiten' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Kunde anlegen' })).toBeNull()
  })

  it('shows a converted lead with its customer and offers nothing to change', async () => {
    await mount('/leads/l-4')

    expect(await screen.findByRole('link', { name: 'Kaiser, Lena' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Wiesenring 14' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Kunde anlegen' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Löschen' })).toBeNull()
  })

  it('records a new lead and asks for the source first', async () => {
    const user = userEvent.setup()
    const { router } = await mount('/leads/neu')

    await user.type(await screen.findByLabelText(/^Name/), 'Café Rosengarten')
    await user.type(screen.getByLabelText('Anliegen'), 'LED-Beleuchtung für den Gastraum')
    await user.click(screen.getByRole('button', { name: 'Lead anlegen' }))

    expect(await screen.findByText('Woher der Lead kommt, fehlt.')).toBeTruthy()
    expect(posted).toEqual([])

    await user.selectOptions(screen.getByLabelText(/^Quelle/), 'Website')
    await user.click(screen.getByRole('button', { name: 'Lead anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/leads/l-9')
    })
    expect(posted[0]).toMatchObject({
      path: '/prospects',
      method: 'POST',
      body: {
        kind: 'private',
        name: 'Café Rosengarten',
        concern: 'LED-Beleuchtung für den Gastraum',
        source: 'website',
        stage: 'new',
        lastContactOn: on,
      },
    })
  })
})

describe('the pipeline (#312)', () => {
  it('reads lead, offer, order and done off the leads and the documents', async () => {
    await mount('/vertrieb')

    const column = async (name: string) => screen.findByRole('region', { name })
    const leadColumn = await column('Lead')

    expect(await within(leadColumn).findByRole('link', { name: 'Brandt, Familie' })).toBeTruthy()
    expect(within(leadColumn).getByRole('link', { name: 'Yilmaz, Deniz' })).toBeTruthy()
    // A customer of a lead that has no offer yet stays a lead.
    expect(within(leadColumn).getByText(/Kunde seit 30.10.2026, noch ohne Angebot/)).toBeTruthy()
    // A dismissed lead is in no column.
    expect(screen.queryByText('Schmitt, Paul')).toBeNull()

    const offer = await column('Angebot')

    expect(within(offer).getByText('AN-2026-0450 PV-Anlage mit Speicher')).toBeTruthy()
    expect(await within(offer).findByText('Wiedervorlage heute')).toBeTruthy()

    const order = await column('Auftrag')

    expect(within(order).getByText('AB-2026-0118 Sanierung der Elektroinstallation')).toBeTruthy()
    expect(within(order).queryByText(/AN-2026-0440/)).toBeNull()

    const done = await column('Abgeschlossen')

    expect(within(done).getByText('RE-2026-0204 Zählerschrank erneuern')).toBeTruthy()
    expect(within(done).getByText(new RegExp(`am ${date(addDays(on, -12))}`))).toBeTruthy()
  })
})
