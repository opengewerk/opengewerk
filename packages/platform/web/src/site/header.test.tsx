import 'fake-indexeddb/auto'

import type { OperationReceipt, SyncConflict } from '@opengewerk/platform-domain'
import { act, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { Shell } from '../components/surface.js'
import { probeClient } from '../in-frame.js'
import { InRouter } from '../in-router.js'
import { SyncProvider } from '../sync/provider.js'
import { TestServer } from '../sync/test-server.js'
import { RequestRefused } from '../sync/transport.js'
import { SiteHeader } from './header.js'

/**
 * The slate header of a screen below the tabs: its title, the line under it,
 * the way back and "Offline" while nothing gets through.
 *
 * Where the way back leads is the application's to say (ADR 0010), which has
 * the routes: the header is handed it. In a frame the header is drawn above
 * the screen; here, as in a test of one screen, it stands in place.
 */

/** Draws the header over a client that has had its first exchange with this server, and hands back the client. */
async function shown(node: ReactNode, server: TestServer = new TestServer()) {
  const client = await probeClient(server)

  render(
    <SyncProvider client={client}>
      <Shell entry="site">
        <InRouter at="/regale/s-1">{node}</InRouter>
      </Shell>
    </SyncProvider>,
  )

  await screen.findByRole('banner')

  return client
}

describe('the header of a screen on site', () => {
  it('names the screen with the line under it, and leads one step back', async () => {
    await shown(
      <SiteHeader
        title="Regal am Fenster"
        sub="Reihe 4, drei Fächer"
        back={{ to: '/regale', label: 'Zurück zu den Regalen' }}
      />,
    )

    const header = screen.getByRole('banner')

    // The one title of the screen.
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Regal am Fenster')
    expect(within(header).getByText('Reihe 4, drei Fächer').tagName).toBe('P')

    const back = within(header).getByRole('link', { name: 'Zurück zu den Regalen' })

    expect(back.getAttribute('href')).toBe('/regale')
    // A symbol and no text: what a reader hears is the name alone.
    expect(back.textContent).toBe('')
  })

  it.each([[undefined], [null]])('has no way back where it is handed %s', async (back) => {
    await shown(<SiteHeader title="Regale" {...(back === undefined ? {} : { back })} />)

    const header = screen.getByRole('banner')

    expect(within(header).queryByRole('link')).toBeNull()
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Regale')
    // And no line where none is given.
    expect(header.querySelector('p')).toBeNull()
  })

  it('says so while nothing gets through', async () => {
    const offline = new TestServer()

    offline.offline = true
    await shown(<SiteHeader title="Regale" />, offline)

    expect(await within(screen.getByRole('banner')).findByText('Offline')).toBeTruthy()
  })

  it('says nothing of the network while the exchange goes through', async () => {
    await shown(<SiteHeader title="Regale" />)

    expect(within(screen.getByRole('banner')).queryByText('Offline')).toBeNull()
  })

  /**
   * "Offline" was asked of the state of the client, which is the same for a
   * server that answered and refused as for one nobody reached: the header
   * claimed a missing network on a device that had one (#545).
   */
  it('says nothing of the network over a server that answered and refused', async () => {
    const refusing = Object.assign(new TestServer(), {
      pull: () => Promise.reject(new RequestRefused(403, 'Abgleichen darf dieser Zugang nicht.')),
    })

    const client = await shown(<SiteHeader title="Regale" />, refusing)

    // The server has answered, and this is its sentence.
    expect(client.status().trouble).toBe('Abgleichen darf dieser Zugang nicht.')
    expect(within(screen.getByRole('banner')).queryByText('Offline')).toBeNull()
  })

  it('says nothing of the network over a change that is on its way', async () => {
    const slow = new TestServer()
    const client = await shown(<SiteHeader title="Regale" />, slow)

    slow.push = () => new Promise<OperationReceipt[]>(() => {})
    await act(() => client.create('notes', { text: 'Unterwegs' }))

    // The change waits in the outbox for its answer, and nothing went wrong.
    expect(client.status().pending).toBe(1)
    expect(client.status().state).toBe('offline')
    expect(within(screen.getByRole('banner')).queryByText('Offline')).toBeNull()
  })

  it('says so while a conflict waits as well', async () => {
    const server = Object.assign(new TestServer(), {
      conflicts: () => Promise.resolve([{ id: 'c-1' }] as unknown as SyncConflict[]),
    })
    const client = await shown(<SiteHeader title="Regale" />, server)

    expect(client.status().state).toBe('conflict')
    expect(within(screen.getByRole('banner')).queryByText('Offline')).toBeNull()

    server.offline = true
    await act(() => client.synchronise())

    // The state of the client still names the conflict, which needs somebody
    // first; the header asks what went wrong, as the list of conflicts does.
    expect(client.status().state).toBe('conflict')
    expect(within(screen.getByRole('banner')).getByText('Offline')).toBeTruthy()
  })
})
