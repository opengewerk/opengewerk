import 'fake-indexeddb/auto'

import type { RecordState, RoleKey } from '@opengewerk/domain'
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

import { buildingWorkOf } from '../../app/acceptance.js'
import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { InstallationScreen } from './installations.js'
import { JobScreen } from './jobs.js'
import { acceptanceRequestAddress } from './acceptance.js'

/**
 * The acceptance of a job in the office (#310): the card at the job with its
 * protocols, the warranty from the last signed one and the request to accept,
 * the terms of the job, and the warranty and guarantee at the installation.
 */

let server: TestServer
let answers: Map<string, unknown>
let counter = 0

const signature = { name: 'Thomas Berg', path: 'M0 0 L10 10', signedAt: '2026-10-14T15:30:00.000Z' }

function job(over: Partial<RecordState> = {}): RecordState {
  return {
    id: 'j-1',
    customerId: 'c-1',
    siteId: 's-1',
    installationId: 'i-1',
    parentJobId: null,
    predecessorJobId: null,
    kind: 'project',
    status: 'completed',
    number: 'AU-2026-0001',
    designation: 'Zählerschrank erneuern',
    description: null,
    vobAgreed: false,
    buildingWork: null,
    ...over,
  }
}

function acceptance(
  over: Partial<RecordState> = {},
  values: Record<string, unknown> = {},
): RecordState {
  return {
    id: 'f-1',
    definitionKey: 'acceptance',
    definitionVersion: 1,
    installationId: null,
    applianceId: null,
    jobId: 'j-1',
    performedOn: '2026-10-14',
    status: 'signed',
    values: JSON.stringify({
      client: 'Familie Berg',
      work: 'Zählerschrank erneuern',
      result: 'accepted_with_reservations',
      building_work: true,
      vob_agreed: false,
      reservations: 'Abdeckung fehlt',
      client_signature: signature,
      contractor_signature: signature,
      ...values,
    }),
    ...over,
  }
}

