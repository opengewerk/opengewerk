import 'fake-indexeddb/auto'

import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { SyncClient } from '../../sync/client.js'
import { SyncProvider } from '../../sync/provider.js'
import { openLocalStore } from '../../sync/store.js'
import { TestServer } from '../../sync/test-server.js'
import { TagsScreen } from './tags.js'

/**
 * "Tags" under the settings (#314), the board `Einst-Tags`: every tag with the
 * customers and sites that have it, renamed in its line, deleted after a
 * question, and a new one made; whoever may change customers keeps them.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let server: TestServer
let counter = 0
let calls: Call[]
let answers: Map<string, { status: number; body: unknown }>

function serverSays(method: string, path: string, body: unknown, status = 200): void {
  answers.set(`${method} ${path}`, { status, body })
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'buero@nord.example.de', name: 'Beate Büro' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

async function mount() {
  const client = await SyncClient.start({
    store: await openLocalStore(`einstellungen-tags${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['customers', 'sites', 'tags', 'customer_tags', 'site_tags'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SyncProvider client={client}>
        <InRouter>
          <TagsScreen />
        </InRouter>
      </SyncProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  server = new TestServer()
  calls = []
  answers = new Map()

  for (const [id, name] of [
    ['t-pv', 'Photovoltaik'],
    ['t-wallbox', 'Wallbox'],
  ]) {
    server.put('tags', { id, name, version: 1, deletedAt: null })
  }

  server.put('customers', {
    id: 'c-1',
    name: 'Weber',
    kind: 'private',
    version: 1,
    deletedAt: null,
  })
  server.put('customers', { id: 'c-2', name: 'Kern', kind: 'private', version: 1, deletedAt: null })
  server.put('sites', { id: 's-1', customerId: 'c-1', designation: 'Haus', version: 1 })

  for (const [id, customerId, tagId] of [
    ['ct-1', 'c-1', 't-pv'],
    ['ct-2', 'c-2', 't-pv'],
    ['ct-3', 'c-1', 't-wallbox'],
  ]) {
    server.put('customer_tags', { id, customerId, tagId, version: 1, deletedAt: null })
  }

  server.put('site_tags', { id: 'st-1', siteId: 's-1', tagId: 't-pv', version: 1, deletedAt: null })

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      path,
      method,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })

    const answer = answers.get(`${method} ${path}`) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the tags under the settings', () => {
  it('list every tag with how many customers and sites have it', async () => {
    signedInAs('office')
    await mount()

    const list = await screen.findByRole('list', { name: 'Tags des Betriebs' })
    const rows = within(list).getAllByRole('listitem')

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^PhotovoltaikKunden: 2Objekte: 1/),
      expect.stringMatching(/^WallboxKunden: 1Objekte: 0/),
    ])
  })

  it('rename one in its line', async () => {
    signedInAs('office')
    serverSays('PATCH', '/customers/tags/t-wallbox', { id: 't-wallbox', name: 'Ladepunkt' })
    await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Wallbox umbenennen' }))

    const field = screen.getByLabelText('Neuer Name')

    await user.clear(field)
    await user.type(field, '  Ladepunkt ')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/customers/tags/t-wallbox',
        body: { name: 'Ladepunkt' },
      })
    })
  })

  it('say why a name is taken, in the words of the server', async () => {
    signedInAs('office')
    serverSays('POST', '/customers/tags', { message: 'Den Tag „Wallbox“ gibt es schon.' }, 409)
    await mount()
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Neuer Tag'), 'wallbox')
    await user.click(screen.getByRole('button', { name: 'Tag anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Den Tag „Wallbox“ gibt es schon.')
  })

  it('delete one only after asking, and say what goes with it', async () => {
    signedInAs('office')
    serverSays('DELETE', '/customers/tags/t-pv', { removed: 't-pv' })
    await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Photovoltaik löschen' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Tag löschen?' })

    expect(dialog.textContent).toContain('verschwindet von jedem Kunden und jedem Objekt')
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Löschen' }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'DELETE',
        path: '/customers/tags/t-pv',
        body: undefined,
      })
    })
  })

  it('make a new one, and not an empty one', async () => {
    signedInAs('owner')
    serverSays('POST', '/customers/tags', { id: 't-new', name: 'Wärmepumpe' }, 201)
    await mount()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Tag anlegen' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Ein Tag braucht einen Namen.')
    expect(calls.some((call) => call.method === 'POST')).toBe(false)

    await user.type(screen.getByLabelText('Neuer Tag'), 'Wärmepumpe')
    await user.click(screen.getByRole('button', { name: 'Tag anlegen' }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/customers/tags',
        body: { name: 'Wärmepumpe' },
      })
    })
  })
})
