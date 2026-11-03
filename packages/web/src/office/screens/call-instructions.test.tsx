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
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { JobScreen } from './jobs.js'

/**
 * The instructions of a service call in the office (#292): the card for a
 * consumer, what went out and what was signed at the door, sending them by
 * mail with the right to write jobs, and the appointments of the job.
 */

let server: TestServer
let answers: Map<string, unknown>
let calls: { path: string; method: string }[]
let counter = 0

function call(over: Partial<RecordState> = {}): RecordState {
  return {
    id: 'j-1',
    customerId: 'c-1',
    siteId: null,
    installationId: null,
    parentJobId: null,
    predecessorJobId: null,
    kind: 'service',
    status: 'active',
    number: 'AU-2026-0240',
    designation: 'Sicherung Küche löst aus',
    description: null,
    vobAgreed: false,
    buildingWork: null,
    urgentRepair: true,
    ...over,
  }
}

const instructions = {
  refusal: null,
  urgentRepair: true,
  email: 'klaus.lehmann@example.com',
  sheets: [{ template: 'withdrawal', title: 'Widerrufsbelehrung', text: 'Sie haben das Recht …' }],
  request: 'Ich verlange ausdrücklich …',
  gaps: [],
  fingerprint: 'fnv1a32:00000000:1',
  signed: [],
  mails: [
    {
      id: 'm-1',
      to: 'klaus.lehmann@example.com',
      status: 'sent',
      lastError: null,
      sentAt: '2026-11-03T07:15:00.000Z',
      createdAt: '2026-11-03T07:14:00.000Z',
      requestedBy: 'Britta Büro',
      withRequest: false,
    },
  ],
}

async function mount(rows: Readonly<Record<string, RecordState[]>>, roles: RoleKey[] = ['office']) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Britta Büro' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [aTenantChoice(roles)])
  answers.set('/tasks/assignees', [
    { userId: 'u-2', name: 'Jonas Brandt', active: true },
    { userId: 'u-1', name: 'Britta Büro', active: true },
  ])
  answers.set('/jobs/j-1/instructions', instructions)

  const all: Readonly<Record<string, RecordState[]>> = {
    customers: [{ id: 'c-1', kind: 'private', name: 'Klaus Lehmann', isBusiness: false }],
    jobs: [call()],
    ...rows,
  }

  for (const [entity, list] of Object.entries(all)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`belehrung${String((counter += 1))}`),
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
      'appointments',
      'appointment_people',
      'early_start_requests',
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
        path: '/kunden/$customerId',
        component: () => null,
      }),
      createRoute({ getParentRoute: () => root, path: '/plantafel', component: () => null }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/auftraege/j-1'] }),
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
  calls = []

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({ path, method })

    if (path === '/jobs/j-1/instructions/mail' && method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ ...instructions.mails[0], id: 'm-2', status: 'pending' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: answers.has(path) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the instructions of a service call in the office (#292)', () => {
  it('stand at the call of a consumer, with the mark and what went out and was signed', async () => {
    await mount({
      early_start_requests: [
        {
          id: 'e-1',
          jobId: 'j-1',
          signerName: 'Klaus Lehmann',
          signedAt: '2026-11-03T12:41:00.000Z',
          deviceInfo: null,
          path: 'M10,10L20,20',
          contentFingerprint: 'fnv1a32:00000000:1',
        },
      ],
    })

    expect(await screen.findByRole('heading', { name: 'Belehrungen' })).toBeTruthy()
    expect(screen.getByText(/Klaus Lehmann ist Verbraucher/)).toBeTruthy()
    expect(await screen.findByText('Per E-Mail verschickt')).toBeTruthy()
    expect(screen.getByText('Vorzeitigen Beginn verlangt, an der Tür unterschrieben')).toBeTruthy()
    expect(screen.getAllByText(/kein Widerrufsrecht/).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Ansehen' }).getAttribute('href')).toBe(
      '/jobs/j-1/instructions/pdf',
    )
    expect(screen.getByRole('link', { name: 'PDF' }).getAttribute('href')).toBe(
      '/jobs/j-1/instructions/pdf?request=e-1',
    )
  })

  it('go out by mail from the office', async () => {
    await mount({})

    await userEvent.click(await screen.findByRole('button', { name: 'Per E-Mail senden' }))

    await waitFor(() => {
      expect(
        calls.some((one) => one.path === '/jobs/j-1/instructions/mail' && one.method === 'POST'),
      ).toBe(true)
    })
  })

  it('are not sent by somebody without the right to write jobs', async () => {
    await mount({}, ['technician'])

    expect(await screen.findByRole('heading', { name: 'Belehrungen' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Per E-Mail senden' })).toBeNull()
  })

  it('are no card at a project or at the call of a business', async () => {
    await mount({ jobs: [call({ kind: 'project', urgentRepair: false })] })

    expect(await screen.findByRole('heading', { name: 'Sicherung Küche löst aus' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Belehrungen' })).toBeNull()
  })

  it('are no card for a customer who is a business', async () => {
    await mount({
      customers: [{ id: 'c-1', kind: 'business', name: 'Schreinerei Lutz', isBusiness: true }],
    })

    expect(await screen.findByRole('heading', { name: 'Sicherung Küche löst aus' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Belehrungen' })).toBeNull()
  })
})

describe('the appointments of a job in the office (#292)', () => {
  it('show the next time of each, who goes and whether it is confirmed', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000)

    tomorrow.setUTCHours(12, 30, 0, 0)

    await mount({
      appointments: [
        {
          id: 'a-1',
          jobId: 'j-1',
          startsAt: tomorrow.toISOString(),
          endsAt: new Date(tomorrow.getTime() + 90 * 60_000).toISOString(),
          note: null,
          rrule: null,
          exdates: '[]',
          revision: 1,
        },
      ],
      appointment_people: [
        {
          id: 'p-1',
          appointmentId: 'a-1',
          userId: 'u-2',
          confirmedRevision: 1,
          confirmedAt: new Date().toISOString(),
        },
      ],
    })

    expect(await screen.findByRole('heading', { name: 'Termine' })).toBeTruthy()
    expect(await screen.findByText('Jonas Brandt')).toBeTruthy()
    expect(screen.getByText('Bestätigt')).toBeTruthy()
  })
})
