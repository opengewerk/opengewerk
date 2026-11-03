import 'fake-indexeddb/auto'

import type { RecordState, RoleKey } from '@opengewerk/domain'
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
import { DefectScreen } from './defects.js'
import { InstallationScreen } from './installations.js'
import { JobScreen } from './jobs.js'

/**
 * Defects and complaints in the office (#311): the card at a job with the
 * report, recording one there and as a complaint at an installation, whether
 * a complaint lies within the warranty, and the steps the office takes.
 */

let server: TestServer
let answers: Map<string, unknown>
let counter = 0

const signature = { name: 'Thomas Berg', path: 'M0 0 L10 10', signedAt: '2026-10-14T15:30:00.000Z' }

const job: RecordState = {
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
  buildingWork: true,
}

/** The signed acceptance of the job on 14.10.2026, a building: five years. */
const acceptance: RecordState = {
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
  }),
}

function defect(over: Partial<RecordState> = {}): RecordState {
  return {
    id: 'd-1',
    jobId: 'j-1',
    installationId: 'i-1',
    description: 'Tür schließt nicht bündig.',
    reportedAt: '2026-10-20T08:15:00.000Z',
    createdBy: 'u-2',
    remedyDueOn: null,
    status: 'reported',
    acceptanceRecordId: null,
    acceptanceLine: null,
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
  answers.set('/tasks/assignees', [
    { userId: 'u-2', name: 'Anna Weber', active: true },
    { userId: 'u-1', name: 'Britta Büro', active: true },
  ])

  const all: Readonly<Record<string, RecordState[]>> = {
    customers: [{ id: 'c-1', kind: 'private', name: 'Familie Berg' }],
    sites: [{ id: 's-1', customerId: 'c-1', designation: 'Einfamilienhaus Lindenweg' }],
    installations: [
      { id: 'i-1', siteId: 's-1', kind: 'meter_cabinet', designation: 'Zählerschrank' },
    ],
    jobs: [job],
    ...rows,
  }

  for (const [entity, list] of Object.entries(all)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`maengel${String((counter += 1))}`),
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
      'attachments',
      'defects',
      'defect_steps',
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
        path: '/maengel/$defectId',
        component: DefectScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/$customerId',
        component: () => null,
      }),
      createRoute({ getParentRoute: () => root, path: '/objekte/$siteId', component: () => null }),
      createRoute({
        getParentRoute: () => root,
        path: '/pruefprotokolle/$recordId',
        component: () => null,
      }),
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

describe('the card "Mängel" of a job (#311)', () => {
  it('lists each defect with where it stands out of its steps, and the report', async () => {
    await mount('/auftraege/j-1', {
      form_records: [acceptance],
      defects: [
        defect(),
        defect({
          id: 'd-2',
          description: 'Beschriftung fehlt.',
          reportedAt: '2026-10-21T08:00:00.000Z',
        }),
        defect({
          id: 'd-3',
          description: 'Abdeckung fehlt',
          reportedAt: '2026-10-13T22:00:00.000Z',
          acceptanceRecordId: 'f-1',
          acceptanceLine: 1,
        }),
      ],
      defect_steps: [
        {
          id: 'st-1',
          defectId: 'd-2',
          step: 'in_progress',
          takenAt: '2026-10-22T07:00:00.000Z',
          createdBy: 'u-2',
          signerName: null,
          signaturePath: null,
        },
      ],
    })

    const card = await screen.findByRole('region', { name: 'Mängel' })
    const rows = within(card).getAllByRole('row').slice(1)

    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['Beschriftung fehlt.', 'Zählerschrank', '21.10.2026', '', 'In Bearbeitung'],
      ['Tür schließt nicht bündig.', 'Zählerschrank', '20.10.2026', '', 'Gemeldet'],
      ['Abdeckung fehltVorbehalt der Abnahme', 'Zählerschrank', '14.10.2026', '', 'Gemeldet'],
    ])
    expect(
      within(card)
        .getByRole('link', { name: /Mängelbericht/ })
        .getAttribute('href'),
    ).toBe('/jobs/j-1/defect-report')
  })

  it('records a defect at the job, with its installation and the customer’s deadline', async () => {
    const { client } = await mount('/auftraege/j-1', {})
    const card = await screen.findByRole('region', { name: 'Mängel' })

    await userEvent.click(await within(card).findByRole('button', { name: 'Mangel erfassen' }))
    await userEvent.type(within(card).getByLabelText(/Was mangelhaft ist/), 'Abdeckung klemmt.')
    await userEvent.type(
      within(card).getByLabelText('Frist des Kunden zur Beseitigung'),
      '2026-11-24',
    )
    await userEvent.click(within(card).getByRole('button', { name: 'Mangel sichern' }))

    await waitFor(() => {
      expect(client.list('defects')).toEqual([
        expect.objectContaining({
          jobId: 'j-1',
          installationId: 'i-1',
          description: 'Abdeckung klemmt.',
          remedyDueOn: '2026-11-24',
        }),
      ])
    })
  })
})

