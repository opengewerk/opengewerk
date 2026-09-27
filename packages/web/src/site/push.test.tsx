import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakePushBrowser, forgetPushBrowser } from '../app/test-push.js'
import type { PushOverview } from '../session/push.js'
import { SitePush } from './push.js'

/**
 * Push in the menu of the site (#284), as the board "Menü" draws it: on or
 * off on this device, and the occasions, for a thumb.
 */

let calls: { path: string; method: string; body: unknown }[]
let overview: PushOverview

function inQueries() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <SitePush />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  calls = []
  overview = {
    available: true,
    publicKey: 'BAAB',
    occasions: [
      { key: 'task_due', label: 'Fällige Aufgaben', about: 'Am Morgen', on: true },
      { key: 'deadline_due', label: 'Fristen', about: 'Wenn sie erinnert', on: true },
    ],
    devices: [],
  }

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    })

    const body = path === '/push' ? overview : { id: 'p-1' }

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  forgetPushBrowser()
})

describe('push in the menu of the site', () => {
  it('switches it on here as a device on site', async () => {
    fakePushBrowser({ subscribed: false })
    render(inQueries())

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Einschalten' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ entry: 'site' })
    })
    expect(screen.getByRole('checkbox', { name: 'Fällige Aufgaben' })).toBeTruthy()
  })

  it('says it is on here, and switches it off', async () => {
    fakePushBrowser({ subscribed: true })
    overview = {
      ...overview,
      devices: [
        {
          id: 'p-1',
          label: 'Chrome auf Android',
          entry: 'site',
          since: '2037-09-27T08:00:00.000Z',
          thisSession: true,
        },
      ],
    }
    render(inQueries())

    expect(await screen.findByText('Auf diesem Gerät an')).toBeTruthy()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Ausschalten' }))

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    })
  })

  it('stays out of the menu on an instance without push', async () => {
    fakePushBrowser({ subscribed: false })
    overview = { ...overview, available: false, publicKey: null }
    render(inQueries())

    await waitFor(() => {
      expect(calls.some((call) => call.path === '/push')).toBe(true)
    })
    expect(screen.queryByText('Benachrichtigungen')).toBeNull()
  })
})
