import type { RoleKey } from '@opengewerk/domain'
import { SettingsScreen } from '@opengewerk/platform-web/office'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InApplication } from '../../app/in-application.js'
import { aTenantChoice } from '../../session/test-tenants.js'

/**
 * The page "Einstellungen": one entry per settings screen, and only the ones
 * the person may read.
 */

let answers: Map<string, unknown>

function signedInAs(...roles: RoleKey[]) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [aTenantChoice(roles)])
}

function mount() {
  const root = createRootRoute({ component: Outlet })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/einstellungen',
        component: SettingsScreen,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/einstellungen'] }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={client}>
      <InApplication>
        <RouterProvider router={router} />
      </InApplication>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  answers = new Map()

  vi.stubGlobal('fetch', (path: string) =>
    Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the settings', () => {
  it('list every screen for the owner, the access list and the change log included', async () => {
    signedInAs('owner')
    mount()

    await screen.findByRole('link', { name: /Zugänge/ })

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/einstellungen/briefkopf',
      '/einstellungen/steuern',
      '/einstellungen/nummernkreise',
      '/einstellungen/zahlungsziel',
      '/einstellungen/tags',
      '/einstellungen/fristen',
      '/einstellungen/belehrungen',
      '/einstellungen/regiebericht',
      '/einstellungen/e-mail',
      '/einstellungen/sicherung',
      '/einstellungen/zugaenge',
      '/einstellungen/protokoll',
    ])
  })

  /**
   * Each entry names the right it takes, and the foundation lists by them
   * (ADR 0010). Which right that is, this application says, and with it who
   * sees what: the settings whoever may read settings, the access list the
   * owner, the change log whoever may read it.
   */
  it('leave the access list and the change log out for the office', async () => {
    signedInAs('office')
    mount()

    await screen.findByRole('link', { name: /Nummernkreise/ })

    expect(screen.queryByRole('link', { name: /Zugänge/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Änderungsprotokoll/ })).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(10)
  })

  it('offer a technician none of them', async () => {
    signedInAs('technician')
    mount()

    await screen.findByText('Was dieser Betrieb für sich festlegt.')
    // The rights of the session have arrived by the time the business is
    // known by name; nothing on this screen shows it, so it is waited out.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(screen.queryAllByRole('link')).toEqual([])
  })
})
