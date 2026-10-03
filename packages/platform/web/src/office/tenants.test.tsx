import 'fake-indexeddb/auto'

import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Archive } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenant, inFrame, signedIn, standInServer } from '../in-frame.js'
import type { InFrame, StandIn } from '../in-frame.js'
import { probeApplication } from '../probe-application.js'
import { OfficeFrame } from './frame.js'

/**
 * The switch between the tenants of a person without signing in again (#242),
 * in the header and in the menu on a phone.
 *
 * What a tenant is called and whether somebody may make a further one for
 * themselves is the application's (ADR 0010): its sentence stands over the
 * list, and its link under it for whoever holds the right it names. The
 * application in these tests belongs to nobody.
 */

const one = [aTenant({ name: 'Probewerk Nord', roleLabels: ['Leitung'] })]
const two = [
  aTenant({ name: 'Probewerk Nord', roleLabels: ['Leitung', 'Mitglied'] }),
  aTenant({ id: 't-2', name: 'Probewerk Süd', roleLabels: ['Mitglied'] }),
]

let server: StandIn

function frame(options: InFrame = {}) {
  return inFrame(
    () => (
      <OfficeFrame
        navigation={[{ title: 'Bestand', entries: [{ to: '/', label: 'Regale', icon: Archive }] }]}
      />
    ),
    {
      screens: { '/': () => <h1>Regale</h1>, '/konto': () => <h1>Konto</h1> },
      ...options,
    },
  )
}

/** The button of the tenant in the header, once the list of tenants has arrived. */
function inHeader(name: string): Promise<HTMLElement> {
  return within(screen.getByRole('banner')).findByRole('button', { name })
}

async function header(): Promise<HTMLElement> {
  return screen.findByRole('banner')
}

