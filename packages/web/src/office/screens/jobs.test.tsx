import 'fake-indexeddb/auto'

import type { RecordState, RoleKey } from '@opengewerk/domain'
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

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { JobList, JobScreen } from './jobs.js'

/**
 * Follow-up jobs in the office (#170): made from a finished job, for the same
 * customer, with what can be taken over taken over, and linked both ways.
 */

let server: TestServer
let answers: Map<string, unknown>
let calls: { method: string; path: string; body: unknown }[]
let counter = 0

function job(id: string, over: Partial<RecordState> = {}): RecordState {
  return {
    id,
    customerId: 'c-1',
    siteId: 's-1',
    installationId: 'i-1',
    parentJobId: null,
    predecessorJobId: null,
    kind: 'project',
    status: 'completed',
    number: `AU-2026-000${id.slice(2)}`,
    designation: 'Zählerschrank erneuern',
    description: null,
    ...over,
  }
}

const base: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Berg' }],
  sites: [
    { id: 's-1', customerId: 'c-1', designation: 'Einfamilienhaus Lindenweg' },
    { id: 's-2', customerId: 'c-1', designation: 'Garage Lindenweg' },
  ],
  installations: [
    { id: 'i-1', siteId: 's-1', kind: 'meter_cabinet', designation: 'Zählerschrank' },
    { id: 'i-2', siteId: 's-2', kind: 'wallbox', designation: 'Wallbox Garage' },
  ],
}

function signedInAs(...roles: RoleKey[]) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Britta Büro' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

async function mount(
  jobs: RecordState[],
  at = '/auftraege/j-1',
  more: Readonly<Record<string, RecordState[]>> = {},
) {
  for (const [entity, list] of Object.entries({ ...base, jobs, ...more })) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`folgeauftrag${String((counter += 1))}`),
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
    ],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/auftraege/$jobId', component: JobScreen }),
      createRoute({ getParentRoute: () => root, path: '/auftraege', component: JobList }),
      createRoute({
        getParentRoute: () => root,
        path: '/belege/$documentId',
        component: () => null,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/$customerId',
        component: () => null,
      }),
      createRoute({ getParentRoute: () => root, path: '/objekte/$siteId', component: () => null }),
      createRoute({
        getParentRoute: () => root,
        path: '/anlagen/$installationId',
        component: () => null,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
  })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queries}>
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
  answers.set('/tasks/assignees', [])

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      path,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
    })

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

describe('the notes from the site (#220)', () => {
  it('stand at the job, the newest first, with who wrote them when, and nothing to write', async () => {
    signedInAs('office')
    answers.set('/tasks/assignees', [
      { userId: 'u-7', name: 'Anna Weber', active: true },
      { userId: 'u-8', name: 'Jonas Brandt', active: true },
    ])
    await mount([job('j-1', { status: 'active' })], '/auftraege/j-1', {
      job_notes: [
        {
          id: 'n-1',
          jobId: 'j-1',
          text: 'Zugang über den Hof.',
          writtenAt: '2026-09-18T06:15:00.000Z',
          createdBy: 'u-8',
        },
        {
          id: 'n-2',
          jobId: 'j-1',
          text: 'Bewegungsmelder EG getauscht.',
          writtenAt: '2026-09-18T08:42:00.000Z',
          createdBy: 'u-7',
        },
      ],
    })

    const card = await screen.findByRole('region', { name: 'Notizen von der Baustelle' })

    // The names come a moment after the notes, with the list of the business.
    await within(card).findByText(/^Anna Weber/)

    const entries = within(card).getAllByRole('listitem')

    expect(entries.map((entry) => entry.textContent)).toEqual([
      'Bewegungsmelder EG getauscht.Anna Weber, 18.09.2026, 10:42',
      'Zugang über den Hof.Jonas Brandt, 18.09.2026, 08:15',
    ])
    // The description stays the office's, and a note is written on site.
    expect(within(card).queryByRole('button')).toBeNull()
  })
})

