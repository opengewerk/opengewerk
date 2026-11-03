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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { SiteInstructionsScreen } from './call-instructions.js'
import { SiteInvoiceScreen } from './invoice.js'
import { SiteJobScreen } from './job.js'
import { SiteReportScreen } from './report.js'

/**
 * A service call on site (#292): the job sheet with the request and the mark
 * of an urgent repair, the instructions at the door and the request for an
 * early start signed there, and the draft of the invoice made out of a
 * signed report.
 */

let server: TestServer
let answers: Map<string, unknown>
let calls: { path: string; method: string; body: unknown }[]
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
    description: 'Seit heute Morgen löst die Sicherung der Küche aus.',
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
  sheets: [
    {
      template: 'withdrawal',
      title: 'Widerrufsbelehrung',
      text: '# Widerrufsrecht\n\nSie haben das Recht, binnen vierzehn Tagen zu widerrufen.',
    },
    {
      template: 'withdrawal_form',
      title: 'Muster-Widerrufsformular',
      text: 'An Elektro Nord GmbH',
    },
    {
      template: 'early_start',
      title: 'Verlangen auf vorzeitigen Leistungsbeginn',
      text: 'Auf Papier.',
    },
  ],
  request: 'Ich verlange ausdrücklich, dass Elektro Nord GmbH beginnt.',
  gaps: [],
  fingerprint: 'fnv1a32:0badcafe:120',
  signed: [],
  mails: [],
}

/** Draws on the pad the way a finger does, as the tests of the report do. */
function signOn(pad: Element) {
  Object.assign(pad, {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 500,
      height: 200,
      right: 500,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    setPointerCapture: () => {},
  })
  fireEvent.pointerDown(pad, { pointerId: 1, clientX: 50, clientY: 150 })
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: 120, clientY: 60 })
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: 200, clientY: 140 })
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: 200, clientY: 140 })
}

