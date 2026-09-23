import 'fake-indexeddb/auto'

import type { Operation, OperationReceipt, TenantId } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { forgetAccount, rememberAccount, rememberedAccount } from '../session/remembered.js'
import { currentAccount } from '../session/session.js'
import { SyncClient } from '../sync/client.js'
import { text } from '../sync/fields.js'
import { useRecords } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { Boot } from './boot.js'

/**
 * The start of the application without a network (#123).
 *
 * The tests of the offline layer start the sync client directly and go past
 * `Boot`, which is how a site that could not open offline passed all of them:
 * the store only opened after the server had named the business, and without
 * a network it never did. These start where a phone in a basement starts.
 */

const account = {
  userId: 'u-1',
  email: 'monteur@nord.example.de',
  name: 'Max Monteur',
  twoFactorEnabled: false,
}

let counter = 0

/** A business whose jobs are already on this device, from an earlier day with a network. */
async function businessOnTheDevice(): Promise<TenantId> {
  const tenantId = `offline${String((counter += 1))}` as TenantId
  const store = await openLocalStore(tenantId)
  const quiet = {
    push: (_device: string, operations: readonly Operation[]) =>
      Promise.resolve(
        operations.map((operation): OperationReceipt => ({
          operationId: operation.id,
          outcome: 'applied',
          reason: null,
          fields: [],
        })),
      ),
    pull: () =>
      Promise.resolve({
        changes: [
          {
            entity: 'jobs',
            rows: [{ id: 'j-1', designation: 'Zählerschrank im Keller', version: 1 }],
          },
        ],
        cursor: 1,
        hasMore: false,
      }),
    conflicts: () => Promise.resolve([]),
    resolve: () => Promise.resolve(),
    patch: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(undefined),
  }
  const client = await SyncClient.start({
    store,
    transport: quiet,
    writer: quiet,
    deviceId: 'device',
    entities: ['jobs'],
    onSignedOut: () => {},
  })

  await client.synchronise()
  client.stop()

  return tenantId
}

function Jobs() {
  const jobs = useRecords('jobs')
  // A screen asking after the account, with options of its own, as a list of
  // tasks once did: its retry put the question back to "not answered yet",
  // and the gate took the screen away again.
  useQuery({ queryKey: ['account'], queryFn: currentAccount, retry: 1 })

  return (
    <ul>
      {jobs.map((job) => (
        <li key={String(job['id'])}>{text(job, 'designation')}</li>
      ))}
    </ul>
  )
}

function start() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Boot entry="site">
        <Jobs />
      </Boot>
    </QueryClientProvider>,
  )
}

/** A network that is not there: every request fails before any answer. */
function noNetwork() {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
}

beforeEach(() => {
  forgetAccount()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('starting without a network', () => {
  it('opens the business it was last signed in to, with the jobs on the device', async () => {
    const tenantId = await businessOnTheDevice()

    rememberAccount({ ...account, tenantId })
    noNetwork()
    start()

    expect(await screen.findByText('Zählerschrank im Keller')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Anmelden' })).toBeNull()

    // And it stays open, although the screens inside keep asking.
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    expect(screen.getByText('Zählerschrank im Keller')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Einen Moment' })).toBeNull()
  })

  it('says it needs a network once, when nobody was ever signed in on this device', async () => {
    noNetwork()
    start()

    expect(await screen.findByRole('heading', { name: 'Keine Verbindung' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Anmelden' })).toBeNull()
  })
})

describe('starting with a network', () => {
  it('asks for a sign in when the server says nobody is, and forgets what it kept', async () => {
    rememberAccount({ ...account, tenantId: 'somewhere' as TenantId })
    vi.stubGlobal('fetch', (path: string) =>
      Promise.resolve(
        new Response(JSON.stringify(path === '/setup' ? { needed: false } : null), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    start()

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeTruthy()
    await waitFor(() => {
      expect(rememberedAccount()).toBeNull()
    })
  })

  it('keeps who is signed in and where, for the next start without one', async () => {
    const tenantId = await businessOnTheDevice()

    vi.stubGlobal('fetch', (path: string) => {
      const answer = path.endsWith('/get-session')
        ? {
            user: { id: account.userId, email: account.email, name: account.name },
            session: { activeTenantId: tenantId },
          }
        : { changes: [], cursor: 1, hasMore: false }

      return Promise.resolve(
        new Response(JSON.stringify(path.startsWith('/sync/conflicts') ? [] : answer), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
    start()

    expect(await screen.findByText('Zählerschrank im Keller')).toBeTruthy()
    await waitFor(() => {
      expect(rememberedAccount()).toMatchObject({ userId: account.userId, tenantId })
    })
  })
})
