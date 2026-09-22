import type { RoleKey } from '@opengewerk/domain'
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

import { SettingsScreen } from './settings.js'

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
  answers.set('/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
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
      <RouterProvider router={router} />
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
  it('list every screen for the owner, the access list included', async () => {
    signedInAs('owner')
    mount()

    await screen.findByRole('link', { name: /Zugänge/ })

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/einstellungen/briefkopf',
      '/einstellungen/steuern',
      '/einstellungen/nummernkreise',
      '/einstellungen/zahlungsziel',
      '/einstellungen/belehrungen',
      '/einstellungen/e-mail',
      '/einstellungen/zugaenge',
    ])
  })

  it('leave the access list out for the office', async () => {
    signedInAs('office')
    mount()

    await screen.findByRole('link', { name: /Nummernkreise/ })

    expect(screen.queryByRole('link', { name: /Zugänge/ })).toBeNull()
  })
})