describe('a follow-up job', () => {
  it('is offered on a finished job, to whoever decides what a job is', async () => {
    signedInAs('office')
    await mount([job('j-1')])

    expect(await screen.findByRole('button', { name: 'Folgeauftrag anlegen' })).toBeDefined()
  })

  it('is not offered on a job that is still running', async () => {
    signedInAs('office')
    await mount([job('j-1', { status: 'active' })])

    // Until the rights have come, no button shows at all. The tasks show once
    // they have, so they are what to wait for.
    await screen.findByRole('region', { name: 'Aufgaben' })

    expect(screen.queryByRole('button', { name: 'Folgeauftrag anlegen' })).toBeNull()
  })

  it('is not offered to a technician, who makes no jobs', async () => {
    signedInAs('technician')
    await mount([job('j-1')])

    await screen.findByRole('region', { name: 'Aufgaben' })

    expect(screen.queryByRole('button', { name: 'Folgeauftrag anlegen' })).toBeNull()
  })

  it('is for the same customer, with kind, site and installation taken over', async () => {
    signedInAs('office')
    await mount([job('j-1')])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Folgeauftrag anlegen' }))

    const form = within(screen.getByRole('region', { name: 'Folgeauftrag' }))

    expect((form.getByLabelText('Art') as HTMLSelectElement).value).toBe('project')
    expect((form.getByLabelText('Objekt') as HTMLSelectElement).value).toBe('s-1')
    expect((form.getByLabelText('Anlage') as HTMLSelectElement).value).toBe('i-1')
    expect(form.queryByLabelText('Kunde')).toBeNull()

    await user.type(form.getByLabelText('Bezeichnung'), 'Wallbox setzen')
    await user.click(form.getByRole('button', { name: 'Folgeauftrag anlegen' }))

    await waitFor(() => {
      expect(server.all('jobs')).toHaveLength(2)
    })

    const made = server.all('jobs').find((row) => row['id'] !== 'j-1')

    expect(made).toMatchObject({
      designation: 'Wallbox setzen',
      customerId: 'c-1',
      siteId: 's-1',
      installationId: 'i-1',
      kind: 'project',
      status: 'draft',
      predecessorJobId: 'j-1',
    })
    // A new record carries no empty fields in its operation, so no sub job
    // either: a follow-up is a job of its own and not a part of the one before.
    expect(made?.['parentJobId'] ?? null).toBeNull()

    // The new job names the one before it, with a way back.
    expect(await screen.findByRole('heading', { level: 1, name: 'Wallbox setzen' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Zählerschrank erneuern' }).getAttribute('href')).toBe(
      '/auftraege/j-1',
    )
  })

  it('may go to another site of the customer, and leaves the installation of the first behind', async () => {
    signedInAs('office')
    await mount([job('j-1')])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Folgeauftrag anlegen' }))

    const form = within(screen.getByRole('region', { name: 'Folgeauftrag' }))

    await user.selectOptions(form.getByLabelText('Objekt'), 'Garage Lindenweg')

    expect((form.getByLabelText('Anlage') as HTMLSelectElement).value).toBe('')

    await user.selectOptions(form.getByLabelText('Anlage'), 'Wallbox Garage')
    await user.type(form.getByLabelText('Bezeichnung'), 'Wallbox prüfen')
    await user.click(form.getByRole('button', { name: 'Folgeauftrag anlegen' }))

    await waitFor(() => {
      expect(server.all('jobs')).toHaveLength(2)
    })
    expect(server.all('jobs').find((row) => row['id'] !== 'j-1')).toMatchObject({
      siteId: 's-2',
      installationId: 'i-2',
    })
  })

  it('needs a designation, like any job', async () => {
    signedInAs('office')
    await mount([job('j-1')])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Folgeauftrag anlegen' }))

    const form = within(screen.getByRole('region', { name: 'Folgeauftrag' }))

    await user.click(form.getByRole('button', { name: 'Folgeauftrag anlegen' }))

    expect(form.getByText('Ein Auftrag braucht eine Bezeichnung.')).toBeDefined()
    expect(server.all('jobs')).toHaveLength(1)
  })

  it('is listed on the job before it', async () => {
    signedInAs('office')
    await mount([
      job('j-1'),
      job('j-2', { designation: 'Wallbox setzen', status: 'draft', predecessorJobId: 'j-1' }),
    ])

    const followers = within(await screen.findByRole('region', { name: 'Folgeaufträge' }))

    expect(followers.getByRole('link', { name: 'Wallbox setzen' }).getAttribute('href')).toBe(
      '/auftraege/j-2',
    )
  })
})

describe('who is on a job (#140)', () => {
  const staff = [
    { userId: 'u-max', name: 'Max Monteur', active: true },
    { userId: 'u-toni', name: 'Toni Techniker', active: true },
    { userId: 'u-gerd', name: 'Gerd Gesperrt', active: false },
  ]

  function assignment(id: string, userId: string): RecordState {
    return { id, jobId: 'j-1', userId }
  }

  it('is listed by name, and a job nobody is on says what that means', async () => {
    signedInAs('office')
    answers.set('/tasks/assignees', staff)
    await mount([job('j-1', { status: 'active' })], '/auftraege/j-1', {
      job_assignments: [assignment('a-1', 'u-toni')],
    })

    const people = within(await screen.findByRole('region', { name: 'Monteure' }))

    expect(await people.findByText('Toni Techniker')).toBeDefined()

    await mount([job('j-2', { status: 'active' })], '/auftraege/j-2')

    expect(
      await screen.findByText(/Ein Monteur hat auf seinem Gerät nur die Aufträge/),
    ).toBeDefined()
  })

  it('is chosen in the office from the people of the business, as a whole list', async () => {
    signedInAs('office')
    answers.set('/tasks/assignees', staff)
    answers.set('/jobs/j-1/assignees', { userIds: ['u-max'] })
    await mount([job('j-1', { status: 'active' })], '/auftraege/j-1', {
      job_assignments: [assignment('a-1', 'u-toni')],
    })
    const user = userEvent.setup()
    const people = within(await screen.findByRole('region', { name: 'Monteure' }))

    await user.click(await people.findByRole('button', { name: 'Zuordnen' }))

    // Whoever is shut out is not offered.
    expect(people.queryByLabelText('Gerd Gesperrt')).toBeNull()
    expect((people.getByLabelText('Toni Techniker') as HTMLInputElement).checked).toBe(true)

    await user.click(people.getByLabelText('Toni Techniker'))
    await user.click(people.getByLabelText('Max Monteur'))
    await user.click(people.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')).toMatchObject({
        path: '/jobs/j-1/assignees',
        body: { userIds: ['u-max'] },
      })
    })
  })

  it('is not changed by a technician', async () => {
    signedInAs('technician')
    answers.set('/tasks/assignees', staff)
    await mount([job('j-1', { status: 'active' })])

    await screen.findByRole('region', { name: 'Aufgaben' })

    expect(screen.queryByRole('button', { name: 'Zuordnen' })).toBeNull()
  })
})

