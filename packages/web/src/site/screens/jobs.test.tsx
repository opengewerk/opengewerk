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
import { SiteJobList, SiteJobScreen, SiteJobsLayout } from './jobs.js'

/**
 * A job on site, seen by the technician who works on it (#128).
 *
 * The preview always runs as the owner, and that is how the site app could
 * offer every technician two buttons the server refused from the start: finishing
 * the job and writing a note about it. These tests look at the screen with
 * the roles somebody really has.
 */

let server: TestServer
let answers: Map<string, unknown>
let counter = 0

const rows: Readonly<Record<string, RecordState[]>> = {
  customers: [{ id: 'c-1', kind: 'private', name: 'Familie Berg' }],
  jobs: [
    {
      id: 'j-1',
      customerId: 'c-1',
      siteId: null,
      installationId: null,
      parentJobId: null,
      kind: 'service',
      status: 'active',
      designation: 'Steckdose ohne Strom',
      description: null,
    },
  ],
}

function signedInAs(...roles: RoleKey[]) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'max@nord.example.de', name: 'Max Monteur' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

async function mount(
  more: readonly RecordState[] = [],
  { path = '/auftraege/j-1', layout = false }: { path?: string; layout?: boolean } = {},
) {
  for (const [entity, list] of Object.entries(rows)) {
    for (const row of list) {
      server.put(entity, row)
    }
  }

  // Jobs beyond the one on the screen, or that one with more to it.
  for (const row of more) {
    server.put('jobs', { ...rows['jobs']?.[0], ...row })
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`auftrag${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'telefon-max',
    entities: [
      'customers',
      'sites',
      'installations',
      'jobs',
      'documents',
      'document_signatures',
      'tasks',
      'time_entries',
    ],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  // With `layout` the routes as the site has them, the list and a job under
  // the layout that sets them side by side on a tablet.
  const jobs = createRoute({ getParentRoute: () => root, id: 'jobs', component: SiteJobsLayout })
  const router = createRouter({
    routeTree: layout
      ? root.addChildren([
          jobs.addChildren([
            createRoute({ getParentRoute: () => jobs, path: '/', component: SiteJobList }),
            createRoute({
              getParentRoute: () => jobs,
              path: '/auftraege/$jobId',
              component: SiteJobScreen,
            }),
          ]),
        ])
      : root.addChildren([
          createRoute({
            getParentRoute: () => root,
            path: '/auftraege/$jobId',
            component: SiteJobScreen,
          }),
        ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queries}>
      <SyncProvider client={client}>
        <RouterProvider router={router} />
      </SyncProvider>
    </QueryClientProvider>,
  )

  if (path === '/auftraege/j-1') {
    await screen.findByRole('heading', { name: 'Steckdose ohne Strom' })
  }

  return { client, queries }
}

/** The window as wide as a tablet held across, 1180 pixels, or as a phone. */
function wide(tablet: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: tablet && (query === '(min-width: 64rem)' || query === '(min-width: 37.5rem)'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

beforeEach(() => {
  server = new TestServer()
  answers = new Map()
  answers.set('/tasks/assignees', [])

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

describe('the reports of a job on site', () => {
  it('show one signed on the device as signed, while the server still says draft (#223)', async () => {
    signedInAs('technician')
    server.put('documents', {
      id: 'd-1',
      kind: 'time_and_material_report',
      status: 'draft',
      jobId: 'j-1',
      customerId: 'c-1',
      documentDate: '2026-09-24',
      number: null,
    })
    server.put('document_signatures', { id: 's-1', documentId: 'd-1', signerName: 'Frau Berg' })
    await mount()

    const card = await screen.findByRole('region', { name: 'Regieberichte' })

    expect(await within(card).findByText('Unterschrieben')).toBeTruthy()
    expect(within(card).queryByText('Entwurf')).toBeNull()
  })
})

describe('a job on site, for a technician', () => {
  it('can be finished, and only its status goes out', async () => {
    signedInAs('technician')
    await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Auftrag abschließen' }))

    // It asks first, and nothing has gone out while it asks (#222).
    const asked = screen.getByRole('alertdialog', { name: 'Auftrag abschließen?' })
    expect(server.operations()).toEqual([])
    await user.click(within(asked).getByRole('button', { name: 'Abschließen' }))

    await waitFor(() => {
      expect(server.row('jobs', 'j-1')?.['status']).toBe('completed')
    })
    expect(
      server.operations().map(({ entity, kind, patches }) => ({ entity, kind, patches })),
    ).toEqual([
      {
        entity: 'jobs',
        kind: 'update',
        patches: [{ field: 'status', from: 'active', to: 'completed' }],
      },
    ])
    expect(await screen.findByText('Dieser Auftrag ist abgeschlossen.')).toBeTruthy()
  })

  it('takes a note about what happened, and nothing else about the job', async () => {
    signedInAs('technician')
    await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Notiz schreiben' }))
    await user.type(await screen.findByLabelText('Was passiert ist'), 'Sicherung getauscht.')
    await user.click(screen.getByRole('button', { name: 'Notiz sichern' }))

    await waitFor(() => {
      expect(server.row('jobs', 'j-1')?.['description']).toBe('Sicherung getauscht.')
    })
    expect(
      server.operations().flatMap((operation) => operation.patches.map((patch) => patch.field)),
    ).toEqual(['description'])
  })
})

describe('a job on site, for somebody who may not report on it', () => {
  it('offers neither finishing nor a note', async () => {
    signedInAs()
    const { queries } = await mount()

    // Both answers have to be in first, or the buttons are missing only
    // because nobody knows the roles yet, and the test would pass on any
    // screen.
    await waitFor(() => {
      expect(queries.getQueryState(['account'])?.status).toBe('success')
      expect(queries.getQueryState(['tenants'])?.status).toBe('success')
    })
    expect(screen.queryByRole('button', { name: 'Auftrag abschließen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Notiz schreiben' })).toBeNull()
  })
})

describe('a job on site, between the jobs before and after it (#170)', () => {
  it('names the job it follows and the ones that follow it, each a way there', async () => {
    signedInAs('technician')
    await mount([
      { id: 'j-1', predecessorJobId: 'j-0' },
      { id: 'j-0', designation: 'Zählerschrank erneuern', status: 'completed' },
      { id: 'j-2', designation: 'Wallbox prüfen', status: 'draft', predecessorJobId: 'j-1' },
    ])

    const card = await screen.findByRole('region', { name: 'Vorher und danach' })

    expect(card.textContent).toContain('Folgt auf')
    expect(screen.getByRole('link', { name: 'Zählerschrank erneuern' }).getAttribute('href')).toBe(
      '/auftraege/j-0',
    )
    expect(screen.getByRole('link', { name: 'Wallbox prüfen' }).getAttribute('href')).toBe(
      '/auftraege/j-2',
    )
  })

  it('says nothing about it for a job on its own', async () => {
    signedInAs('technician')
    await mount()

    expect(screen.queryByRole('region', { name: 'Vorher und danach' })).toBeNull()
  })
})

describe('the list and a job on a tablet held across (#219)', () => {
  const other = { id: 'j-2', designation: 'Wallbox in der Garage', status: 'draft' }

  it('stand side by side, the job chosen ringed in the list and without a header of its own', async () => {
    wide(true)
    signedInAs('technician')
    await mount([other], { layout: true })
    const user = userEvent.setup()

    const list = screen.getByRole('list', { name: 'Offene Aufträge' })
    const chosen = within(list).getByRole('link', { name: /Steckdose ohne Strom/ })

    expect(chosen.getAttribute('aria-current')).toBe('page')
    expect(
      within(list)
        .getByRole('link', { name: /Wallbox in der Garage/ })
        .getAttribute('aria-current'),
    ).toBeNull()
    // The list is beside it, so there is no way back to it above the job.
    expect(screen.queryByRole('link', { name: 'Zurück zu den Aufträgen' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Steckdose ohne Strom' })).toBeTruthy()

    // Another job opens beside the same list.
    await user.click(within(list).getByRole('link', { name: /Wallbox in der Garage/ }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Wallbox in der Garage' }),
    ).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Offene Aufträge' })).toBe(list)
  })

  it('say what goes beside the list before a job is chosen', async () => {
    wide(true)
    signedInAs('technician')
    await mount([other], { layout: true, path: '/' })

    expect(await screen.findByRole('list', { name: 'Offene Aufträge' })).toBeTruthy()
    expect(screen.getByText('Einen Auftrag in der Liste wählen, er steht dann hier.')).toBeTruthy()
  })

  it('are one screen each on a phone, the job with the way back', async () => {
    wide(false)
    signedInAs('technician')
    await mount([other], { layout: true })

    expect(screen.queryByRole('list', { name: 'Offene Aufträge' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Zurück zu den Aufträgen' })).toBeTruthy()
  })
})
