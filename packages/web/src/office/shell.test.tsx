import 'fake-indexeddb/auto'

import { PathSlot } from '@opengewerk/platform-web/office'
import { SyncProvider, openLocalStore } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { useContext } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InApplication } from '../app/in-application.js'
import { aTenantChoice } from '../session/test-tenants.js'
import { SyncClient } from '../sync/client.js'
import { OfficeShell } from './shell.js'

/**
 * The shell of the office as the canvas draws it (#217). The frame is the
 * foundation's and has its tests there (ADR 0010); here is what this
 * application hands in: what it is called, the entries of its navigation for
 * each of its roles, what waits beside them, the screens that are worked in,
 * and the strip for a backup that is behind.
 */

let answers: Map<string, unknown>
let counter = 0

/** A screen that says whether the header has a place for its path. */
function Page({ title }: { readonly title: string }) {
  const slot = useContext(PathSlot)

  return (
    <>
      <h1>{title}</h1>
      <p>{slot ? 'mit Platz in der Kopfleiste' : 'ohne Platz in der Kopfleiste'}</p>
    </>
  )
}

async function mount(path = '/', seed: (server: TestServer) => void = () => {}) {
  const server = new TestServer()
  seed(server)
  const client = await SyncClient.start({
    store: await openLocalStore(`huelle${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['tasks', 'documents'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute({ component: OfficeShell })
  const page = (title: string) => () => <Page title={title} />
  const at = (route: string, title: string) =>
    createRoute({ getParentRoute: () => root, path: route, component: page(title) })
  const router = createRouter({
    routeTree: root.addChildren([
      at('/', 'Kunden'),
      at('/kunden/$customerId', 'Ein Kunde'),
      at('/anlagen/$installationId', 'Eine Anlage'),
      at('/verteiler/$boardId', 'Ein Verteiler'),
      at('/stromkreise/$circuitId', 'Ein Stromkreis'),
      at('/wechselrichter/$inverterId', 'Ein Wechselrichter'),
      at('/strings/$stringId', 'Ein String'),
      at('/pruefprotokolle/$recordId', 'Ein Prüfprotokoll'),
      at('/auftraege', 'Aufträge'),
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

  await screen.findByRole('heading', { level: 1 })

  return router
}

function signedInAs(...roles: string[]) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'beate@nord.example.de', name: 'Beate Beispiel' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [aTenantChoice(roles)])
}

/** The navigation beside the screen, once the rights of the person have arrived. */
async function sidebar(): Promise<HTMLElement> {
  const nav = screen.getByRole('navigation', { name: 'Hauptbereiche' })

  // Every role of this application reads the texts documents are written from.
  await within(nav).findByRole('link', { name: 'Textbausteine' })

  return nav
}

/** What stands in a navigation, titles and entries, in order; the lit entry with a star. */
function listed(nav: HTMLElement): string[] {
  return [...nav.querySelectorAll('a, div')]
    .filter((node) => node.children.length === 0 || node.tagName === 'A')
    .map(
      (node) =>
        `${node.getAttribute('aria-label') ?? node.textContent}${
          node.getAttribute('aria-current') === 'page' ? ' *' : ''
        }`,
    )
    .filter((text) => text !== '')
}

beforeEach(() => {
  localStorage.clear()
  answers = new Map()
  signedInAs('owner')
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

describe('the header of the office', () => {
  it('names this application and the business', async () => {
    await mount()

    const header = screen.getByRole('banner')

    expect(within(header).getByRole('link', { name: 'OpenGewerk' })).toBeTruthy()
    expect(await within(header).findByText('Elektro Nord GmbH')).toBeTruthy()
  })
})

describe('the navigation of the office', () => {
  const master = ['Stammdaten', 'Kunden *', 'Objekte', 'Anlagen', 'Textbausteine']
  const material = ['Material', 'Artikel', 'Lieferanten']
  const foot = ['Abgleich', 'Abgeglichen, gerade eben']

  it('lists everything for the owner, in the groups of the canvas', async () => {
    await mount()

    const nav = await sidebar()

    await within(nav).findByRole('link', { name: 'Einstellungen' })
    expect(listed(nav)).toEqual([
      ...master,
      'Arbeit',
      'Aufträge',
      'Belege',
      'Aufgaben',
      'Fristen',
      'Zeiterfassung',
      ...material,
      ...foot,
      'Einstellungen',
    ])
  })

  it('lists the same for the office', async () => {
    signedInAs('office')
    await mount()

    const nav = await sidebar()

    await within(nav).findByRole('link', { name: 'Einstellungen' })
    expect(listed(nav)).toEqual([
      ...master,
      'Arbeit',
      'Aufträge',
      'Belege',
      'Aufgaben',
      'Fristen',
      'Zeiterfassung',
      ...material,
      ...foot,
      'Einstellungen',
    ])
  })

  it('leaves the deadlines, the time of the others and the settings out for a technician', async () => {
    signedInAs('technician')
    await mount()

    const nav = await sidebar()

    await within(nav).findByRole('link', { name: 'Lieferanten' })
    expect(listed(nav)).toEqual([
      ...master,
      'Arbeit',
      'Aufträge',
      'Belege',
      'Aufgaben',
      ...material,
      ...foot,
    ])
  })

  /**
   * A business can give a role fewer rights (ADR 0010): the navigation asks
   * the rights and not the role, and a group nobody may enter goes with its
   * title.
   */
  it('goes by the rights the business gives, and drops a group that is left empty', async () => {
    answers.set('/auth/tenants', [aTenantChoice(['technician'], { rights: ['task.read'] })])
    await mount()

    const nav = screen.getByRole('navigation', { name: 'Hauptbereiche' })

    await within(nav).findByRole('link', { name: 'Aufgaben' })
    expect(listed(nav)).toEqual([
      'Stammdaten',
      'Kunden *',
      'Objekte',
      'Anlagen',
      'Arbeit',
      'Aufträge',
      'Aufgaben',
      ...foot,
    ])
  })

  it.each([
    ['/kunden/c-1', 'Kunden'],
    ['/anlagen/i-1', 'Anlagen'],
    ['/pruefprotokolle/p-1', 'Anlagen'],
    ['/auftraege', 'Aufträge'],
  ])('lights at %s the entry %s', async (path, entry) => {
    await mount(path)

    const nav = await sidebar()

    expect(listed(nav).filter((line) => line.endsWith(' *'))).toEqual([`${entry} *`])
  })

  it('counts the open tasks of the person beside "Aufgaben" and the drafts beside "Belege", in words for a reader', async () => {
    await mount('/', (server) => {
      const task = (id: string, assigneeUserId: string, status: string) => ({
        id,
        title: 'Material bestellen',
        dueOn: '2026-09-30',
        assigneeUserId,
        status,
      })

      server.put('tasks', task('t-1', 'u-1', 'open'))
      server.put('tasks', task('t-2', 'u-1', 'open'))
      server.put('tasks', task('t-3', 'u-1', 'done'))
      server.put('tasks', task('t-4', 'u-2', 'open'))
      server.put('documents', { id: 'd-1', status: 'draft' })
      server.put('documents', { id: 'd-2', status: 'issued' })
    })

    const nav = await sidebar()

    expect(
      await within(nav).findByRole('link', { name: 'Aufgaben, 2 für dich offen' }),
    ).toBeTruthy()
    expect(await within(nav).findByRole('link', { name: 'Belege, ein Entwurf' })).toBeTruthy()
  })

  it('says how many where one task or several drafts wait', async () => {
    await mount('/', (server) => {
      server.put('tasks', {
        id: 't-1',
        title: 'Material bestellen',
        dueOn: '2026-09-30',
        assigneeUserId: 'u-1',
        status: 'open',
      })
      server.put('documents', { id: 'd-1', status: 'draft' })
      server.put('documents', { id: 'd-2', status: 'draft' })
      server.put('documents', { id: 'd-3', status: 'draft' })
    })

    const nav = await sidebar()

    expect(
      await within(nav).findByRole('link', { name: 'Aufgaben, eine für dich offen' }),
    ).toBeTruthy()
    expect(await within(nav).findByRole('link', { name: 'Belege, 3 Entwürfe' })).toBeTruthy()
  })

  it('carries no figure where nothing waits', async () => {
    await mount()

    const nav = await sidebar()

    await within(nav).findByRole('link', { name: 'Aufgaben' })
    expect(within(nav).getByRole('link', { name: 'Belege' }).textContent).toBe('Belege')
    expect(within(nav).getByRole('link', { name: 'Aufgaben' }).textContent).toBe('Aufgaben')
  })
})

describe('the screens that are worked in', () => {
  /**
   * The structure of an installation, electrical and PV (#300): from 1024
   * pixels these take the width of the navigation and put their path into
   * the header.
   */
  it.each(['/verteiler/b-1', '/stromkreise/c-1', '/wechselrichter/w-1', '/strings/s-1'])(
    'take the place of the navigation at %s',
    async (path) => {
      await mount(path)

      expect(await screen.findByText('mit Platz in der Kopfleiste')).toBeTruthy()
      expect(screen.queryByRole('navigation', { name: 'Hauptbereiche' })).toBeNull()
    },
  )

  it.each(['/', '/anlagen/i-1', '/pruefprotokolle/p-1'])(
    'are not the screen at %s, which keeps the navigation',
    async (path) => {
      await mount(path)

      expect(screen.getByText('ohne Platz in der Kopfleiste')).toBeTruthy()
      expect(screen.getByRole('navigation', { name: 'Hauptbereiche' })).toBeTruthy()
    },
  )
})

describe('the strip for a backup that is behind', () => {
  it('stands over every office screen, under the header and before the navigation', async () => {
    answers.set('/settings/backup', { state: 'none', overdue: true, time: '02:30' })
    await mount()

    const strip = await screen.findByText('Diese Instanz wurde noch nie gesichert.')
    const header = screen.getByRole('banner')
    const nav = screen.getByRole('navigation', { name: 'Hauptbereiche' })

    expect(header.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(strip.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is not there while the backups are in time', async () => {
    answers.set('/settings/backup', {
      state: 'recorded',
      overdue: false,
      time: '02:30',
      finishedAt: '2026-10-02T00:31:00.000Z',
    })
    await mount()
    await sidebar()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.queryByText(/gesichert/)).toBeNull()
  })
})