describe('the jobs as the boards draw them (#219)', () => {
  const documents: RecordState[] = [
    {
      id: 'd-1',
      customerId: 'c-1',
      jobId: 'j-1',
      kind: 'quote',
      status: 'issued',
      number: 'A-2026-0091',
      documentDate: '2026-09-15',
      subject: 'Störung Treppenhauslicht',
    },
    {
      id: 'd-2',
      customerId: 'c-1',
      jobId: 'j-1',
      kind: 'time_and_material_report',
      status: 'signed',
      number: null,
      documentDate: '2026-09-18',
      subject: 'Arbeiten am 18.09.',
    },
    {
      id: 'd-3',
      customerId: 'c-1',
      jobId: 'j-1',
      kind: 'final_invoice',
      status: 'draft',
      number: null,
      documentDate: '2026-09-19',
      subject: 'Störung Treppenhauslicht',
    },
  ]

  it('lists every job with its number, state, customer and the people on it', async () => {
    signedInAs('office')
    answers.set('/tasks/assignees', [{ userId: 'u-toni', name: 'Toni Techniker', active: true }])
    await mount(
      [
        job('j-1', { status: 'active', designation: 'Störung Treppenhauslicht' }),
        job('j-2', { status: 'completed' }),
      ],
      '/auftraege',
      { job_assignments: [{ id: 'a-1', jobId: 'j-1', userId: 'u-toni' }] },
    )
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Alle Aufträge des Betriebs' })
    await waitFor(() => {
      expect(within(table).getByText('Toni Techniker')).toBeDefined()
    })
    const row = within(table).getByRole('link', { name: 'AU-2026-0001' }).closest('tr')

    expect(row?.textContent).toContain('Störung Treppenhauslicht')
    expect(row?.textContent).toContain('Laufend')
    expect(row?.textContent).toContain('Familie Berg')

    await user.click(screen.getByRole('button', { name: 'Laufend' }))

    expect(within(table).queryByRole('link', { name: 'AU-2026-0002' })).toBeNull()
  })

  it('shows its chain of documents across the top and the documents in a table', async () => {
    signedInAs('office')
    await mount([job('j-1', { status: 'active' })], '/auftraege/j-1', { documents })

    const chain = await screen.findByRole('region', { name: 'Belegkette' })
    const boxes = within(chain)
      .getAllByRole('listitem')
      .map((box) => box.textContent)

    // Oldest first, each in a word and a line: the quote with its number and
    // what it comes to, here nothing without lines, the signed report still
    // without its number, the draft invoice without any.
    expect(boxes).toEqual([
      // The amount as money is written, with a no-break space before the sign.
      `AngebotA-2026-0091 · 0,00${String.fromCharCode(0xa0)}€`,
      'Regiebericht' + 'noch ohne Nummer · unterschrieben',
      'Rechnung' + 'Entwurf, keine Nummer',
    ])

    const table = screen.getByRole('table', { name: 'Belege des Auftrags' })
    const invoice = within(table).getByRole('link', { name: 'Rechnung' }).closest('tr')

    expect(invoice?.textContent).toContain('Entwurf')
    expect(invoice?.textContent).toContain('19.09.2026')
  })

  it('stands behind tabs on a phone, the overview first', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    signedInAs('office')
    await mount([job('j-1', { status: 'active' })], '/auftraege/j-1', { documents })
    const user = userEvent.setup()

    const tabs = await screen.findByRole('tablist', { name: 'Bereiche des Auftrags' })
    expect(within(tabs).getByRole('tab', { name: 'Übersicht' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByRole('region', { name: 'Auftrag' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Belege' })).toBeNull()

    await user.click(within(tabs).getByRole('tab', { name: 'Belege' }))

    // The documents as boxes, a phone's table.
    const panel = screen.getByRole('region', { name: 'Belege' })
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('region', { name: 'Auftrag' })).toBeNull()
  })
})
