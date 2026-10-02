import 'fake-indexeddb/auto'

import type {
  AuditChange,
  InstanceLogPage,
  InstanceSettingsView,
  InstanceTenantView,
  OperatorView,
} from '@opengewerk/domain'
import { SyncProvider, openLocalStore } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { InstanceLogScreen } from './log.js'
import { OperatorsScreen } from './operators.js'
import { InstanceSettingsScreen } from './settings.js'
import { InstanceShell } from './shell.js'
import { InstanceTenantsScreen } from './tenants.js'
import { aTenantChoice } from '../../session/test-tenants.js'

/**
 * The area of the instance (#188) with its screens, as the boards "Instanz:
 * Betriebe", "Instanz: Einstellungen", "Instanz: Betreiber" and "Instanz:
 * Protokoll" draw them: only for an operator with a second factor, and each
 * screen saying and sending what the routes behind it take.
 */

interface Call {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

let answers: Map<string, unknown>
let calls: Call[]
let counter = 0

function answer(method: string, path: string, value: unknown) {
  answers.set(`${method} ${path}`, value)
}

async function mount(path: string) {
  const server = new TestServer()
  const client = await SyncClient.start({
    store: await openLocalStore(`instanz${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['tasks'],
    onSignedOut: () => {},
  })

  const root = createRootRoute({ component: Outlet })
  const instance = createRoute({
    getParentRoute: () => root,
    path: '/instanz',
    component: InstanceShell,
  })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: () => <h1>Kunden</h1> }),
      createRoute({ getParentRoute: () => root, path: '/konto', component: () => <h1>Konto</h1> }),
      instance.addChildren([
        createRoute({
          getParentRoute: () => instance,
          path: '/',
          component: InstanceTenantsScreen,
        }),
        createRoute({
          getParentRoute: () => instance,
          path: '/einstellungen',
          component: InstanceSettingsScreen,
        }),
        createRoute({
          getParentRoute: () => instance,
          path: '/betreiber',
          component: OperatorsScreen,
        }),
        createRoute({
          getParentRoute: () => instance,
          path: '/protokoll',
          component: InstanceLogScreen,
        }),
      ]),
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

  return router
}

beforeEach(() => {
  answers = new Map()
  calls = []
  answer('GET', '/api/auth/get-session', {
    user: {
      id: 'u-1',
      email: 'moritz@kohm.example.de',
      name: 'Moritz Kohm',
      twoFactorEnabled: true,
    },
    session: { activeTenantId: 't-1' },
  })
  answer('GET', '/auth/tenants', [aTenantChoice(['owner'], { name: 'Elektro Kohm GmbH' })])
  answer('GET', '/instance/access', { operator: true, secondFactor: true })

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    const key = `${method} ${path}`

    calls.push({ method, path, body })

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(key) ?? {}), {
        status: answers.has(key) ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the door of the area', () => {
  it('stays shut for somebody who does not run the instance', async () => {
    answer('GET', '/instance/access', { operator: false, secondFactor: true })
    await mount('/instanz')

    expect(
      await screen.findByText('Diesen Bereich erreicht nur, wer die Instanz betreibt.'),
    ).toBeTruthy()
    expect(calls.some((call) => call.path === '/instance/tenants')).toBe(false)
  })

  it('sends an operator without a second factor to "Konto"', async () => {
    answer('GET', '/instance/access', { operator: true, secondFactor: false })
    await mount('/instanz')

    expect(
      await screen.findByText(/Für diesen Bereich ist ein zweiter Faktor Pflicht/),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Konto' }).getAttribute('href')).toBe('/konto')
  })

  it('has a navigation of its own, and the way back to the business', async () => {
    answer('GET', '/instance/tenants', [])
    await mount('/instanz')

    const nav = (await screen.findAllByRole('navigation', { name: 'Instanz' }))[0] as HTMLElement

    expect(within(nav).getByRole('link', { name: 'Betriebe' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Protokoll' })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'Zurück zum Büro' }).getAttribute('href')).toBe(
      '/',
    )
    expect(await within(nav).findByText('Elektro Kohm GmbH')).toBeTruthy()
    expect(screen.getByRole('banner').textContent).toContain('Instanz')
  })
})

const tenants: readonly InstanceTenantView[] = [
  {
    id: 't-1',
    name: 'Elektro Kohm GmbH',
    createdAt: '2026-09-24T18:12:00.000Z',
    leads: [{ name: 'Moritz Kohm', email: 'moritz@kohm.example.de' }],
    members: 4,
    invitedLeads: [],
  },
  {
    id: 't-3',
    name: 'Elektro Weber OHG',
    createdAt: '2026-09-27T14:31:00.000Z',
    leads: [],
    members: 0,
    invitedLeads: ['anna@elektro-weber.de'],
  },
]

describe('the businesses on the instance', () => {
  it('lists each with its day, its owners and its people, and nothing of what is in it', async () => {
    answer('GET', '/instance/tenants', tenants)
    await mount('/instanz')

    const table = await screen.findByRole('table', { name: 'Die Betriebe auf dieser Instanz' })
    const rows = within(table).getAllByRole('row')

    expect(rows[1]?.textContent).toContain('Elektro Kohm GmbH')
    expect(rows[1]?.textContent).toContain('24.09.2026')
    expect(rows[1]?.textContent).toContain('Moritz Kohmdu')
    expect(rows[1]?.textContent).toContain('4')
    expect(rows[2]?.textContent).toContain('Einladung offen')
    expect(rows[2]?.textContent).toContain('anna@elektro-weber.de')
  })

  it('makes one for somebody else and shows the link that makes them its owner, once', async () => {
    answer('GET', '/instance/tenants', tenants)
    answer('POST', '/instance/tenants', {
      tenantId: 't-4',
      token: 'k7Qm2vXnR4tB9sLw',
      expiresAt: '2026-10-04T14:31:00.000Z',
    })
    await mount('/instanz')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Betrieb anlegen' }))
    const form = screen
      .getByRole('button', { name: 'Abbrechen' })
      .closest('form') as HTMLFormElement

    // Nothing goes out while a field is missing.
    await user.click(within(form).getByRole('button', { name: 'Betrieb anlegen' }))
    expect(within(form).getByText('Der Name des Betriebs fehlt.')).toBeTruthy()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)

    await user.type(within(form).getByLabelText('Name des Betriebs'), 'Elektro Weber OHG')
    await user.type(within(form).getByLabelText('Name des Inhabers'), 'Anna Weber')
    await user.type(within(form).getByLabelText(/E-Mail des Inhabers/), 'anna@elektro-weber.de')
    await user.click(within(form).getByRole('button', { name: 'Betrieb anlegen' }))

    expect(await screen.findByText('Elektro Weber OHG ist angelegt.')).toBeTruthy()
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Elektro Weber OHG',
      leadName: 'Anna Weber',
      leadEmail: 'anna@elektro-weber.de',
    })
    expect((screen.getByLabelText('Einladungslink') as HTMLInputElement).value).toBe(
      `${globalThis.location.origin}/einladung/k7Qm2vXnR4tB9sLw`,
    )
    expect(screen.getByText(/Diesen Link an Anna Weber geben/)).toBeTruthy()
  })
})

const settings: InstanceSettingsView = {
  mailInternalHosts: ['mail.intern.example'],
  backupTime: '02:30',
  takenOverAt: '2026-09-27T14:05:00.000Z',
}

describe('the settings of the instance', () => {
  it('say where the mail servers came from, and save them one per line', async () => {
    answer('GET', '/instance/settings', settings)
    answer('PUT', '/instance/settings', {
      ...settings,
      mailInternalHosts: ['mail.intern.example', '192.168.1.20'],
    })
    await mount('/instanz/einstellungen')
    const user = userEvent.setup()

    const hosts = await screen.findByLabelText('Freigegebene Mailserver')

    expect(
      screen.getByText(/Übernommen aus MAIL_INTERNAL_HOSTS in der .env am 27.09.2026/),
    ).toBeTruthy()

    await user.type(hosts, '\n 192.168.1.20 \n')
    const panel = hosts.closest('form') as HTMLFormElement
    await user.click(within(panel).getByRole('button', { name: 'Speichern' }))

    expect(await within(panel).findByText('Gespeichert.')).toBeTruthy()
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      mailInternalHosts: ['mail.intern.example', '192.168.1.20'],
    })
  })

  it('refuse a server with a port before anything goes out', async () => {
    answer('GET', '/instance/settings', settings)
    await mount('/instanz/einstellungen')
    const user = userEvent.setup()

    const hosts = await screen.findByLabelText('Freigegebene Mailserver')

    await user.type(hosts, '\nmail.lan:25')

    expect(screen.getByText(/„mail.lan:25“ ist kein Servername/)).toBeTruthy()
    expect(
      (
        within(hosts.closest('form') as HTMLFormElement).getByRole('button', {
          name: 'Speichern',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('save the hour of the backup on its own', async () => {
    answer('GET', '/instance/settings', settings)
    answer('PUT', '/instance/settings', { ...settings, backupTime: '03:15' })
    await mount('/instanz/einstellungen')
    const user = userEvent.setup()

    const time = await screen.findByLabelText('Uhrzeit')

    await user.clear(time)
    await user.type(time, '03:15')
    await user.click(
      within(time.closest('form') as HTMLFormElement).getByRole('button', { name: 'Speichern' }),
    )

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ backupTime: '03:15' })
    })
  })
})

const operators: readonly OperatorView[] = [
  {
    userId: 'u-1',
    name: 'Moritz Kohm',
    email: 'moritz@kohm.example.de',
    since: '2026-09-24T18:12:00.000Z',
    secondFactor: true,
  },
  {
    userId: 'u-2',
    name: 'Anna Weber',
    email: 'a.weber@kohm.example.de',
    since: '2026-09-27T14:40:00.000Z',
    secondFactor: false,
  },
]

describe('the operators', () => {
  it('say who has the second factor, and remove nobody from themselves', async () => {
    answer('GET', '/instance/operators', operators)
    answer('DELETE', '/instance/operators/u-2', { removed: 'u-2' })
    await mount('/instanz/betreiber')
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Die Betreiber dieser Instanz' })

    expect(within(table).getAllByRole('row')[1]?.textContent).toContain('Eingerichtet')
    expect(within(table).getAllByRole('row')[2]?.textContent).toContain('Fehlt')
    expect(
      (
        within(table).getByRole('button', {
          name: 'Moritz Kohm als Betreiber entfernen',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    await user.click(
      within(table).getByRole('button', { name: 'Anna Weber als Betreiber entfernen' }),
    )
    await user.click(await screen.findByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(
        calls.some((call) => call.method === 'DELETE' && call.path === '/instance/operators/u-2'),
      ).toBe(true)
    })
  })

  it('name an account that exists by its address', async () => {
    answer('GET', '/instance/operators', operators)
    answer('POST', '/instance/operators', {
      userId: 'u-3',
      name: 'Britta Büro',
      email: 'britta@kohm.example.de',
      since: '2026-09-27T15:00:00.000Z',
      secondFactor: false,
    })
    await mount('/instanz/betreiber')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('E-Mail des Kontos'), 'britta@kohm.example.de')
    await user.click(screen.getByRole('button', { name: 'Benennen' }))

    expect(await screen.findByText('Britta Büro ist jetzt Betreiber.')).toBeTruthy()
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      email: 'britta@kohm.example.de',
    })
  })
})

function change(overrides: Partial<AuditChange>): AuditChange {
  return {
    changeId: 'c-1',
    changedAt: '2026-09-27T14:42:00.000Z',
    operation: 'update',
    table: 'instance_settings',
    recordId: '1',
    userId: 'u-1',
    deviceId: null,
    reason: 'instance.settings',
    databaseRole: 'opengewerk_app',
    firstSequence: 0,
    lastSequence: 0,
    fields: [{ field: 'backup_time', before: '02:30:00', after: '03:15:00' }],
    ...overrides,
  }
}

const log: InstanceLogPage = {
  changes: [
    change({}),
    change({
      changeId: 'c-2',
      operation: 'insert',
      table: 'instance_operators',
      recordId: 'op-2',
      reason: 'operator.appoint',
      fields: [{ field: 'user_id', before: null, after: 'u-2' }],
    }),
    change({
      changeId: 'c-3',
      operation: 'insert',
      table: 'tenants',
      recordId: 't-3',
      reason: 'instance.tenant',
      fields: [{ field: 'name', before: null, after: 'Elektro Weber OHG' }],
    }),
    change({
      changeId: 'c-4',
      table: 'instance_settings',
      userId: null,
      reason: 'environment',
      fields: [{ field: 'mail_internal_hosts', before: '{}', after: '{mail.lan,192.168.1.20}' }],
    }),
  ],
  next: null,
  titles: {
    'op-2': { table: 'instance_operators', field: 'user_id', title: 'u-2', kind: null },
    't-3': { table: 'tenants', field: 'name', title: 'Elektro Weber OHG', kind: null },
  },
  people: { 'u-1': 'Moritz Kohm', 'u-2': 'Anna Weber' },
  devices: {},
}

describe('the log of the instance', () => {
  it('names what a change is about, what happened, who and on which way', async () => {
    answer('GET', '/instance/log', log)
    await mount('/instanz/protokoll')

    const table = await screen.findByRole('table', { name: 'Änderungen an der Instanz' })
    const rows = within(table).getAllByRole('row')

    expect(rows[1]?.textContent).toContain('Einstellungen der Instanz')
    expect(rows[1]?.textContent).toContain('Uhrzeit der Sicherung')
    expect(rows[1]?.textContent).toContain('Einstellungen der Instanz ändern')
    expect(rows[2]?.textContent).toContain('Anna Weber')
    expect(rows[2]?.textContent).toContain('Betreiber benannt')
    expect(rows[3]?.textContent).toContain('Elektro Weber OHG')
    expect(rows[3]?.textContent).toContain('Betrieb angelegt')
    expect(rows[3]?.textContent).toContain('Betrieb für andere anlegen')
    expect(rows[4]?.textContent).toContain('Niemand')
    expect(rows[4]?.textContent).toContain('Übernommen aus der .env')
    expect(screen.getByText('Das sind alle.')).toBeTruthy()
  })

  it('opens a change with its fields before and after, in the words of the screen', async () => {
    answer('GET', '/instance/log', log)
    await mount('/instanz/protokoll')
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Änderungen an der Instanz' })
    const buttons = within(table).getAllByRole('button', { name: 'Einstellungen der Instanz' })

    await user.click(buttons[1] as HTMLElement)

    const fields = screen.getByRole('table', { name: 'Felder vorher und nachher' })

    expect(fields.textContent).toContain('Freigegebene Mailserver')
    expect(fields.textContent).toContain('leer')
    expect(fields.textContent).toContain('mail.lan, 192.168.1.20')

    await user.click(buttons[0] as HTMLElement)

    const time = screen.getByRole('table', { name: 'Felder vorher und nachher' })

    expect(time.textContent).toContain('02:30')
    expect(time.textContent).toContain('03:15')
    expect(time.textContent).not.toContain('03:15:00')
  })
})
