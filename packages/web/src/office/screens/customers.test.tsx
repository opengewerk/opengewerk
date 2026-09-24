import 'fake-indexeddb/auto'

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
import { beforeEach, describe, expect, it } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { CustomerList } from './customers.js'

/**
 * The country of a customer (#144). The form wrote Germany into every
 * customer and had no field for anything else, while the country decides
 * whether the customer gets an e-invoice.
 */

let server: TestServer
let counter = 0

async function mount() {
  const client = await SyncClient.start({
    store: await openLocalStore(`kunden${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['customers'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/kunden', component: CustomerList }),
      createRoute({
        getParentRoute: () => root,
        path: '/kunden/$customerId',
        component: () => null,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/kunden'] }),
  })
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queries}>
      <SyncProvider client={client}>
        <RouterProvider router={router} />
      </SyncProvider>
    </QueryClientProvider>,
  )

  return client
}

beforeEach(() => {
  server = new TestServer()
})

describe('a new customer', () => {
  it('is in Germany unless the office picks another country', async () => {
    await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Kunde anlegen' }))

    expect((screen.getByLabelText('Land') as HTMLSelectElement).value).toBe('DE')

    await user.type(screen.getByLabelText('Name'), 'Familie Gruber')
    await user.selectOptions(screen.getByLabelText('Land'), 'Österreich')
    await user.click(screen.getByRole('button', { name: 'Anlegen' }))

    await waitFor(() => {
      expect(server.all('customers')).toHaveLength(1)
    })
    expect(server.all('customers')[0]).toMatchObject({ name: 'Familie Gruber', country: 'AT' })
  })
})
