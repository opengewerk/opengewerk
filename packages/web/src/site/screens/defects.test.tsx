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
import { SiteDefectScreen, SiteNewDefectScreen } from './defects.js'
import { SiteJobScreen } from './jobs.js'

/**
 * Defects on site (#311): the card at the job, recording one without a
 * network with a photo, and the steps on the device, where the customer signs
 * the acceptance of the remedy.
 *
 * A browser in a test has no canvas that draws, so making a picture smaller
 * is put in place, as for the files of #77.
 */
vi.mock('../../app/pictures.js', () => ({
  shrinkPicture: (_file: Blob, longEdge: number) =>
    Promise.resolve(new Uint8Array(longEdge > 1000 ? 1000 : 100).fill(7).buffer),
}))

let server: TestServer
let answers: Map<string, unknown>
let counter = 0

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Weber' }],
  sites: [{ id: 's-1', customerId: 'c-1', designation: 'Wohnhaus' }],
  installations: [{ id: 'i-1', siteId: 's-1', kind: 'wallbox', designation: 'Wallbox Garage' }],
  jobs: [
    {
      id: 'j-1',
      customerId: 'c-1',
      siteId: 's-1',
      installationId: 'i-1',
      parentJobId: null,
      kind: 'project',
      status: 'active',
      designation: 'Wallbox Garage montieren',
      description: null,
    },
  ],
}

function defect(over: Partial<RecordState> = {}): RecordState {
  return {
    id: 'd-1',
    jobId: 'j-1',
    installationId: 'i-1',
    description: 'Abdeckung links verkratzt.',
    reportedAt: '2026-11-05T14:20:00.000Z',
    createdBy: 'u-2',
    remedyDueOn: null,
    status: 'reported',
    acceptanceRecordId: null,
    acceptanceLine: null,
    ...over,
  }
}

