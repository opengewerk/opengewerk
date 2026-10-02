import 'fake-indexeddb/auto'

import type {
  AuditChange,
  InstanceLogPage,
  InstanceSettingsView,
  InstanceTenantView,
  OperatorView,
} from '@opengewerk/domain'
import {
  InstanceOperatorsScreen,
  InstanceSettingsScreen,
  InstanceTenantsScreen,
} from '@opengewerk/platform-web/instance'
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
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InApplication } from '../../app/in-application.js'
import { aTenantChoice } from '../../session/test-tenants.js'
import { SyncClient } from '../../sync/client.js'
import { InstanceLogScreen } from './log.js'
import { InstanceShell } from './shell.js'

/**
 * The area of the instance (#188) in this application, as the boards
 * "Instanz: Betriebe", "Instanz: Einstellungen", "Instanz: Betreiber" and
 * "Instanz: Protokoll" draw it.
 *
 * Its frame and three of its screens are the foundation's and have their
 * tests there (ADR 0010). Here is what only this application can get wrong:
 * the screens its navigation lists and where, the words it hands in for a
 * business, its owner and the operators, and the log, which stays here with
 * the change log of a business it is drawn from.
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

function sent(method: string, path: string): unknown[] {
  return calls
    .filter((call) => call.method === method && call.path === path)
    .map((call) => call.body)
}

/** The area as the router of the office mounts it, at one of its addresses. */
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
          component: InstanceOperatorsScreen,
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
      <InApplication>
        <SyncProvider client={client}>
          <RouterProvider router={router} />
        </SyncProvider>
      </InApplication>
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

