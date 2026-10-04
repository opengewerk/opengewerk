import 'fake-indexeddb/auto'

import type { Operation, OperationReceipt, TenantId } from '@opengewerk/platform-domain'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeviceStart, InterfaceApplication } from '../application.js'
import type { Entry } from '../components/surface.js'
import { InProbe, probeApplication, probeRules } from '../probe-application.js'
import { deviceIdentity } from '../session/device.js'
import { useRight } from '../session/queries.js'
import {
  forgetSignIn,
  keptTenantsKey,
  rememberAccount,
  rememberTenants,
  rememberedAccount,
  rememberedTenants,
} from '../session/remembered.js'
import { currentAccount } from '../session/session.js'
import type { TenantChoice } from '../session/session.js'
import { useWho } from '../session/who.js'
import { SyncClient } from '../sync/client.js'
import { text } from '../sync/fields.js'
import { useRecords, useSyncStatus } from '../sync/provider.js'
import { openLocalStore } from '../sync/store.js'
import { Boot } from './boot.js'

/**
 * The start of an application, with a network and without one (#123).
 *
 * The tests of the offline layer start the sync client directly and go past
 * `Boot`, which is how a device that could not open offline passed all of
 * them: the store only opened after the server had named the tenant, and
 * without a network it never did. These start where a phone in a basement
 * starts.
 *
 * The application behind the gate belongs to nobody (ADR 0010): its notes
 * are records no application has, its rights are names no application gives,
 * and what the gate says of a tenant it says in that application's words.
 */

const account = {
  userId: 'u-1',
  email: 'mitglied@nord.example.de',
  name: 'Mia Mitglied',
  twoFactorEnabled: false,
  signInMethod: 'password' as const,
}

/** A tenant as `/auth/tenants` answers it, with whatever the test says about it. */
function aTenant(over: Partial<Omit<TenantChoice, 'id'>> & { readonly id: string }): TenantChoice {
  return {
    name: 'Probewerk Nord',
    roles: ['member'],
    roleLabels: ['Mitglied'],
    rights: [],
    secondFactor: false,
    ...over,
    id: over.id as TenantId,
  }
}

let counter = 0

/** A tenant whose notes are already on this device, from an earlier day with a network. */
async function tenantOnTheDevice(): Promise<TenantId> {
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
            entity: 'notes',
            rows: [{ id: 'n-1', text: 'Leiter im Flur vergessen', version: 1 }],
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
    rules: probeRules,
    deviceId: 'device',
    entities: ['notes'],
    onSignedOut: () => {},
  })

  await client.synchronise()
  client.stop()

  return tenantId
}

function Notes() {
  const notes = useRecords('notes')
  // A screen asking after the account, with options of its own, as a list
  // once did: its retry put the question back to "not answered yet", and the
  // gate took the screen away again.
  useQuery({ queryKey: ['account'], queryFn: currentAccount, retry: 1 })
  // And one asking what the roles allow, as a screen does for everything it
  // offers (#184).
  const readsNotes = useRight('note.read')
  // The tenant by name, as a header shows it once the list of memberships
  // has arrived. Until then nobody may do anything, so a test about
  // something hidden waits for this first.
  const { tenant } = useWho()
  // What the strip over every screen would say.
  const { trouble } = useSyncStatus()

  return (
    <>
      <ul>
        {notes.map((note) => (
          <li key={String(note['id'])}>{text(note, 'text')}</li>
        ))}
      </ul>
      <p>{readsNotes ? 'Notizen lesbar' : 'Notizen nicht lesbar'}</p>
      {tenant ? <p>Arbeitet bei {tenant}</p> : null}
      {trouble ? <p>{trouble}</p> : null}
    </>
  )
}

function start(
  options: { readonly entry?: Entry; readonly application?: InterfaceApplication } = {},
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <InProbe application={options.application}>
        <Boot entry={options.entry ?? 'site'}>
          <Notes />
        </Boot>
      </InProbe>
    </QueryClientProvider>,
  )
}

/** A network that is not there: every request fails before any answer. */
function noNetwork() {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
}

interface Answer {
  readonly status: number
  readonly body: unknown
}

/** Every path the server of a test was asked, in order. */
let asked: string[] = []