async function mount(
  at: string,
  rows: Readonly<Record<string, RecordState[]>>,
  roles: RoleKey[] = ['office'],
) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Britta Büro' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [aTenantChoice(roles)])
  answers.set('/tasks/assignees', [])

  const all: Readonly<Record<string, RecordState[]>> = {
    customers: [{ id: 'c-1', kind: 'private', name: 'Familie Berg' }],
    sites: [{ id: 's-1', customerId: 'c-1', designation: 'Einfamilienhaus Lindenweg' }],
    installations: [
      { id: 'i-1', siteId: 's-1', kind: 'meter_cabinet', designation: 'Zählerschrank' },
    ],
    ...rows,
  }

  for (const [entity, list] of Object.entries(all)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`abnahme${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
      'job_assignments',
      'documents',
      'tasks',
      'job_notes',
      'form_records',
    ],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/auftraege/$jobId', component: JobScreen }),
      createRoute({
        getParentRoute: () => root,
        path: '/anlagen/$installationId',
        component: InstallationScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/pruefprotokolle/$recordId',
        component: () => <h1>Protokoll</h1>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/$customerId',
        component: () => null,
      }),
      createRoute({ getParentRoute: () => root, path: '/objekte/$siteId', component: () => null }),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
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
  answers = new Map()

  vi.stubGlobal('fetch', (path: string) =>
    Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: answers.has(path) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the card "Abnahme" of a job (#310)', () => {
  it('lists the acceptance and the warranty that runs from it', async () => {
    await mount('/auftraege/j-1', { jobs: [job()], form_records: [acceptance()] })

    const card = await screen.findByRole('region', { name: 'Abnahme' })

    expect(await within(card).findByText('Abgenommen mit Vorbehalten')).toBeTruthy()
    expect(
      within(card).getByText(
        /Gewährleistung bis 14\.10\.2031: fünf Jahre ab der Abnahme \(§ 634a Abs\. 1 Nr\. 2 BGB\)\./,
      ),
    ).toBeTruthy()
  })

  it('says that a refused acceptance starts no warranty', async () => {
    await mount('/auftraege/j-1', {
      jobs: [job()],
      form_records: [acceptance({}, { result: 'refused' })],
    })

    const card = await screen.findByRole('region', { name: 'Abnahme' })

    expect(
      await within(card).findByText(
        /Die Abnahme ist verweigert, die Gewährleistung beginnt nicht\./,
      ),
    ).toBeTruthy()
  })

  it('starts an acceptance at the job alone, filled from customer and job', async () => {
    const user = userEvent.setup()
    const { client, router } = await mount('/auftraege/j-1', { jobs: [job()] })

    const card = await screen.findByRole('region', { name: 'Abnahme' })

    await user.click(await within(card).findByRole('button', { name: 'Abnahmeprotokoll anlegen' }))
    await screen.findByRole('heading', { name: 'Protokoll' })

    const [made] = client.list('form_records')

    expect(router.state.location.pathname).toBe(`/pruefprotokolle/${String(made?.['id'])}`)
    expect(made).toMatchObject({ definitionKey: 'acceptance', jobId: 'j-1', status: 'draft' })
    // At the job alone: no installation, no appliance.
    expect(made?.['installationId'] ?? null).toBeNull()
    expect(made?.['applianceId'] ?? null).toBeNull()
    expect(JSON.parse(String(made?.['values']))).toMatchObject({
      client: 'Familie Berg',
      work: 'Zählerschrank erneuern, AU-2026-0001',
      building_work: true,
      vob_agreed: false,
    })
  })

  it('offers the request only for a deadline from today on', async () => {
    const user = userEvent.setup()

    await mount('/auftraege/j-1', { jobs: [job()] })

    const card = await screen.findByRole('region', { name: 'Abnahme' })

    expect(within(card).queryByRole('link', { name: 'Aufforderung zur Abnahme' })).toBeNull()

    await user.type(within(card).getByLabelText('Abnehmen bis'), '2099-11-19')

    expect(
      within(card).getByRole('link', { name: 'Aufforderung zur Abnahme' }).getAttribute('href'),
    ).toBe(acceptanceRequestAddress('j-1', '2099-11-19'))
    expect(acceptanceRequestAddress('j-1', today())).toBe(
      `/jobs/j-1/acceptance-request?until=${today()}`,
    )
  })
})

describe('the terms of a job (#310)', () => {
  it('suggest a building for a project and none for a service job while the office has not said', () => {
    expect(buildingWorkOf(job())).toBe(true)
    expect(buildingWorkOf(job({ kind: 'service' }))).toBe(false)
    expect(buildingWorkOf(job({ kind: 'service', buildingWork: true }))).toBe(true)
    expect(buildingWorkOf(job({ buildingWork: false }))).toBe(false)
  })

  it('stand in the facts, with the suggestion while open', async () => {
    await mount('/auftraege/j-1', { jobs: [job({ vobAgreed: true })] })

    const facts = await screen.findByRole('region', { name: 'Auftrag' })

    expect(await within(facts).findByText('noch offen, Vorschlag: ja')).toBeTruthy()
    expect(within(facts).getByText('vereinbart')).toBeTruthy()
  })
})

describe('the warranty and the guarantee at the installation (#310)', () => {
  it('follow from the acceptance of a job at it, the guarantee of the manufacturer apart', async () => {
    await mount('/anlagen/i-1', {
      installations: [
        {
          id: 'i-1',
          siteId: 's-1',
          kind: 'meter_cabinet',
          designation: 'Zählerschrank',
          warrantyEndsOn: '2027-01-01',
          manufacturerWarrantyEndsOn: '2036-05-31',
        },
      ],
      jobs: [job()],
      form_records: [acceptance()],
    })

    const facts = await screen.findByRole('region', { name: 'Anlage' })

    expect(
      await within(facts).findByText('bis 14.10.2031, aus der Abnahme vom 14.10.2026'),
    ).toBeTruthy()
    expect(within(facts).getByText('bis 31.05.2036')).toBeTruthy()
    expect(within(facts).queryByText('bis 01.01.2027')).toBeNull()
  })
})
