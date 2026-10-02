import 'fake-indexeddb/auto'

import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { Shell } from '../components/surface.js'
import { probeClient } from '../in-frame.js'
import { InRouter } from '../in-router.js'
import { SyncProvider } from '../sync/provider.js'
import { TestServer } from '../sync/test-server.js'
import { SiteHeader } from './header.js'

/**
 * The slate header of a screen below the tabs: its title, the line under it,
 * the way back and "Offline" while nothing gets through.
 *
 * Where the way back leads is the application's to say (ADR 0010), which has
 * the routes: the header is handed it. In a frame the header is drawn above
 * the screen; here, as in a test of one screen, it stands in place.
 */

async function shown(node: ReactNode, server: TestServer = new TestServer()) {
  const client = await probeClient(server)

  const result = render(
    <SyncProvider client={client}>
      <Shell entry="site">
        <InRouter at="/regale/s-1">{node}</InRouter>
      </Shell>
    </SyncProvider>,
  )

  await screen.findByRole('banner')

  return result
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
})
