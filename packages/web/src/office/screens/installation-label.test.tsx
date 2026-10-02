import 'fake-indexeddb/auto'

import type { RecordState, RoleKey } from '@opengewerk/domain'
import { SyncProvider, openLocalStore } from '@opengewerk/platform-web/sync'
import { TestServer } from '@opengewerk/platform-web/testing'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncClient } from '../../sync/client.js'
import { LabelPanel } from './installation-label.js'
import { aTenantChoice } from '../../session/test-tenants.js'

/**
 * The card "QR-Etikett" in the office (#308), the boards "Anlagenakte mit
 * QR-Etikett", "Die Karte QR-Etikett in ihren Zuständen" and "Rückfrage vor
 * dem Sperren eines Etiketts": making a label, printing it for a label printer
 * or a sheet, and blocking it for good.
 */

let server: TestServer
let counter = 0
let roles: RoleKey[]
let calls: string[]

const valid: RecordState = {
  id: 'l-1',
  installationId: 'i-1',
  code: '7K2M9QX4TBA3HW8P',
  blockedAt: null,
  createdAt: '2026-09-28T09:00:00.000Z',
}

function answer(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

async function mount(labels: readonly RecordState[]) {
  server.put('installations', {
    id: 'i-1',
    siteId: 's-1',
    kind: 'meter_cabinet',
    designation: 'Zählerschrank, Keller',
  })

  for (const label of labels) {
    server.put('installation_labels', label)
  }

  const client = await SyncClient.start({
    store: await openLocalStore(`office-label${String((counter += 1))}`),
    transport: server,
    writer: server,
    deviceId: 'office-computer',
    entities: ['installations', 'installation_labels'],
    onSignedOut: () => {},
  })

  await client.synchronise()

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SyncProvider client={client}>
        <LabelPanel installationId="i-1" />
      </SyncProvider>
    </QueryClientProvider>,
  )

  return client
}

function card() {
  return screen.findByRole('region', { name: 'QR-Etikett' })
}

beforeEach(() => {
  server = new TestServer()
  roles = ['office']
  calls = []
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`

    calls.push(key)

    if (key === 'GET /api/auth/get-session') {
      return answer({
        user: { id: 'u-1', email: 'britta@nord.example.de', name: 'Britta Büro' },
        session: { activeTenantId: 't-1' },
      })
    }

    if (key === 'GET /auth/tenants') {
      return answer([aTenantChoice(roles)])
    }

    if (key === 'POST /installations/i-1/labels') {
      server.put('installation_labels', { ...valid, id: 'l-2', code: 'NEWC0DE0NEWC0DE0' })

      return answer({ id: 'l-2' }, 201)
    }

    if (key === 'POST /installations/i-1/labels/l-1/block') {
      server.put('installation_labels', { ...valid, blockedAt: '2026-09-28T10:00:00.000Z' })

      return answer({ id: 'l-1' }, 201)
    }

    return answer({})
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the card "QR-Etikett"', () => {
  it('makes a label where there is none, and shows it', async () => {
    const user = userEvent.setup()
    await mount([])

    const panel = await card()
    expect(panel.textContent).toContain('Noch kein Etikett.')

    await user.click(await within(panel).findByRole('button', { name: 'Etikett anlegen' }))

    expect(calls).toContain('POST /installations/i-1/labels')
    expect(await within(panel).findByText('NEWC-0DE0-NEWC-0DE0')).toBeTruthy()
  })

  it('shows the valid label with its QR and prints it for a label printer', async () => {
    await mount([valid])

    const panel = await card()
    expect(within(panel).getByText('7K2M-9QX4-TBA3-HW8P')).toBeTruthy()
    expect(within(panel).getByText('Angelegt am 28.09.2026')).toBeTruthy()
    expect(
      within(panel).getByRole('img', { name: 'QR-Code des Etiketts 7K2M-9QX4-TBA3-HW8P' }),
    ).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'PDF öffnen' }).getAttribute('href')).toBe(
      '/installations/i-1/labels/l-1/pdf?format=roll&count=1',
    )
  })

  it('prints on a sheet from the first free field, and names a print it cannot make', async () => {
    const user = userEvent.setup()
    await mount([valid])
    const panel = await card()

    await user.selectOptions(within(panel).getByLabelText('Format'), 'sheet')
    const count = within(panel).getByLabelText('Anzahl')
    await user.clear(count)
    await user.type(count, '3')
    const start = within(panel).getByLabelText('Beginnen bei')
    await user.clear(start)
    await user.type(start, '5')

    expect(within(panel).getByRole('link', { name: 'PDF öffnen' }).getAttribute('href')).toBe(
      '/installations/i-1/labels/l-1/pdf?format=sheet&count=3&start=5',
    )

    await user.clear(count)
    await user.type(count, '0')

    expect(within(panel).getByRole('alert').textContent).toBe(
      'Gedruckt werden 1 bis 24 Etiketten auf einmal.',
    )
    expect(within(panel).queryByRole('link', { name: 'PDF öffnen' })).toBeNull()
    expect(
      (within(panel).getByRole('button', { name: 'PDF öffnen' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('blocks a label only after asking, and names it afterwards as blocked', async () => {
    const user = userEvent.setup()
    await mount([valid])
    const panel = await card()

    await user.click(await within(panel).findByRole('button', { name: 'Sperren' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Etikett sperren?' })
    expect(dialog.textContent).toContain('Sperren lässt sich nicht zurücknehmen')
    expect(calls).not.toContain('POST /installations/i-1/labels/l-1/block')

    await user.click(within(dialog).getByRole('button', { name: 'Sperren' }))

    expect(calls).toContain('POST /installations/i-1/labels/l-1/block')
    expect(
      await within(panel).findByText(
        'Kein gültiges Etikett. Das letzte ist gesperrt und öffnet nichts mehr.',
      ),
    ).toBeTruthy()
    expect(panel.textContent).toContain('Gesperrt am 28.09.2026:')
    expect(within(panel).getByRole('button', { name: 'Neues Etikett anlegen' })).toBeTruthy()
  })

  it('says without a connection that printing and blocking need one', async () => {
    await mount([valid])
    const panel = await card()

    act(() => {
      globalThis.dispatchEvent(new Event('offline'))
    })

    await waitFor(() => {
      expect(
        (within(panel).getByRole('button', { name: 'PDF öffnen' }) as HTMLButtonElement).disabled,
      ).toBe(true)
    })
    expect(panel.textContent).toContain(
      'Drucken und Sperren gehen über den Server, dafür braucht es Verbindung.',
    )
    expect(
      (within(panel).getByRole('button', { name: 'Sperren' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
