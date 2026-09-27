import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { fakePushBrowser as aBrowser, forgetPushBrowser } from '../../app/test-push.js'
import type { PushOverview } from '../../session/push.js'
import { PushPanel } from './account-push.js'

/**
 * The card "Benachrichtigungen" under "Konto" (#284), as the board "Konto"
 * draws it: push on this device, a test message, and the occasions for every
 * device. The browser is a stand in: its permission, its service worker and
 * its push manager are what a test sets.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, { status: number; body: unknown }>

function serverSays(method: string, path: string, body: unknown, status = 200): void {
  answers.set(`${method} ${path}`, { status, body })
}

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InRouter>{node}</InRouter>
    </QueryClientProvider>
  )
}

const occasions = [
  {
    key: 'task_due',
    label: 'Fällige Aufgaben',
    about: 'Am Morgen des Tages, an dem eine Aufgabe für dich fällig ist.',
    on: true,
  },
  {
    key: 'deadline_due',
    label: 'Fristen',
    about: 'Wenn eine Frist, für die du verantwortlich bist, erinnert.',
    on: true,
  },
] as const

function anOverview(over: Partial<PushOverview> = {}): PushOverview {
  return {
    available: true,
    publicKey: 'BAAB',
    occasions: [...occasions],
    devices: [],
    ...over,
  }
}

const aDevice = {
  id: 'p-1',
  label: 'Chrome auf Windows',
  entry: 'office' as const,
  since: '2037-09-27T08:00:00.000Z',
  thisSession: true,
}

beforeEach(() => {
  calls = []
  answers = new Map()
  serverSays('GET', '/push', anOverview())

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
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
  forgetPushBrowser()
})

describe('the card "Benachrichtigungen"', () => {
  it('says so when the instance sends no push', async () => {
    aBrowser({ subscribed: false })
    serverSays('GET', '/push', anOverview({ available: false, publicKey: null }))
    render(inQueries(<PushPanel />))

    expect(await screen.findByText(/Diese Instanz verschickt keine Push-Nachrichten/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Auf diesem Gerät einschalten' })).toBeNull()
  })

  it('switches push on here: asks the browser, subscribes and hands the device over', async () => {
    const browser = aBrowser({ subscribed: false })
    serverSays('PUT', '/push/subscription', { id: 'p-1' })
    render(inQueries(<PushPanel />))

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Auf diesem Gerät einschalten' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'BPublic', auth: 'Secret' },
        entry: 'office',
        label: expect.any(String) as unknown,
      })
    })
    expect(browser.registration.pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    )
  })

  it('shows it on here, sends a test and switches it off', async () => {
    const browser = aBrowser({ subscribed: true })
    serverSays('GET', '/push', anOverview({ devices: [aDevice] }))
    serverSays('POST', '/push/test', { sent: 1, failed: 0 })
    serverSays('DELETE', '/push/subscriptions/p-1', { id: 'p-1' })
    render(inQueries(<PushPanel />))

    expect(await screen.findByText('Auf diesem Gerät eingeschaltet')).toBeTruthy()
    expect(screen.getByText('Chrome auf Windows, seit 27.09.2037')).toBeTruthy()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Probenachricht senden' }))

    expect(await screen.findByText('Gesendet an 1 Gerät.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Ausschalten' }))

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    })
    expect(browser.subscription.unsubscribe).toHaveBeenCalled()
  })

  it('says what the browser refused', async () => {
    aBrowser({ subscribed: false, permission: 'denied' })
    render(inQueries(<PushPanel />))

    expect(
      await screen.findByText(/Der Browser lässt für diese Seite keine Benachrichtigungen zu/),
    ).toBeTruthy()
  })

  it('switches an occasion off for every device', async () => {
    aBrowser({ subscribed: false })
    serverSays('PUT', '/push/occasions/task_due', [{ ...occasions[0], on: false }, occasions[1]])
    render(inQueries(<PushPanel />))

    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: /Fällige Aufgaben/ }))

    await waitFor(() => {
      expect(calls.find((call) => call.path === '/push/occasions/task_due')?.body).toEqual({
        on: false,
      })
    })
    expect(
      (screen.getByRole('checkbox', { name: /Fällige Aufgaben/ }) as HTMLInputElement).checked,
    ).toBe(false)
  })
})