beforeEach(() => {
  globalThis.localStorage.clear()
  server = standInServer()
  signedIn(server, two)
  server.answer('POST', '/auth/tenant', { tenantId: 't-2' })
  vi.spyOn(globalThis.location, 'assign').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the tenant in the header', () => {
  it('is a name and nothing to press for somebody in one tenant', async () => {
    signedIn(server, one)
    await frame()

    expect(await within(await header()).findByText('Probewerk Nord')).toBeTruthy()
    // The person has a button, the tenant has none.
    await within(await header()).findByRole('button', { name: /Konto und Darstellung/ })
    expect(within(await header()).queryByRole('button', { name: 'Probewerk Nord' })).toBeNull()
  })

  it('opens the list for somebody in several, under the sentence of the application', async () => {
    await frame()
    await header()

    const button = await inHeader('Probewerk Nord')

    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()

    await userEvent.click(button)

    const menu = screen.getByRole('menu', { name: 'Mandant wechseln' })

    expect(button.getAttribute('aria-expanded')).toBe('true')
    // Said for a reader in the name of the menu, and for the eye over the list.
    expect(within(menu).getByText('Mandant wechseln')).toBeTruthy()
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map(
          (row) => `${row.textContent}${row.getAttribute('aria-checked') === 'true' ? ' *' : ''}`,
        ),
    ).toEqual(['Probewerk NordLeitung, Mitglied *', 'Probewerk SüdMitglied'])
  })

  it('moves the session into the one chosen and starts the page again at the office', async () => {
    await frame()
    await header()
    await userEvent.click(await inHeader('Probewerk Nord'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Probewerk Süd/ }))

    await waitFor(() => {
      expect(globalThis.location.assign).toHaveBeenCalledWith('/')
    })
    expect(server.heard.filter((call) => call.path === '/auth/tenant')).toEqual([
      { method: 'POST', path: '/auth/tenant', body: { tenantId: 't-2' } },
    ])
  })

  it('does nothing when the one worked in is chosen', async () => {
    await frame()
    await header()
    await userEvent.click(await inHeader('Probewerk Nord'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Probewerk Nord/ }))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(server.heard.some((call) => call.path === '/auth/tenant')).toBe(false)
    expect(globalThis.location.assign).not.toHaveBeenCalled()
  })

  it('takes no second choice while the first is on its way', async () => {
    // The server keeps the answer to itself, and says when the question is there.
    const held: { release?: () => void } = {}
    const standing = globalThis.fetch
    const disabled = () =>
      screen.getAllByRole('menuitemradio').every((row) => (row as HTMLButtonElement).disabled)

    vi.stubGlobal('fetch', (path: string, init?: RequestInit) =>
      path === '/auth/tenant'
        ? new Promise<Response>((resolve) => {
            held.release = () => {
              resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
            }
          })
        : standing(path, init),
    )

    await frame()
    await header()
    await userEvent.click(await inHeader('Probewerk Nord'))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Probewerk Süd/ }))

    await waitFor(() => {
      expect(disabled()).toBe(true)
    })

    // The question to move the session leaves a while after the click, the
    // outbox first. An answer released before it is there releases nothing,
    // and the question waits for ever: in the CI it did (#502).
    await waitFor(() => {
      expect(held.release).toBeDefined()
    })
    expect(disabled()).toBe(true)

    held.release?.()
    await waitFor(() => {
      expect(globalThis.location.assign).toHaveBeenCalledWith('/')
    })
  })

  it('says so when the session did not move, and can be tried again', async () => {
    server.answer('POST', '/auth/tenant', { message: 'Nicht in diesem Mandanten.' }, 403)
    await frame()
    await header()
    await userEvent.click(await inHeader('Probewerk Nord'))

    const other = screen.getByRole('menuitemradio', { name: /Probewerk Süd/ })

    await userEvent.click(other)

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Der Wechsel ging nicht. Ist der Server erreichbar?',
    )
    expect(globalThis.location.assign).not.toHaveBeenCalled()
    expect((other as HTMLButtonElement).disabled).toBe(false)

    // Closing and opening again takes the sentence away.
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await inHeader('Probewerk Nord'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('closes on Escape and on a click outside', async () => {
    await frame()
    await header()

    const button = await inHeader('Probewerk Nord')

    await userEvent.click(button)
    expect(screen.getByRole('menu')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()

    await userEvent.click(button)
    // A click inside leaves it open.
    await userEvent.click(within(screen.getByRole('menu')).getByText('Mandant wechseln'))
    expect(screen.getByRole('menu')).toBeTruthy()
    await userEvent.click(screen.getByRole('heading', { level: 1 }))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe("the way to a further tenant of one's own", () => {
  it('stands under the list for whoever holds the right the application names, and leads where it says', async () => {
    signedIn(server, [aTenant({ rights: ['tenant.own'] }), ...two.slice(1)])
    const { router } = await frame()

    await header()
    await userEvent.click(await inHeader('Probewerk Nord'))

    const link = await screen.findByRole('menuitem', { name: 'Eigenen Mandanten anlegen' })

    expect(link.getAttribute('href')).toBe('/konto#mandanten')

    await userEvent.click(link)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/konto')
    })
    expect(router.state.location.hash).toBe('mandanten')
    // Followed, the list is closed.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('is not offered to somebody without that right', async () => {
    signedIn(server, [aTenant({ rights: ['shelf.settings'] }), ...two.slice(1)])
    await frame()
    await header()
    await userEvent.click(await inHeader('Probewerk Nord'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('is not there in an application that has none, whatever somebody holds', async () => {
    const { ownTenant: _none, ...without } = probeApplication()

    // Every right there is, and the empty name a missing link would ask for.
    signedIn(server, [aTenant({ rights: ['tenant.own', ''] }), ...two.slice(1)])
    await frame({ application: without })
    await header()
    await userEvent.click(await inHeader('Probewerk Nord'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('leads to a screen as a whole where the application names no place on it', async () => {
    signedIn(server, [aTenant({ rights: ['tenant.own'] }), ...two.slice(1)])
    await frame({
      application: probeApplication({
        ownTenant: { right: 'tenant.own', to: '/konto', label: 'Noch einen Mandanten' },
      }),
    })
    await header()
    await userEvent.click(await inHeader('Probewerk Nord'))

    expect(
      (await screen.findByRole('menuitem', { name: 'Noch einen Mandanten' })).getAttribute('href'),
    ).toBe('/konto')
  })
})

describe('the tenant in the menu of a phone', () => {
  async function drawer(): Promise<HTMLElement> {
    await within(await header()).findByText('Probewerk Nord')
    await userEvent.click(screen.getByRole('button', { name: 'Menü' }))

    return screen.getByRole('dialog', { name: 'Menü' })
  }

  it('is a box with the name for somebody in one tenant', async () => {
    signedIn(server, one)
    await frame()

    const menu = await drawer()

    expect(within(menu).getByText('Probewerk Nord')).toBeTruthy()
    expect(within(menu).queryByRole('button', { name: 'Probewerk Nord' })).toBeNull()
  })

  it('opens the list in place for somebody in several, and closes it again', async () => {
    await frame()

    const menu = await drawer()
    const button = within(menu).getByRole('button', { name: 'Probewerk Nord' })

    expect(button.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(button)

    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(
      within(within(menu).getByRole('menu', { name: 'Mandant wechseln' }))
        .getAllByRole('menuitemradio')
        .map((row) => row.getAttribute('aria-checked')),
    ).toEqual(['true', 'false'])

    await userEvent.click(button)
    expect(within(menu).queryByRole('menu')).toBeNull()
  })

  it('moves the session into the one chosen', async () => {
    await frame()

    const menu = await drawer()

    await userEvent.click(within(menu).getByRole('button', { name: 'Probewerk Nord' }))
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /Probewerk Süd/ }))

    await waitFor(() => {
      expect(globalThis.location.assign).toHaveBeenCalledWith('/')
    })
    expect(server.heard.find((call) => call.path === '/auth/tenant')?.body).toEqual({
      tenantId: 't-2',
    })
  })

  it('says so when the session did not move', async () => {
    server.answer('POST', '/auth/tenant', {}, 500)
    await frame()

    const menu = await drawer()

    await userEvent.click(within(menu).getByRole('button', { name: 'Probewerk Nord' }))
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /Probewerk Süd/ }))

    expect((await within(menu).findByRole('alert')).textContent).toBe(
      'Der Wechsel ging nicht. Ist der Server erreichbar?',
    )
  })

  it('closes the whole menu when the way to a further tenant is followed', async () => {
    signedIn(server, [aTenant({ rights: ['tenant.own'] }), ...two.slice(1)])
    const { router } = await frame()
    const menu = await drawer()

    await userEvent.click(within(menu).getByRole('button', { name: 'Probewerk Nord' }))
    await userEvent.click(
      await within(menu).findByRole('menuitem', { name: 'Eigenen Mandanten anlegen' }),
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/konto')
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