async function mount(
  path: string,
  more: Readonly<Record<string, RecordState[]>> = {},
  roles: RoleKey[] = ['technician'],
) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'max@nord.example.de', name: 'Max Monteur' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [aTenantChoice(roles)])

  for (const [entity, list] of Object.entries({ ...rows, ...more })) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`mangel${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'telefon-max',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
      'documents',
      'tasks',
      'job_notes',
      'form_records',
      'attachments',
      'attachment_versions',
      'defects',
      'defect_steps',
    ],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId',
        component: SiteJobScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId/maengel/neu',
        component: SiteNewDefectScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId/maengel/$defectId',
        component: SiteDefectScreen,
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
  answers = new Map()
  answers.set('/tasks/assignees', [{ userId: 'u-2', name: 'Jonas Brandt', active: true }])

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

describe('the card "Mängel" at a job on site (#311)', () => {
  it('lists each defect with where it stands, and opens recording one', async () => {
    const { router } = await mount('/auftraege/j-1', {
      defects: [
        defect(),
        defect({
          id: 'd-2',
          description: 'Halter locker.',
          reportedAt: '2026-11-10T09:42:00.000Z',
        }),
      ],
      defect_steps: [
        {
          id: 'st-1',
          defectId: 'd-1',
          step: 'in_progress',
          takenAt: '2026-11-07T07:30:00.000Z',
          createdBy: 'u-2',
          signerName: null,
          signaturePath: null,
        },
      ],
    })

    const card = await screen.findByRole('region', { name: 'Mängel' })
    const list = within(card).getByRole('list', { name: 'Mängel' })

    await waitFor(() => {
      expect(
        within(list)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual([
        expect.stringMatching(/^Halter locker\.Jonas Brandt, 10\.11\.2026, \d\d:42Gemeldet$/),
        expect.stringMatching(
          /^Abdeckung links verkratzt\.Jonas Brandt, 05\.11\.2026, \d\d:20In Bearbeitung$/,
        ),
      ])
    })
    expect(within(card).getByText('2 offen')).toBeTruthy()

    await userEvent.click(await within(card).findByRole('button', { name: 'Mangel erfassen' }))
    expect(router.state.location.pathname).toBe('/auftraege/j-1/maengel/neu')
  })
})

describe('recording a defect on site (#311)', () => {
  it('goes into the outbox with its photo, which lies among the files of the job and names the defect', async () => {
    const { client, router } = await mount('/auftraege/j-1/maengel/neu')

    await userEvent.type(await screen.findByLabelText('Was mangelhaft ist'), 'Halter locker.')
    await userEvent.upload(
      screen.getByLabelText('Foto aufnehmen'),
      new File([new Uint8Array(5000).fill(1)], 'halter.jpg', { type: 'image/jpeg' }),
    )
    expect(await screen.findByRole('img', { name: 'Foto 1' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Mangel sichern' }))

    await waitFor(() => {
      expect(client.list('defects')).toEqual([
        expect.objectContaining({
          jobId: 'j-1',
          installationId: 'i-1',
          description: 'Halter locker.',
        }),
      ])
    })

    const made = String(client.list('defects')[0]?.['id'])

    await waitFor(() => {
      expect(client.list('attachments')).toEqual([
        expect.objectContaining({ jobId: 'j-1', customerId: 'c-1', siteId: 's-1', defectId: made }),
      ])
    })
    expect(router.state.location.pathname).toBe(`/auftraege/j-1/maengel/${made}`)
  })

  it('without the installation of the job, where the person leaves it off', async () => {
    const { client } = await mount('/auftraege/j-1/maengel/neu')

    await userEvent.type(await screen.findByLabelText('Was mangelhaft ist'), 'Steckdose lose.')
    await userEvent.selectOptions(screen.getByLabelText('Anlage'), 'Keine Anlage')
    await userEvent.click(screen.getByRole('button', { name: 'Mangel sichern' }))

    await waitFor(() => {
      expect(client.list('defects')).toHaveLength(1)
    })
    expect(client.list('defects')[0]?.['installationId'] ?? null).toBeNull()
  })

  it('says what is missing before anything is queued', async () => {
    const { client } = await mount('/auftraege/j-1/maengel/neu')

    await userEvent.click(await screen.findByRole('button', { name: 'Mangel sichern' }))

    expect(await screen.findByText('Ein Mangel braucht eine Beschreibung.')).toBeTruthy()
    expect(client.list('defects')).toEqual([])
  })
})

describe('a defect on site (#311)', () => {
  it('takes the next step on the device', async () => {
    const { client } = await mount('/auftraege/j-1/maengel/d-1', { defects: [defect()] })

    await userEvent.click(await screen.findByRole('button', { name: 'Behoben' }))

    await waitFor(() => {
      expect(client.list('defect_steps')).toEqual([
        expect.objectContaining({ defectId: 'd-1', step: 'resolved' }),
      ])
    })
    expect(await screen.findByRole('region', { name: 'Abnahme durch den Kunden' })).toBeTruthy()
  })

  it('is accepted only with the customer’s name and signature, and goes back where the remedy did not hold', async () => {
    const { client } = await mount('/auftraege/j-1/maengel/d-1', {
      defects: [defect()],
      defect_steps: [
        {
          id: 'st-1',
          defectId: 'd-1',
          step: 'resolved',
          takenAt: '2026-11-07T07:30:00.000Z',
          createdBy: 'u-2',
          signerName: null,
          signaturePath: null,
        },
      ],
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Unterschreiben' }))
    expect(
      await screen.findByText('Die Abnahme braucht den Namen und die Unterschrift des Kunden.'),
    ).toBeTruthy()
    expect(client.list('defect_steps')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Doch nicht behoben' }))

    await waitFor(() => {
      expect(client.list('defect_steps').map((step) => step['step'])).toEqual([
        'resolved',
        'in_progress',
      ])
    })
  })

  it('changes no more once accepted', async () => {
    await mount('/auftraege/j-1/maengel/d-1', {
      defects: [defect({ status: 'accepted' })],
      defect_steps: [
        {
          id: 'st-1',
          defectId: 'd-1',
          step: 'resolved',
          takenAt: '2026-11-07T07:30:00.000Z',
          createdBy: 'u-2',
          signerName: null,
          signaturePath: null,
        },
        {
          id: 'st-2',
          defectId: 'd-1',
          step: 'accepted',
          takenAt: '2026-11-07T08:30:00.000Z',
          createdBy: 'u-2',
          signerName: 'Petra Weber',
          signaturePath: 'M10,20L30,40',
        },
      ],
    })

    expect(
      await screen.findByText('Der Mangel ist abgenommen und ändert sich nicht mehr.'),
    ).toBeTruthy()
    expect(screen.getByText(/Petra Weber, Unterschrift/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Behoben' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unterschreiben' })).toBeNull()
  })
})
