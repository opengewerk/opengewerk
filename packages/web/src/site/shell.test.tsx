import 'fake-indexeddb/auto'

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
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InApplication } from '../app/in-application.js'
import { fakePushBrowser, forgetPushBrowser } from '../app/test-push.js'
import { aTenantChoice } from '../session/test-tenants.js'
import { SyncClient, stopwatchName } from '../sync/client.js'
import { SiteHeader } from './header.js'
import { SiteShell } from './shell.js'

/**
 * The shell of the site as the boards draw it (#217). The frame is the
 * foundation's and has its tests there (ADR 0010); here is what this
 * application hands in: its places among the tabs, where the way back leads
 * from each of its screens, the stopwatch under the header, and push on this
 * device in the menu.
 */

let answers: Map<string, unknown>
let counter = 0

async function mount(path = '/') {
  const server = new TestServer()
  const client = await SyncClient.start({
    store: await openLocalStore(`baustelle${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'phone',
    entities: [],
    onSignedOut: () => {},
  })

  await client.synchronise()

  const root = createRootRoute({ component: SiteShell })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => <h1>Offene Aufträge</h1>,
      }),
      // Every screen below the tabs, whatever its address: it names itself
      // and takes its way back from where it stands.
      createRoute({
        getParentRoute: () => root,
        path: '$',
        component: () => <SiteHeader title="Ein Bildschirm" sub="darunter eine Zeile" />,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InApplication>
        <SyncProvider client={client}>
          <RouterProvider router={router} />
        </SyncProvider>
      </InApplication>
    </QueryClientProvider>,
  )

  await screen.findByRole('heading', { level: 1 })

  return { router, client }
}

/** The tabs at the bottom of a phone, with what a reader hears and which one is lit. */
function tabs(): string[] {
  const bottom = screen.getAllByRole('navigation', { name: 'Bereiche' })[1]

  if (!bottom) {
    throw new Error('no tabs')
  }

  return within(bottom)
    .getAllByRole('link')
    .map((link) => `${link.textContent}${link.getAttribute('aria-current') === 'page' ? ' *' : ''}`)
}

beforeEach(() => {
  localStorage.clear()
  answers = new Map<string, unknown>([
    [
      '/api/auth/get-session',
      {
        user: { id: 'u-1', email: 'anna@nord.example.de', name: 'Anna Weber' },
        session: { activeTenantId: 't-1' },
      },
    ],
    ['/auth/tenants', [aTenantChoice(['technician'])]],
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
  forgetPushBrowser()
})

describe('the tabs on site', () => {
  it('lead to the jobs, the scan and the times, before the conflicts', async () => {
    await mount()

    expect(tabs()).toEqual(['Aufträge *', 'Scannen', 'Zeiten', 'Konflikte'])
    expect(
      within(screen.getAllByRole('navigation', { name: 'Bereiche' })[1] as HTMLElement)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/', '/scannen', '/zeiten', '/konflikte'])
  })

  /**
   * "Aufträge" stays lit on every screen of a job, which is where the way
   * back leads, and "Scannen" on the installation a QR label opened and
   * below it (#308).
   */
  it.each([
    ['/auftraege/j-1', 'Aufträge'],
    ['/auftraege/j-1/berichte/d-1', 'Aufträge'],
    ['/scannen', 'Scannen'],
    ['/anlagen/i-1', 'Scannen'],
    ['/anlagen/i-1/verteiler/b-1', 'Scannen'],
    ['/zeiten', 'Zeiten'],
    ['/zeiten/2026-10-01/nachtragen', 'Zeiten'],
  ])('keep at %s the tab %s lit', async (path, lit) => {
    await mount(path)

    expect(tabs().filter((tab) => tab.endsWith(' *'))).toEqual([`${lit} *`])
  })
})

describe('the header of a screen on site', () => {
  it('names the screen with its line', async () => {
    await mount('/auftraege/j-1')

    const header = screen.getByRole('banner')

    expect(within(header).getByRole('heading', { name: 'Ein Bildschirm' })).toBeTruthy()
    expect(within(header).getByText('darunter eine Zeile')).toBeTruthy()
  })

  /**
   * One step up from wherever a screen stands: a screen of a job to the job,
   * the job to the list, what hangs in the structure of an installation to
   * what it hangs under, below a job and below an installation a QR label
   * opened alike (#308).
   */
  it.each([
    ['/auftraege/j-1', 'Zurück zu den Aufträgen', '/'],
    ['/auftraege/j-1/berichte/d-1', 'Zurück zum Auftrag', '/auftraege/j-1'],
    ['/auftraege/j-1/pruefprotokolle/r-1', 'Zurück zum Auftrag', '/auftraege/j-1'],
    ['/auftraege/j-1/dateien', 'Zurück zum Auftrag', '/auftraege/j-1'],
    ['/auftraege/j-1/notiz', 'Zurück zum Auftrag', '/auftraege/j-1'],
    ['/auftraege/j-1/verteiler/b-1', 'Zurück zum Auftrag', '/auftraege/j-1'],
    [
      '/auftraege/j-1/verteiler/b-1/stromkreise/c-1',
      'Zurück zum Verteiler',
      '/auftraege/j-1/verteiler/b-1',
    ],
    ['/auftraege/j-1/wechselrichter/w-1', 'Zurück zum Auftrag', '/auftraege/j-1'],
    [
      '/auftraege/j-1/wechselrichter/w-1/strings/s-1',
      'Zurück zum Wechselrichter',
      '/auftraege/j-1/wechselrichter/w-1',
    ],
    [
      '/auftraege/j-1/wechselrichter/w-1/strings/s-1/scannen',
      'Zurück zum String',
      '/auftraege/j-1/wechselrichter/w-1/strings/s-1',
    ],
    ['/anlagen/i-1', 'Zurück zum Scannen', '/scannen'],
    ['/anlagen/i-1/verteiler/b-1', 'Zurück zur Anlage', '/anlagen/i-1'],
    [
      '/anlagen/i-1/verteiler/b-1/stromkreise/c-1',
      'Zurück zum Verteiler',
      '/anlagen/i-1/verteiler/b-1',
    ],
    ['/anlagen/i-1/wechselrichter/w-1', 'Zurück zur Anlage', '/anlagen/i-1'],
    [
      '/anlagen/i-1/wechselrichter/w-1/strings/s-1',
      'Zurück zum Wechselrichter',
      '/anlagen/i-1/wechselrichter/w-1',
    ],
    [
      '/anlagen/i-1/wechselrichter/w-1/strings/s-1/scannen',
      'Zurück zum String',
      '/anlagen/i-1/wechselrichter/w-1/strings/s-1',
    ],
    ['/zeiten/2026-10-01/nachtragen', 'Zurück zu den Zeiten', '/zeiten/2026-10-01'],
    ['/zeiten/2026-10-01/korrigieren/e-1', 'Zurück zu den Zeiten', '/zeiten/2026-10-01'],
  ])('leads from %s with "%s" to %s', async (path, label, target) => {
    const { router } = await mount(path)
    const links = within(screen.getByRole('banner')).getAllByRole('link')

    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([label])
    expect(links[0]?.getAttribute('href')).toBe(target)

    await userEvent.click(links[0] as HTMLElement)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(target)
    })
  })

  it('has no way back on a screen none leads from', async () => {
    await mount('/zeiten')

    expect(within(screen.getByRole('banner')).queryByRole('link')).toBeNull()
  })
})

describe('the stopwatch', () => {
  it('runs under the header of every screen and over the screen, once it runs', async () => {
    const { client } = await mount('/auftraege/j-1')

    expect(screen.queryByRole('region', { name: 'Zeitnehmer' })).toBeNull()

    await client.keep(
      stopwatchName,
      JSON.stringify({
        kind: 'break',
        jobId: null,
        userId: 'u-1',
        startedAt: new Date().toISOString(),
      }),
    )

    const stopwatch = await screen.findByRole('region', { name: 'Zeitnehmer' })
    const header = screen.getByRole('banner')
    const main = screen.getByRole('main')

    expect(
      header.compareDocumentPosition(stopwatch) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(stopwatch.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the menu on site', () => {
  it('says who works where, and carries push on this device before the way to the office', async () => {
    fakePushBrowser({ subscribed: true })
    // `fakePushBrowser` sets the browser up; the server is this one again.
    vi.stubGlobal('fetch', (path: string) =>
      Promise.resolve(
        new Response(JSON.stringify(answers.get(path) ?? {}), {
          status: answers.has(path) ? 200 : 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    answers.set('/push', {
      available: true,
      publicKey: 'BAAB',
      occasions: [{ key: 'task_due', label: 'Fällige Aufgaben', about: 'Am Morgen', on: true }],
      devices: [
        {
          id: 'p-1',
          label: 'Chrome auf Android',
          entry: 'site',
          since: '2037-09-27T08:00:00.000Z',
          thisSession: true,
        },
      ],
    })
    await mount()

    await userEvent.click(screen.getAllByRole('button', { name: 'Menü' })[0] as HTMLElement)

    const sheet = screen.getByRole('dialog', { name: 'Menü' })

    expect(await within(sheet).findByText('Monteur · Elektro Nord GmbH')).toBeTruthy()

    const push = await within(sheet).findByText('Auf diesem Gerät an')
    const office = within(sheet).getByRole('link', { name: /Zur Büroansicht/ })

    expect(office.getAttribute('href')).toBe('/')
    expect(push.compareDocumentPosition(office) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      within(sheet).getByRole('group', { name: 'Darstellung' }).compareDocumentPosition(push) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
