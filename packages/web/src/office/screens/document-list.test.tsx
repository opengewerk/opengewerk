import 'fake-indexeddb/auto'

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
import { DocumentList } from './document-list.js'

/**
 * The list of all documents, which the office did not have until #219: a
 * document was only found through its job or its customer.
 */

let server: TestServer
let counter = 0

async function mount() {
  const client = await SyncClient.start({
    store: await openLocalStore(`belege${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['customers', 'documents', 'document_lines'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/belege', component: DocumentList }),
      createRoute({
        getParentRoute: () => root,
        path: '/belege/$documentId',
        component: () => null,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/belege'] }),
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
  server.put('customers', { id: 'c-1', name: 'Familie Berg', kind: 'private', version: 1 })
  server.put('documents', {
    id: 'd-1',
    customerId: 'c-1',
    kind: 'final_invoice',
    status: 'issued',
    number: 'RE-2026-0231',
    documentDate: '2026-09-19',
    subject: 'Zählerschrank erneuern',
    version: 1,
  })
  server.put('documents', {
    id: 'd-2',
    customerId: 'c-1',
    kind: 'quote',
    status: 'draft',
    number: null,
    documentDate: '2026-09-20',
    subject: 'Wallbox in der Garage',
    version: 1,
  })

  // The office, which reads payments, and one invoice with something open.
  const answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Britta Büro' },
        session: { activeTenantId: 't-1' },
      },
    ],
    ['/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles: ['office'] }]],
    ['/payments/open', [{ documentId: 'd-1', billedCents: 41_876, receivedCents: 20_000 }]],
  ])

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

describe('the list of documents', () => {
  it('lists every document with its number, a draft as one without', async () => {
    await mount()

    const table = await screen.findByRole('table', { name: 'Alle Belege des Betriebs' })
    const invoice = within(table).getByRole('link', { name: 'RE-2026-0231' }).closest('tr')
    const quote = within(table).getByRole('link', { name: 'ohne Nummer' }).closest('tr')

    expect(invoice?.textContent).toContain('Rechnung')
    expect(invoice?.textContent).toContain('Festgeschrieben')
    expect(quote?.textContent).toContain('Angebot')
    expect(quote?.textContent).toContain('Entwurf')
  })

  it('narrows to the drafts, and to the invoices with something still open', async () => {
    await mount()
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Alle Belege des Betriebs' })

    await user.click(screen.getByRole('button', { name: 'Entwürfe' }))
    expect(within(table).queryByRole('link', { name: 'RE-2026-0231' })).toBeNull()

    // "Offen" comes with the answer of the server, what came in not being on
    // the device.
    await user.click(await screen.findByRole('button', { name: 'Offen' }))
    await waitFor(() => {
      expect(within(table).getByRole('link', { name: 'RE-2026-0231' })).toBeDefined()
    })
    expect(within(table).queryByRole('link', { name: 'ohne Nummer' })).toBeNull()
  })
})
