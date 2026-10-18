import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../in-router.js'
import { InProbe } from '../probe-application.js'
import type { PushOverview } from '../session/push.js'
import { fakePushBrowser as aBrowser, forgetPushBrowser } from '../session/test-push.js'
import { PushPanel, type PushPanelWords } from './push-panel.js'

/**
 * The card "Benachrichtigungen" of the account (#284): push on this device, a
 * test message, and the occasions for every device. The browser is a stand
 * in: its permission, its service worker and its push manager are what a
 * test sets. What only an application can say comes in as words.
 */

const words: PushPanelWords = {
  about: 'Eine Nachricht kommt auch, wenn Probewerk zu ist, und nennt kein Regal.',
  keyMissing: 'Wer das Probewerk aufgestellt hat, legt ihn an.',
  footnote: 'Pakete melden sich immer am Schalter.',
}

function thePanel() {
  return <PushPanel entry="office" words={words} />
}

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
      <InProbe>
        <InRouter>{node}</InRouter>
      </InProbe>
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
    render(inQueries(thePanel()))

    expect(
      await screen.findByText(
        'Diese Instanz verschickt keine Push-Nachrichten, ihr fehlt der Schlüssel dafür. Wer das Probewerk aufgestellt hat, legt ihn an.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Auf diesem Gerät einschalten' })).toBeNull()
  })

  it('switches push on here: asks the browser, subscribes and hands the device over', async () => {
    const browser = aBrowser({ subscribed: false })
    serverSays('PUT', '/push/subscription', { id: 'p-1' })
    render(inQueries(thePanel()))

    // Before it is turned on, the person reads which service carries it, and where (opengewerk-haustechnik#390).
    expect(await screen.findByText(/über den Push-Dienst des Browser-Herstellers/)).toBeTruthy()
    expect(screen.getByText(/Alle vier haben ihren Sitz in den USA/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Datenschutzhinweise' }).getAttribute('href')).toBe(
      '/rechtliches/datenschutz',
    )

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
    render(inQueries(thePanel()))

    expect(await screen.findByText('Auf diesem Gerät eingeschaltet')).toBeTruthy()
    expect(screen.getByText('Chrome auf Windows, seit 27.09.2037')).toBeTruthy()
    expect(screen.queryByText(/über den Push-Dienst des Browser-Herstellers/)).toBeNull()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Probenachricht senden' }))

    expect(await screen.findByText('Gesendet an 1 Gerät.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Ausschalten' }))

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    })
    expect(browser.subscription.unsubscribe).toHaveBeenCalled()
  })

  it('says what the application says about push, and names it where a phone has to install it', async () => {
    aBrowser({ subscribed: false })
    const agent = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    render(inQueries(thePanel()))

    expect(
      await screen.findByText(
        'Eine Nachricht kommt auch, wenn Probewerk zu ist, und nennt kein Regal.',
      ),
    ).toBeTruthy()
    expect(await screen.findByText(/nur, wenn Probewerk über „Zum Home-Bildschirm“/)).toBeTruthy()
    expect(
      screen.getByText(
        'Die Anlässe gelten für jedes Gerät, auf dem Push eingeschaltet ist. Pakete melden sich immer am Schalter.',
      ),
    ).toBeTruthy()

    agent.mockRestore()
  })

  it('says what the browser refused', async () => {
    aBrowser({ subscribed: false, permission: 'denied' })
    render(inQueries(thePanel()))

    expect(
      await screen.findByText(/Der Browser lässt für diese Seite keine Benachrichtigungen zu/),
    ).toBeTruthy()
  })

  it('switches an occasion off for every device', async () => {
    aBrowser({ subscribed: false })
    serverSays('PUT', '/push/occasions/task_due', [{ ...occasions[0], on: false }, occasions[1]])
    render(inQueries(thePanel()))

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