describe('the page of a defect (#311)', () => {
  it('takes the next step the office may take, and leaves the acceptance to the device', async () => {
    const { client } = await mount('/maengel/d-1', { defects: [defect()] })

    await screen.findByRole('heading', { name: 'Tür schließt nicht bündig.' })
    expect(screen.queryByRole('button', { name: /Unterschreiben/ })).toBeNull()

    await userEvent.click(await screen.findByRole('button', { name: 'Behoben' }))

    await waitFor(() => {
      expect(client.list('defect_steps')).toEqual([
        expect.objectContaining({ defectId: 'd-1', step: 'resolved' }),
      ])
    })
    expect(await screen.findByRole('button', { name: 'Doch nicht behoben' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Behoben' })).toBeNull()
  })

  it('says a complaint after the acceptance lies within the warranty of the job', async () => {
    await mount('/maengel/d-1', {
      form_records: [acceptance],
      // At the job alone: the warranty can only come from its acceptance.
      defects: [defect({ installationId: null, reportedAt: '2027-03-12T08:14:00.000Z' })],
    })

    expect(
      await screen.findByText(
        /Gemeldet am 12\.03\.2027, die Gewährleistung läuft bis 14\.10\.2031, aus der Abnahme vom 14\.10\.2026\./,
      ),
    ).toBeTruthy()
    expect(screen.getByText('In der Gewährleistung.')).toBeTruthy()
  })

  it('says a complaint after the warranty ended so', async () => {
    await mount('/maengel/d-1', {
      form_records: [acceptance],
      defects: [defect({ reportedAt: '2031-10-15T08:14:00.000Z' })],
    })

    expect(await screen.findByText('Nach der Gewährleistung.')).toBeTruthy()
  })
})

describe('the card "Mängel und Reklamationen" of an installation (#311)', () => {
  it('says of each whether it lies within the warranty, and records a complaint without a job', async () => {
    const { client } = await mount('/anlagen/i-1', {
      form_records: [acceptance],
      defects: [defect({ id: 'd-9', jobId: null, reportedAt: '2027-03-12T08:14:00.000Z' })],
    })

    const card = await screen.findByRole('region', { name: 'Mängel und Reklamationen' })

    expect(await within(card).findByText('in der Gewährleistung')).toBeTruthy()
    expect(
      within(card).getByText(
        'Die Gewährleistung der Anlage läuft bis 14.10.2031, aus der Abnahme vom 14.10.2026. Maßgeblich ist der Tag der Meldung.',
      ),
    ).toBeTruthy()

    await userEvent.click(await within(card).findByRole('button', { name: 'Reklamation erfassen' }))
    await userEvent.type(within(card).getByLabelText(/Was mangelhaft ist/), 'Lädt nicht.')
    await userEvent.click(within(card).getByRole('button', { name: 'Reklamation sichern' }))

    await waitFor(() => {
      const complaint = client
        .list('defects')
        .find((record) => record['description'] === 'Lädt nicht.')

      // Without a job, which the device leaves off rather than sending empty.
      expect(complaint).toEqual(expect.objectContaining({ installationId: 'i-1' }))
      expect(complaint?.['jobId'] ?? null).toBeNull()
    })
  })
})
