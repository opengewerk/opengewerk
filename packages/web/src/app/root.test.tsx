import 'fake-indexeddb/auto'

import type { Operation, OperationReceipt, TenantId } from '@opengewerk/domain'
import {
  forgetSignIn,
  rememberAccount,
  rememberedTenants,
  useWho,
} from '@opengewerk/platform-web/session'
import { openLocalStore, text, useRecords } from '@opengewerk/platform-web/sync'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenantChoice } from '../session/test-tenants.js'
import { SyncClient } from '../sync/client.js'
import { useMay } from './queries.js'
import { Root } from './root.js'

/**
 * The top of both entries: this application over the gate of the foundation
 * (ADR 0010).
 *
 * The gate itself is tested in the foundation, with an application that
 * belongs to nobody. What is held here is what only this application brings
 * to it: the records its sync client carries and the way to the server each
 * entry takes, the words it has for a business, and a list an earlier version
 * of it left on a device.
 */

const account = {
  userId: 'u-1',
  email: 'monteur@nord.example.de',
  name: 'Max Monteur',
  twoFactorEnabled: false,
  signInMethod: 'password' as const,
}

let counter = 0

/** A business whose jobs are already on this device, from an earlier day with a network. */
async function businessOnTheDevice(): Promise<TenantId> {
  const tenantId = `root${String((counter += 1))}` as TenantId
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
  // What the roles allow, as the tasks, the photos and the working time on a
  // job ask (#184).
  const readsTasks = useMay('task.read')
  // The business by name, once the list of memberships has arrived. Until
  // then nobody may do anything.
  const { tenant: business } = useWho()

  return (
    <>
      <ul>
        {jobs.map((job) => (
          <li key={String(job['id'])}>{text(job, 'designation')}</li>
        ))}
      </ul>
      <p>{readsTasks ? 'Aufgaben sichtbar' : 'Aufgaben verborgen'}</p>
      {business ? <p>Arbeitet bei {business}</p> : null}
    </>
  )
}

function start(entry: 'office' | 'site' = 'site') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Root entry={entry}>
        <Jobs />
      </Root>
    </QueryClientProvider>,
  )
}

/** A network that is not there: every request fails before any answer. */
function noNetwork() {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
}

/** What `/api/auth/get-session` answers for somebody signed in, in a business or in none yet. */
function session(tenantId: string | null) {
  return {
    user: { id: account.userId, email: account.email, name: account.name },
    session: { activeTenantId: tenantId, signInMethod: 'passkey' },
  }
}

beforeEach(() => {
  forgetSignIn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('starting this application without a network', () => {
  it('opens the business it was last signed in to, with the jobs on the device', async () => {
    const tenantId = await businessOnTheDevice()

    rememberAccount({ ...account, tenantId })
    noNetwork()
    start()

    expect(await screen.findByText('Zählerschrank im Keller')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Anmelden' })).toBeNull()
  })

  /**
   * A device that takes this version over without a network still has the
   * list the version before kept: the keys of the roles and nothing they add
   * up to. Read strictly, as the foundation reads it, it would show no task
   * and no photo until the server answers, which is what the list is kept
   * against (#184). So it is rewritten once at the start, the way it was
   * written: through the three roles a business starts with.
   */
  it('reads a list the version before kept through the three roles', async () => {
    const tenantId = await businessOnTheDevice()

    rememberAccount({ ...account, tenantId })
    globalThis.localStorage.setItem(
      'opengewerk.tenants',
      JSON.stringify([{ id: tenantId, name: 'Elektro Nord', roles: ['technician'] }]),
    )
    noNetwork()
    start()

    expect(await screen.findByText('Zählerschrank im Keller')).toBeTruthy()
    expect(await screen.findByText('Aufgaben sichtbar')).toBeTruthy()
    expect(rememberedTenants()).toEqual([
      aTenantChoice(['technician'], { id: tenantId, name: 'Elektro Nord' }),
    ])
  })
})

describe('starting this application with a network', () => {
  /**
   * The site asks the server for the ways into the sites of the open jobs
   * its person is assigned to (#286, #447), and the office never asks: any
   * other value the office gets on request, from the route that keeps who saw
   * it. Which entry the page is, the gate hands on.
   */
  it.each([
    ['site', '/sync?since=0&access=values'],
    ['office', '/sync?since=0'],
  ] as const)('pulls from the %s with %s', async (entry, pull) => {
    const tenantId = await businessOnTheDevice()
    const asked: string[] = []

    vi.stubGlobal('fetch', (path: string) => {
      asked.push(path)

      const answer = path.endsWith('/get-session')
        ? session(tenantId)
        : path === '/auth/tenants'
          ? [aTenantChoice(['technician'], { id: tenantId, name: 'Elektro Nord' })]
          : path.startsWith('/sync/conflicts')
            ? []
            : { changes: [], cursor: 1, hasMore: false }

      return Promise.resolve(
        new Response(JSON.stringify(answer), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
    start(entry)

    expect(await screen.findByText('Zählerschrank im Keller')).toBeTruthy()
    await waitFor(() => {
      expect(asked.filter((path) => path.startsWith('/sync?'))).toEqual([pull])
    })
  })

  it('offers the choice of a business under that name', async () => {
    vi.stubGlobal('fetch', (path: string) => {
      const answer = path.endsWith('/get-session')
        ? session(null)
        : path === '/auth/tenants'
          ? [aTenantChoice(['owner'], { id: 't-nord', name: 'Elektro Nord' })]
          : null

      return Promise.resolve(
        new Response(JSON.stringify(answer), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
    start('office')

    expect(await screen.findByRole('heading', { level: 1, name: 'Betrieb wählen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Elektro Nord/ }).textContent).toBe(
      'Elektro NordInhaber',
    )
  })

  it('says that the businesses are being loaded, and when they did not arrive', async () => {
    let tenants: 'never' | 'refused' = 'never'

    vi.stubGlobal('fetch', (path: string) => {
      if (path === '/auth/tenants') {
        return tenants === 'never'
          ? new Promise(() => {})
          : Promise.resolve(
              new Response(JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }), {
                status: 500,
                headers: { 'content-type': 'application/json' },
              }),
            )
      }

      return Promise.resolve(
        new Response(JSON.stringify(path.endsWith('/get-session') ? session(null) : null), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    })
    const first = start('office')

    expect(await screen.findByText('Die Betriebe werden geladen.')).toBeTruthy()
    first.unmount()

    tenants = 'refused'
    start('office')

    expect(await screen.findByText('Die Liste der Betriebe kam nicht an.')).toBeTruthy()
  })
})