describe('the area of the instance in this application', () => {
  it('lists the businesses, the settings, the operators and the log, and the way back to the office', async () => {
    answer('GET', '/instance/tenants', [])
    await mount('/instanz')

    const nav = (await screen.findAllByRole('navigation', { name: 'Instanz' }))[0] as HTMLElement

    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Betriebe', '/instanz'],
      ['Einstellungen', '/instanz/einstellungen'],
      ['Betreiber', '/instanz/betreiber'],
      ['Protokoll', '/instanz/protokoll'],
      ['Zurück zum Büro', '/'],
    ])
    expect(within(nav).getByRole('link', { name: 'Betriebe' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(await within(nav).findByText('Elektro Kohm GmbH')).toBeTruthy()
    expect(screen.getByRole('banner').textContent).toContain('OpenGewerk')
  })

  it('says at the door who may enter, in its words', async () => {
    answer('GET', '/instance/access', { operator: false, secondFactor: true })
    await mount('/instanz')

    expect(
      await screen.findByText('Diesen Bereich erreicht nur, wer die Instanz betreibt.'),
    ).toBeTruthy()
    expect(screen.getByText('Was allen Betrieben auf dieser Instanz gemeinsam ist.')).toBeTruthy()
  })

  it('says at the door that the area wants a second factor, as the owner does', async () => {
    answer('GET', '/instance/access', { operator: true, secondFactor: false })
    await mount('/instanz')

    expect(
      (await screen.findByText(/Für diesen Bereich ist ein zweiter Faktor Pflicht/)).textContent,
    ).toBe(
      'Für diesen Bereich ist ein zweiter Faktor Pflicht, wie für die Rolle Inhaber: eine Authenticator-App oder die Anmeldung mit einem Passkey. Eingerichtet wird beides unter Konto.',
    )
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
]

describe('the businesses on the instance in this application', () => {
  it('are a business and an owner in every word, with the rule for the name of a business', async () => {
    answer('GET', '/instance/tenants', tenants)
    answer('POST', '/instance/tenants', {
      tenantId: 't-4',
      token: 'k7Qm2vXnR4tB9sLw',
      expiresAt: '2026-10-04T14:31:00.000Z',
    })
    await mount('/instanz')
    const user = userEvent.setup()

    const table = await screen.findByRole('table', { name: 'Die Betriebe auf dieser Instanz' })

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Betrieb', 'Angelegt', 'Inhaber', 'Zugänge'])

    await user.click(screen.getByRole('button', { name: 'Betrieb anlegen' }))

    const form = screen
      .getByRole('button', { name: 'Abbrechen' })
      .closest('form') as HTMLFormElement

    await user.click(within(form).getByRole('button', { name: 'Betrieb anlegen' }))
    expect(within(form).getByText('Der Name des Betriebs fehlt.')).toBeTruthy()
    expect(within(form).getByText('Der Name des Inhabers fehlt.')).toBeTruthy()
    expect((within(form).getByLabelText('Name des Betriebs') as HTMLInputElement).maxLength).toBe(
      120,
    )

    await user.type(within(form).getByLabelText('Name des Betriebs'), 'Elektro Weber OHG')
    await user.type(within(form).getByLabelText('Name des Inhabers'), 'Anna Weber')
    await user.type(within(form).getByLabelText(/E-Mail des Inhabers/), 'anna@elektro-weber.de')
    await user.click(within(form).getByRole('button', { name: 'Betrieb anlegen' }))

    expect(await screen.findByText('Elektro Weber OHG ist angelegt.')).toBeTruthy()
    expect(sent('POST', '/instance/tenants')).toEqual([
      { name: 'Elektro Weber OHG', leadName: 'Anna Weber', leadEmail: 'anna@elektro-weber.de' },
    ])
    expect(
      screen.getByText(
        'Diesen Link an Anna Weber geben. Er ist nur jetzt zu sehen, gilt einmal und sieben Tage lang, und wer ihn öffnet, wird Inhaber des neuen Betriebs.',
      ),
    ).toBeTruthy()
  })
})

const settings: InstanceSettingsView = {
  mailInternalHosts: ['mail.intern.example'],
  backupTime: '02:30',
  takenOverAt: null,
}

describe('the settings of the instance in this application', () => {
  it('explain the mail servers in the own network with its name and its word for a business', async () => {
    answer('GET', '/instance/settings', settings)
    await mount('/instanz/einstellungen')

    expect(
      await screen.findByText(
        'Ein Betrieb verschickt seine E-Mails über seinen eigenen Mailserver. Liegt der nicht im Internet, sondern im Netz dieser Instanz, lehnt OpenGewerk ihn ab, außer er steht hier. So greift kein Betrieb über die Instanz in das Netz dahinter.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Was für alle Betriebe auf dieser Instanz gilt.')).toBeTruthy()
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

describe('the operators in this application', () => {
  it('are operators in every word', async () => {
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

    const table = await screen.findByRole('table', { name: 'Die Betreiber dieser Instanz' })

    expect(screen.getByRole('heading', { level: 1, name: 'Betreiber' })).toBeTruthy()
    expect(
      screen.getByText(
        'Ohne zweiten Faktor kommt niemand hierher; eingerichtet wird er unter „Konto“. Sich selbst und den letzten Betreiber entfernt niemand.',
      ),
    ).toBeTruthy()

    await user.click(
      within(table).getByRole('button', { name: 'Anna Weber als Betreiber entfernen' }),
    )
    expect(
      await screen.findByRole('alertdialog', { name: 'Anna Weber als Betreiber entfernen?' }),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    const field = screen.getByLabelText('E-Mail des Kontos') as HTMLInputElement

    expect(field.placeholder).toBe('name@betrieb.de')

    await user.type(field, 'britta@kohm.example.de')
    await user.click(screen.getByRole('button', { name: 'Benennen' }))

    expect(await screen.findByText('Britta Büro ist jetzt Betreiber.')).toBeTruthy()
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
    // Inside the frame of the area, on a page of the foundation.
    expect(screen.getByRole('heading', { level: 1, name: 'Protokoll' })).toBeTruthy()
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
