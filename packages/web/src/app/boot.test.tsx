import 'fake-indexeddb/auto'

import type { Operation, OperationReceipt, TenantId } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  forgetSignIn,
  rememberAccount,
  rememberedAccount,
  rememberedTenants,
  rememberTenants,
} from '../session/remembered.js'
import { currentAccount } from '../session/session.js'
import { SyncClient } from '../sync/client.js'
import { text } from '../sync/fields.js'
import { useRecords, useSyncStatus } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { Boot } from './boot.js'
import { useMay } from './queries.js'

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
  // And one asking what the roles allow, as the tasks, the photos and the
  // working time on a job do (#184).
  const readsTasks = useMay('task.read')
  // What the strip over every screen would say.
  const { trouble } = useSyncStatus()

  return (
    <>
      <ul>
        {jobs.map((job) => (
          <li key={String(job['id'])}>{text(job, 'designation')}</li>
        ))}
      </ul>
      <p>{readsTasks ? 'Aufgaben sichtbar' : 'Aufgaben verborgen'}</p>
      {trouble ? <p>{trouble}</p> : null}
    </>
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
  forgetSignIn()
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

  it('shows what the roles kept from the last start allow', async () => {
    const tenantId = await businessOnTheDevice()

    rememberAccount({ ...account, tenantId })
    rememberTenants([{ id: tenantId, name: 'Elektro Nord', roles: ['technician'] }])
    noNetwork()
    start()

    expect(await screen.findByText('Zählerschrank im Keller')).toBeTruthy()
    expect(await screen.findByText('Aufgaben sichtbar')).toBeTruthy()
  })

  it('shows nothing that needs a right, when no roles were kept for this business', async () => {
    const tenantId = await businessOnTheDevice()

    rememberAccount({ ...account, tenantId })
    rememberTenants([{ id: 'elsewhere' as TenantId, name: 'Anderswo', roles: ['owner'] }])
    noNetwork()
    start()

    expect(await screen.findByText('Zählerschrank im Keller')).toBeTruthy()
    expect(screen.getByText('Aufgaben verborgen')).toBeTruthy()
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
    rememberTenants([{ id: 'somewhere' as TenantId, name: 'Irgendwo', roles: ['owner'] }])
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
    // The roles went with the person, not only with the business.
    expect(globalThis.localStorage.getItem('opengewerk.tenants')).toBeNull()
  })

  it('keeps who is signed in, where and with which roles, for the next start without one', async () => {
    const tenantId = await businessOnTheDevice()

    vi.stubGlobal('fetch', (path: string) => {
      const answer = path.endsWith('/get-session')
        ? {
            user: { id: account.userId, email: account.email, name: account.name },
            session: { activeTenantId: tenantId },
          }
        : path === '/auth/tenants'
          ? [{ id: tenantId, name: 'Elektro Nord', roles: ['technician'] }]
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
    await waitFor(() => {
      expect(rememberedTenants()).toEqual([
        { id: tenantId, name: 'Elektro Nord', roles: ['technician'] },
      ])
    })
  })
})

describe('refused with a session that is still good (#254)', () => {
  interface Answer {
    readonly status: number
    readonly body: unknown
  }

  /**
   * An instance where the account says the same thing every time, and the
   * routes of the exchange answer with whatever `sync` returns.
   */
  function instance(tenantId: TenantId, sync: (path: string) => Answer) {
    vi.stubGlobal('fetch', (path: string) => {
      const answer: Answer = path.endsWith('/get-session')
        ? {
            status: 200,
            body: {
              user: { id: account.userId, email: account.email, name: account.name },
              session: { activeTenantId: tenantId },
            },
          }
        : path === '/auth/tenants'
          ? { status: 200, body: [{ id: tenantId, name: 'Elektro Nord', roles: ['technician'] }] }
          : sync(path)

      return Promise.resolve(
        new Response(JSON.stringify(answer.body), {
          status: answer.status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
  }

  function accepted(path: string): Answer {
    return path.startsWith('/sync/conflicts')
      ? { status: 200, body: [] }
      : { status: 200, body: { changes: [], cursor: 1, hasMore: false } }
  }

  it('stays open over a 403 and says why, instead of waiting for a sign in', async () => {
    const tenantId = await businessOnTheDevice()

    instance(tenantId, () => ({
      status: 403,
      body: { statusCode: 403, message: 'Kein Zugang zu diesem Betrieb.' },
    }))
    start()

    expect(await screen.findByText('Kein Zugang zu diesem Betrieb.')).toBeTruthy()
    expect(screen.getByText('Zählerschrank im Keller')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Einen Moment' })).toBeNull()
  })

  it('says so when a 401 leaves the account as it was, and starts again when asked', async () => {
    const tenantId = await businessOnTheDevice()
    let refusing = true

    instance(tenantId, (path) =>
      refusing
        ? { status: 401, body: { statusCode: 401, message: 'Keine gültige Anmeldung.' } }
        : accepted(path),
    )
    start()

    // Not "Einen Moment" for ever: the account came back with the business
    // it had, and nothing would have started the device again.
    expect(await screen.findByRole('heading', { name: 'Abgleich unterbrochen' })).toBeTruthy()

    refusing = false
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(await screen.findByText('Zählerschrank im Keller')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Abgleich unterbrochen' })).toBeNull()
  })
})