/** A server that answers each path with what the test says, and 200 with nothing otherwise. */
function serverAnswers(answer: (path: string) => unknown) {
  asked = []

  vi.stubGlobal('fetch', (path: string) => {
    asked.push(path)

    const found = answer(path)
    const { status, body } =
      typeof found === 'object' && found !== null && 'status' in found && 'body' in found
        ? (found as Answer)
        : { status: 200, body: found }

    if (body === 'never') {
      return new Promise(() => {})
    }

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
}

/** What `/api/auth/get-session` answers for somebody signed in, in a tenant or in none yet. */
function session(tenantId: string | null, signInMethod = 'password') {
  return {
    user: { id: account.userId, email: account.email, name: account.name },
    session: { activeTenantId: tenantId, signInMethod },
  }
}

beforeEach(() => {
  forgetSignIn()
})

afterEach(() => {
  vi.unstubAllGlobals()
  globalThis.history.replaceState(null, '', '/')
})

describe('starting without a network', () => {
  it('opens the tenant it was last signed in to, with what the device holds', async () => {
    const tenantId = await tenantOnTheDevice()

    rememberAccount({ ...account, tenantId })
    noNetwork()
    start()

    expect(await screen.findByText('Leiter im Flur vergessen')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Anmelden' })).toBeNull()

    // And it stays open, although the screens inside keep asking.
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    expect(screen.getByText('Leiter im Flur vergessen')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Einen Moment' })).toBeNull()
  })

  it('shows what the rights kept from the last start allow', async () => {
    const tenantId = await tenantOnTheDevice()

    rememberAccount({ ...account, tenantId })
    rememberTenants([aTenant({ id: tenantId, rights: ['note.read'] })])
    noNetwork()
    start()

    expect(await screen.findByText('Leiter im Flur vergessen')).toBeTruthy()
    expect(await screen.findByText('Notizen lesbar')).toBeTruthy()
  })

  /**
   * The rights and not the name of a role (ADR 0010): a tenant can change
   * what a role may do, and what was kept is what the server resolved from
   * its rows. A role that sounds as if it could, in a tenant that took the
   * right away, shows nothing; a role nobody has heard of, in a tenant that
   * gave it the right, shows it.
   */
  it.each([
    [['lead'], [], 'Notizen nicht lesbar'],
    [['scribe'], ['note.read'], 'Notizen lesbar'],
  ] as const)(
    'goes by the rights kept, not by what a role is called (%j with %j)',
    async (roles, rights, shown) => {
      const tenantId = await tenantOnTheDevice()

      rememberAccount({ ...account, tenantId })
      rememberTenants([aTenant({ id: tenantId, roles, rights })])
      noNetwork()
      start()

      expect(await screen.findByText('Leiter im Flur vergessen')).toBeTruthy()
      // Once the kept list has arrived, and not before: until then every
      // screen shows what nobody may do.
      expect(await screen.findByText('Arbeitet bei Probewerk Nord')).toBeTruthy()
      expect(screen.getByText(shown)).toBeTruthy()
    },
  )

  it('shows nothing that needs a right, when nothing was kept for this tenant', async () => {
    const tenantId = await tenantOnTheDevice()

    rememberAccount({ ...account, tenantId })
    rememberTenants([aTenant({ id: 'elsewhere', name: 'Anderswo', rights: ['note.read'] })])
    noNetwork()
    start()

    expect(await screen.findByText('Leiter im Flur vergessen')).toBeTruthy()
    expect(screen.getByText('Notizen nicht lesbar')).toBeTruthy()
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
    rememberTenants([aTenant({ id: 'somewhere', name: 'Irgendwo', rights: ['note.read'] })])
    serverAnswers((path) => (path === '/setup' ? { needed: false } : null))
    start()

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeTruthy()
    await waitFor(() => {
      expect(rememberedAccount()).toBeNull()
    })
    // The rights went with the person, not only with the tenant.
    expect(globalThis.localStorage.getItem(keptTenantsKey)).toBeNull()
  })

  it('sets an instance up that has never been used, instead of asking for a sign in', async () => {
    serverAnswers((path) => (path === '/setup' ? { needed: true } : null))
    start()

    expect(await screen.findByRole('heading', { name: 'Einrichten' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Anmelden' })).toBeNull()
  })

  it('shows the version the server names in the foot of the sign in (#259)', async () => {
    serverAnswers((path) =>
      path === '/health'
        ? { status: 'bereit', database: true, version: '0.2.0' }
        : path === '/setup'
          ? { needed: false }
          : null,
    )
    start()

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeTruthy()
    expect(await screen.findByText('Probelizenz 1.0 · Version 0.2.0')).toBeTruthy()
  })

  /**
   * A sign in with a passkey carries the second factor itself (#167), so
   * somebody who leads a tenant and has no app goes on to the choice, where
   * one who signed in with the password alone is asked to set the app up.
   */
  it.each([
    ['passkey', 'Mandant wählen'],
    ['password', 'Zweiter Faktor'],
  ])(
    'sends somebody without the app whose role asks for it after a sign in with the %s to "%s"',
    async (method, heading) => {
      serverAnswers((path) =>
        path.endsWith('/get-session')
          ? session(null, method)
          : path === '/auth/tenants'
            ? [aTenant({ id: 't-nord', roles: ['lead'], secondFactor: true })]
            : null,
      )
      start()

      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
    },
  )

  /**
   * Which role asks for a second factor is said by the server, from the rows
   * of the tenant. The gate holds no list of its own: a role of any name that
   * asks for one leads to the setup, and one that sounds as if it should, in
   * a tenant that does not ask, goes on.
   */
  it.each([
    [['member'], true, 'Zweiter Faktor'],
    [['lead'], false, 'Mandant wählen'],
  ] as const)(
    'asks for the second factor where the tenant says so (%j, asked for: %j)',
    async (roles, secondFactor, heading) => {
      serverAnswers((path) =>
        path.endsWith('/get-session')
          ? session(null)
          : path === '/auth/tenants'
            ? [aTenant({ id: 't-nord', roles, secondFactor })]
            : null,
      )
      start()

      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
    },
  )

  /**
   * While the tenants of the account are on their way, and when they did not
   * arrive: both in the words of the application, which has the word for a
   * tenant, and the second with a way to ask again.
   */
  it('says that the tenants are being loaded, and when they did not arrive, with a way to ask again', async () => {
    let tenants: Answer = { status: 200, body: 'never' }

    serverAnswers((path) =>
      path.endsWith('/get-session') ? session(null) : path === '/auth/tenants' ? tenants : null,
    )
    const first = start()

    expect(await screen.findByText('Die Mandanten werden geladen.')).toBeTruthy()
    first.unmount()

    tenants = { status: 500, body: { statusCode: 500, message: 'Internal Server Error' } }
    start()

    expect(await screen.findByRole('heading', { name: 'Das ging nicht' })).toBeTruthy()
    expect(screen.getByText('Die Liste der Mandanten kam nicht an.')).toBeTruthy()

    tenants = { status: 200, body: [aTenant({ id: 't-nord' })] }
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(await screen.findByRole('heading', { name: 'Mandant wählen' })).toBeTruthy()
  })

  it('keeps who is signed in, where and with which rights, for the next start without one', async () => {
    const tenantId = await tenantOnTheDevice()

    serverAnswers((path) =>
      path.endsWith('/get-session')
        ? session(tenantId)
        : path === '/auth/tenants'
          ? [aTenant({ id: tenantId, rights: ['note.read'] })]
          : path.startsWith('/sync/conflicts')
            ? []
            : { changes: [], cursor: 1, hasMore: false },
    )
    start()

    expect(await screen.findByText('Leiter im Flur vergessen')).toBeTruthy()
    await waitFor(() => {
      expect(rememberedAccount()).toMatchObject({ userId: account.userId, tenantId })
    })
    await waitFor(() => {
      expect(rememberedTenants()).toEqual([aTenant({ id: tenantId, rights: ['note.read'] })])
    })
  })
})

describe('what a link in the address points at', () => {
  const invitation = 'a'.repeat(43)

  /**
   * Before the question who is signed in, and whatever its answer: somebody
   * who is signed in on this browser can be handed a link for somebody else,
   * and the screen has to be the one the link points at, not the screens of
   * whoever used the machine last.
   *
   * Looked at once the account has answered and the device behind the gate
   * has pulled, and not before. Until the account answers, a gate that
   * showed the link only to somebody not signed in shows it as well, and a
   * check made at that moment passes for it.
   */
  it.each([
    [`/einladung/${invitation}`, 'Willkommen bei Probewerk Süd'],
    ['/passwort/abcdefghijklmnopqrstuvwx', 'Passwort neu setzen'],
  ])(
    'is shown instead of the screens of whoever is signed in on this browser (%s)',
    async (address, heading) => {
      const tenantId = await tenantOnTheDevice()

      serverAnswers((path) =>
        path.endsWith('/get-session')
          ? session(tenantId)
          : path === `/invitation/${invitation}`
            ? {
                state: 'open',
                company: 'Probewerk Süd',
                name: 'Nele Neu',
                email: 'neue@sued.example.de',
                expiresAt: '2026-10-09T08:00:00.000Z',
                knownAccount: false,
              }
            : path === '/auth/tenants'
              ? [aTenant({ id: tenantId })]
              : path.startsWith('/sync/conflicts')
                ? []
                : { changes: [], cursor: 1, hasMore: false },
      )
      globalThis.history.replaceState(null, '', address)
      start()

      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()

      // The device of whoever is signed in has started behind the gate and
      // asked the server. Its screens would be on by now.
      await waitFor(() => {
        expect(asked.some((path) => path.startsWith('/sync?'))).toBe(true)
      })
      await new Promise((resolve) => setTimeout(resolve, 250))

      expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
      expect(screen.queryByText('Leiter im Flur vergessen')).toBeNull()
    },
  )
})

describe('the sync client behind the gate', () => {
  /**
   * The store is the foundation's to open and the client the application's
   * to start (ADR 0010): only it knows by which rules its records travel and
   * which of them it has a screen for. It is handed the store of the tenant
   * the session works in, this device, and the entry the page is, since an
   * application may ask the server differently from each.
   */
  it.each(['office', 'site'] as const)(
    'is the one the application starts, with the store of the tenant, this device and the %s as the entry',
    async (entry) => {
      const tenantId = await tenantOnTheDevice()
      const standing = probeApplication()
      const started: {
        readonly entry: Entry
        readonly deviceId: string
        readonly notes: readonly unknown[]
      }[] = []

      rememberAccount({ ...account, tenantId })
      noNetwork()
      start({
        entry,
        application: {
          ...standing,
          startSync: async (device: DeviceStart) => {
            started.push({
              entry: device.entry,
              deviceId: device.deviceId,
              notes: (await device.store.readAll('notes')).map((note) => note['text']),
            })

            return standing.startSync(device)
          },
        },
      })

      // The screens read from the client it was handed back.
      expect(await screen.findByText('Leiter im Flur vergessen')).toBeTruthy()
      expect(started).toEqual([
        { entry, deviceId: deviceIdentity(), notes: ['Leiter im Flur vergessen'] },
      ])
    },
  )

  /**
   * Somebody else wrote on this device, and their session ran out before it
   * went (opengewerk-haustechnik#31). The client of the person signed in now
   * does not see it, so it does not go out under their name; it waits for its
   * own person.
   */
  it('sends the changes of the person signed in, and leaves those of anybody else waiting', async () => {
    const tenantId = await tenantOnTheDevice()
    const note = (id: string): Operation => ({
      id: id as Operation['id'],
      entity: 'notes',
      recordId: `n-${id}`,
      kind: 'create',
      baseVersion: null,
      patches: [{ field: 'text', from: null, to: 'Ohne Netz geschrieben' }],
      recordedAt: new Date('2026-10-04T08:00:00Z'),
      deviceId: deviceIdentity(),
    })
    const earlier = await openLocalStore(tenantId, 'u-0')

    await earlier.queue(note('op-of-somebody-else'))
    earlier.close()

    const mine = await openLocalStore(tenantId, account.userId)

    await mine.queue(note('op-of-mine'))
    mine.close()

    const standing = probeApplication()
    const waiting: (readonly string[])[] = []

    rememberAccount({ ...account, tenantId })
    noNetwork()
    start({
      application: {
        ...standing,
        startSync: async (device: DeviceStart) => {
          waiting.push((await device.store.readOutbox()).map((operation) => operation.id))

          return standing.startSync(device)
        },
      },
    })

    expect(await screen.findByText('Leiter im Flur vergessen')).toBeTruthy()
    expect(waiting).toEqual([['op-of-mine']])
  })
})

describe('refused with a session that is still good (#254)', () => {
  /**
   * An instance where the account says the same thing every time, and the
   * routes of the exchange answer with whatever `sync` returns.
   */
  function instance(tenantId: TenantId, sync: (path: string) => Answer) {
    serverAnswers((path) =>
      path.endsWith('/get-session')
        ? session(tenantId)
        : path === '/auth/tenants'
          ? [aTenant({ id: tenantId })]
          : sync(path),
    )
  }

  function accepted(path: string): Answer {
    return path.startsWith('/sync/conflicts')
      ? { status: 200, body: [] }
      : { status: 200, body: { changes: [], cursor: 1, hasMore: false } }
  }

  it('stays open over a 403 and says why, instead of waiting for a sign in', async () => {
    const tenantId = await tenantOnTheDevice()

    instance(tenantId, () => ({
      status: 403,
      body: { statusCode: 403, message: 'Kein Zugang zu diesem Mandanten.' },
    }))
    start()

    expect(await screen.findByText('Kein Zugang zu diesem Mandanten.')).toBeTruthy()
    expect(screen.getByText('Leiter im Flur vergessen')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Einen Moment' })).toBeNull()
  })

  it('says so when a 401 leaves the account as it was, and starts again when asked', async () => {
    const tenantId = await tenantOnTheDevice()
    let refusing = true

    instance(tenantId, (path) =>
      refusing
        ? { status: 401, body: { statusCode: 401, message: 'Keine gültige Anmeldung.' } }
        : accepted(path),
    )
    start()

    // Not "Einen Moment" for ever: the account came back with the tenant it
    // had, and nothing would have started the device again.
    expect(await screen.findByRole('heading', { name: 'Abgleich unterbrochen' })).toBeTruthy()

    refusing = false
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))

    expect(await screen.findByText('Leiter im Flur vergessen')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Abgleich unterbrochen' })).toBeNull()
  })
})
