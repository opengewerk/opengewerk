import type { BackupStatus, RoleKey } from '@opengewerk/domain'
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
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BackupBar, BackupScreen } from './backup.js'

/**
 * The backups of the instance in the office (#130): the screen "Sicherung",
 * and the line at the top of every screen when they are behind.
 */

let answers: Map<string, unknown>
let asked: string[]

/** Until the screen has had every answer it asked for, and rendered it. */
async function settled(path: string) {
  await vi.waitFor(() => {
    expect(asked).toContain(path)
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function signedInAs(...roles: RoleKey[]) {
  answers.set('/api/auth/get-session', {
    user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
    session: { activeTenantId: 't-1' },
  })
  answers.set('/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

function backup(status: BackupStatus) {
  answers.set('/settings/backup', status)
}

function mount(content: ReactNode) {
  const root = createRootRoute({ component: Outlet })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: () => content }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const recorded = {
  state: 'recorded',
  finishedAt: '2026-09-23T00:31:12.000Z',
  archive: 'opengewerk-2026-09-23T003112Z.tar.gz.age',
  bytes: 12_400_000,
  encrypted: true,
  overdue: false,
} as const

beforeEach(() => {
  answers = new Map()
  asked = []
  signedInAs('owner')

  vi.stubGlobal('fetch', (path: string) => {
    asked.push(path)

    return Promise.resolve(
      new Response(JSON.stringify(answers.get(path) ?? {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the screen "Sicherung"', () => {
  it('names the last backup, its archive and its size', async () => {
    backup(recorded)
    mount(<BackupScreen />)

    expect(
      await screen.findByText('opengewerk-2026-09-23T003112Z.tar.gz.age, 12,4 MB'),
    ).toBeDefined()
    expect(screen.getByText('Ja')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says when the last one is too old, and that an archive in the clear holds customer data', async () => {
    backup({ ...recorded, encrypted: false, overdue: true })
    mount(<BackupScreen />)

    expect((await screen.findByRole('alert')).textContent).toContain('älter als zwei Tage')
    expect(screen.getByText(/liegt unverschlüsselt/)).toBeDefined()
  })

  it('waits calmly for the first night of a new business, and not for one of days', async () => {
    backup({ state: 'none', overdue: false })
    mount(<BackupScreen />)

    expect(await screen.findByText(/Die erste läuft in der kommenden Nacht/)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says that it knows nothing, where the instance knows no record', async () => {
    backup({ state: 'unknown' })
    mount(<BackupScreen />)

    expect(await screen.findByText(/weiß nichts über Sicherungen/)).toBeDefined()
  })
})

describe('the line at the top of the office', () => {
  it('warns the office when the last backup is more than two days old', async () => {
    signedInAs('office')
    backup({ ...recorded, overdue: true })
    mount(<BackupBar />)

    expect((await screen.findByRole('alert')).textContent).toContain('älter als zwei Tage')
    expect(screen.getByRole('link', { name: 'Ansehen' }).getAttribute('href')).toBe(
      '/einstellungen/sicherung',
    )
  })

  it('says nothing while the backups are on time, or where nothing is known', async () => {
    for (const status of [recorded, { state: 'unknown' } as const]) {
      backup(status)
      mount(<BackupBar />)

      // The answer has to be in before the absence of the line means anything.
      await settled('/settings/backup')
      expect(screen.queryByRole('alert')).toBeNull()
      asked = []
    }
  })

  it('is not there for a technician, who reads no settings and is not asked', async () => {
    signedInAs('technician')
    backup({ state: 'none', overdue: true })
    mount(<BackupBar />)

    await settled('/auth/tenants')
    expect(asked).not.toContain('/settings/backup')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