async function mount(
  path: string,
  rows: Readonly<Record<string, RecordState[]>> = {},
  roles: RoleKey[] = ['technician'],
) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'jonas@nord.example.de', name: 'Jonas Brandt' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [aTenantChoice(roles)])
  if (!answers.has('/jobs/j-1/instructions')) {
    answers.set('/jobs/j-1/instructions', instructions)
  }

  const all: Readonly<Record<string, RecordState[]>> = {
    customers: [
      { id: 'c-1', kind: 'private', name: 'Klaus Lehmann', isBusiness: false, phone: '040 778' },
    ],
    jobs: [call()],
    ...rows,
  }

  for (const [entity, list] of Object.entries(all)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`door${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'telefon-jonas',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
      'documents',
      'document_lines',
      'document_signatures',
      'tasks',
      'job_notes',
      'form_records',
      'attachments',
      'defects',
      'defect_steps',
      'early_start_requests',
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
        path: '/auftraege/$jobId/belehrung',
        component: SiteInstructionsScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId/berichte/$documentId',
        component: SiteReportScreen,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/auftraege/$jobId/rechnungen/$documentId',
        component: SiteInvoiceScreen,
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
  calls = []
  answers.set('/tasks/assignees', [{ userId: 'u-1', name: 'Jonas Brandt', active: true }])

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null })

    if (path === '/documents/r-1/successors' && method === 'POST') {
      server.put('documents', {
        id: 'inv-1',
        customerId: 'c-1',
        jobId: 'j-1',
        kind: 'final_invoice',
        status: 'draft',
        number: null,
        documentDate: '2026-11-03',
        predecessorDocumentId: 'r-1',
        taxTreatment: 'standard',
        serviceFrom: '2026-11-03',
      })
      server.put('document_lines', {
        id: 'il-1',
        documentId: 'inv-1',
        kind: 'item',
        position: 1,
        designation: 'Leitungsschutzschalter B16',
        quantityMilli: 1000,
        unit: 'piece',
        unitPriceCents: 740,
        netCents: 740,
        vatRate: 'standard',
      })

      return Promise.resolve(
        new Response(JSON.stringify({ id: 'inv-1' }), {
          status: 201,
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

describe('the job sheet of a service call (#292)', () => {
  it('has the request first, the mark of an urgent repair and the instructions', async () => {
    await mount('/auftraege/j-1')

    expect(await screen.findByRole('heading', { name: 'Anliegen' })).toBeTruthy()
    expect(screen.getAllByText(/kein Widerrufsrecht/).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Belehrungen' })).toBeTruthy()
    expect(screen.getByText('Noch nicht an der Tür unterschrieben.')).toBeTruthy()
    expect(
      (await screen.findByRole('link', { name: 'Belehrung zeigen' })).getAttribute('href'),
    ).toBe('/auftraege/j-1/belehrung')
  })

  it('has no instructions at a project, and "Was zu tun ist" there', async () => {
    await mount('/auftraege/j-1', { jobs: [call({ kind: 'project', urgentRepair: false })] })

    expect(await screen.findByRole('heading', { name: 'Was zu tun ist' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Belehrungen' })).toBeNull()
  })
})

describe('the instructions at the door (#292)', () => {
  it('show the sheets and take the request signed under them, with what it was signed under', async () => {
    const { client, router } = await mount('/auftraege/j-1/belehrung')

    expect(await screen.findByText('Widerrufsbelehrung')).toBeTruthy()
    expect(screen.getByText('Muster-Widerrufsformular')).toBeTruthy()
    expect(
      screen.getByText('Ich verlange ausdrücklich, dass Elektro Nord GmbH beginnt.'),
    ).toBeTruthy()
    // The sheet for paper is not shown: the request stands in its place.
    expect(screen.queryByText('Auf Papier.')).toBeNull()

    await userEvent.type(screen.getByLabelText('Name'), 'Klaus Lehmann')
    signOn(screen.getByLabelText('Unterschriftsfeld'))
    await userEvent.click(screen.getByRole('button', { name: 'Unterschreiben' }))

    await waitFor(() => {
      expect(client.list('early_start_requests')).toHaveLength(1)
    })

    expect(client.list('early_start_requests')[0]).toMatchObject({
      jobId: 'j-1',
      signerName: 'Klaus Lehmann',
      contentFingerprint: 'fnv1a32:0badcafe:120',
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/auftraege/j-1')
    })
  })

  it('take no request without a name and a signature', async () => {
    const { client } = await mount('/auftraege/j-1/belehrung')

    await userEvent.click(await screen.findByRole('button', { name: 'Unterschreiben' }))

    expect(client.list('early_start_requests')).toEqual([])
  })

  it('say what the letterhead lacks instead of showing the sheets', async () => {
    answers.set('/jobs/j-1/instructions', {
      ...instructions,
      gaps: ['Für die Belehrung „Widerrufsbelehrung“ fehlt im Briefkopf die Telefonnummer.'],
    })
    await mount('/auftraege/j-1/belehrung')

    expect(await screen.findByText(/fehlt im Briefkopf die Telefonnummer/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unterschreiben' })).toBeNull()
  })
})

describe('the invoice made on site (#292)', () => {
  const report: RecordState = {
    id: 'r-1',
    customerId: 'c-1',
    jobId: 'j-1',
    kind: 'time_and_material_report',
    status: 'signed',
    number: null,
    documentDate: '2026-11-03',
    predecessorDocumentId: null,
    introText: 'Herdanschlussdose getauscht.',
  }
  const signature: RecordState = {
    id: 'sig-1',
    documentId: 'r-1',
    signerName: 'Klaus Lehmann',
    signedAt: '2026-11-03T13:52:00.000Z',
    deviceInfo: null,
    path: 'M10,10L20,20',
    contentFingerprint: 'x',
  }

  it('is made as a draft out of the signed report and shown with its prices', async () => {
    const { router } = await mount('/auftraege/j-1/berichte/r-1', {
      documents: [report],
      document_signatures: [signature],
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Rechnung anlegen' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/auftraege/j-1/rechnungen/inv-1')
    })

    const made = calls.find((one) => one.path === '/documents/r-1/successors')

    expect(made?.body).toEqual({ kind: 'final_invoice' })
    expect(await screen.findByText('Leitungsschutzschalter B16')).toBeTruthy()
    expect(screen.getByText(/Das Büro prüft ihn, schreibt die Rechnung fest/)).toBeTruthy()
  })

  it('is not offered under a report nobody signed', async () => {
    await mount('/auftraege/j-1/berichte/r-1', {
      documents: [{ ...report, status: 'draft' }],
    })

    expect(await screen.findByRole('heading', { name: 'Regiebericht' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rechnung anlegen' })).toBeNull()
  })
})
