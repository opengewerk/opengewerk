import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { aTenantChoice } from '../../session/test-tenants.js'
import { accessIdentity } from './access-requests.js'
import { PrivacyScreen } from './privacy.js'

/**
 * The requests for access on the screen "Datenschutz" (#318): listed for
 * whoever may give access, recorded for a person found by name with the
 * reminder to check who asks, the answer drawn as a ZIP, and marked answered
 * only once it was.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, { status: number; body: unknown; headers?: Record<string, string> }>

function serverSays(
  method: string,
  path: string,
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): void {
  answers.set(`${method} ${path}`, { status, body, headers })
}

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InRouter>{node}</InRouter>
    </QueryClientProvider>
  )
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'lena@nord.example.de', name: 'Lena Leitung' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [aTenantChoice(roles)])
  serverSays('GET', '/privacy', {
    due: [],
    erasures: [],
    automations: [],
    requests: [],
    leads: true,
  })
}

function aRequest(
  id: string,
  name: string | null,
  values: {
    readonly subject?: 'customer' | 'contact' | 'prospect' | 'person'
    readonly detail?: string
    readonly status?: 'open' | 'answered'
    readonly receivedOn?: string
    readonly channel?: string
    readonly producedAt?: string | null
    readonly answeredAt?: string | null
  },
) {
  return {
    request: {
      id,
      subject: values.subject ?? 'customer',
      subjectId: name === null ? null : `s-${id}`,
      receivedOn: values.receivedOn ?? '2026-11-02',
      channel: values.channel ?? 'email',
      status: values.status ?? 'open',
      answerDueOn: '2026-12-02',
      producedAt: values.producedAt ?? null,
      producedBy: values.producedAt ? 'lena' : null,
      answeredAt: values.answeredAt ?? null,
      createdBy: 'lena',
      createdAt: '2026-11-02T08:00:00.000Z',
    },
    name,
    detail: values.detail ?? 'Kunde, Lindenweg 4, 68535 Edingen-Neckarhausen',
  }
}

const listed = [
  aRequest('a-1', 'Jonas Albrecht', {
    subject: 'person',
    detail: 'Mitarbeiter',
    receivedOn: '2026-10-28',
    channel: 'in_person',
    producedAt: '2026-11-03T09:12:00.000Z',
  }),
  aRequest('a-2', 'Martina Seidel', {}),
  aRequest('a-3', 'Sabine Krüger', {
    subject: 'contact',
    detail: 'Ansprechpartner bei Hausverwaltung Nord',
    receivedOn: '2026-11-03',
    channel: 'letter',
  }),
  aRequest('a-4', 'Gerd Hoffmann', {
    status: 'answered',
    receivedOn: '2026-10-05',
    channel: 'letter',
    producedAt: '2026-10-20T10:00:00.000Z',
    answeredAt: '2026-10-21T10:00:00.000Z',
  }),
]

beforeEach(() => {
  calls = []
  answers = new Map()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T10:00:00Z') })
  serverSays('GET', '/tasks/assignees', [{ userId: 'lena', name: 'Lena Leitung' }])
  serverSays('GET', '/privacy/access-requests', { requests: listed })

  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'

    calls.push({
      path,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    })

    const answer = answers.get(`${method} ${path}`) ?? { status: 200, body: {} }

    return Promise.resolve(
      new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json', ...answer.headers },
      }),
    )
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the requests for access', () => {
  it('list each with whom it is about, how it came in and when the answer is due', async () => {
    signedInAs('owner')
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Auskunftsanfragen' })

    await within(table).findByText('Jonas Albrecht')

    const rows = within(table).getAllByRole('row').slice(1)

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Jonas Albrecht'),
      expect.stringContaining('Martina Seidel'),
      expect.stringContaining('Sabine Krüger'),
      expect.stringContaining('Gerd Hoffmann'),
    ])
    expect(
      within(table).getByText(
        'Mitarbeiter · Eingegangen am 28.10.2026 persönlich · ZIP erstellt am 03.11.2026',
      ),
    ).toBeTruthy()
    expect(
      within(table).getByText(
        'Ansprechpartner bei Hausverwaltung Nord · Eingegangen am 03.11.2026 per Brief',
      ),
    ).toBeTruthy()
    expect(within(table).getAllByText('Antwort bis 02.12.2026')).toHaveLength(3)
    expect(within(table).getByText('Beantwortet am 21.10.2026')).toBeTruthy()
    expect(screen.getByText(new RegExp(accessIdentity.slice(0, 40)))).toBeTruthy()
  })

  it('are not there for whoever may not give access', async () => {
    signedInAs('office')
    render(inQueries(<PrivacyScreen />))

    await screen.findByRole('heading', { name: 'Aufbewahrungsfristen' })

    expect(screen.queryByText('Auskunftsanfragen')).toBeNull()
    expect(calls.some((call) => call.path.startsWith('/privacy/access-requests'))).toBe(false)
  })

  it('offer "Beantwortet" only once the answer was drawn, and ask before', async () => {
    signedInAs('owner')
    serverSays('POST', '/privacy/access-requests/a-1/answer', listed[0])
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Auskunftsanfragen' })

    await within(table).findByText('Jonas Albrecht')
    expect(within(table).getAllByRole('button', { name: 'Beantwortet' })).toHaveLength(1)

    const user = userEvent.setup()
    await user.click(within(table).getByRole('button', { name: 'Beantwortet' }))

    const question = await screen.findByRole('alertdialog', {
      name: 'Auskunft an Jonas Albrecht beantwortet?',
    })

    expect(question.textContent).toContain('die Auskunft vom 03.11.2026 bekommen hat')
    expect(calls.some((call) => call.method === 'POST')).toBe(false)

    await user.click(within(question).getByRole('button', { name: 'Beantwortet' }))

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
        '/privacy/access-requests/a-1/answer',
      ])
    })
  })

  it('draw the answer with a POST and hand it to the browser under its name', async () => {
    signedInAs('owner')
    serverSays('POST', '/privacy/access-requests/a-2/report', 'PK', 201, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Auskunft.zip"; filename*=UTF-8''${encodeURIComponent('Auskunft Martina Seidel 2026-11-04.zip')}`,
    })

    const saved: string[] = []
    const made = vi.fn(() => 'blob:auskunft')

    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: made, revokeObjectURL: vi.fn() }))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download)
    })
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Auskunftsanfragen' })
    const row = (await within(table).findByText('Martina Seidel')).closest('tr') as HTMLElement
    const user = userEvent.setup()

    await user.click(within(row).getByRole('button', { name: 'Herunterladen' }))

    await waitFor(() => {
      expect(saved).toEqual(['Auskunft Martina Seidel 2026-11-04.zip'])
    })
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      '/privacy/access-requests/a-2/report',
    ])
  })

  it('are recorded for a person found by name, with the reminder to check who asks', async () => {
    const brandt = '0193f2a0-0000-7000-8000-000000000009'

    signedInAs('owner')
    serverSays('GET', '/privacy/access-requests/subjects?q=Sab', {
      hits: [
        {
          subject: 'contact',
          id: '0193f2a0-0000-7000-8000-00000000000a',
          name: 'Sabine Krüger',
          detail: 'Ansprechpartner bei Hausverwaltung Nord',
        },
        {
          subject: 'customer',
          id: brandt,
          name: 'Sabine Brandt',
          detail: 'Kunde, Am Ring 3, 68526 Ladenburg',
        },
      ],
    })
    serverSays('POST', '/privacy/access-requests', listed[2], 201)
    render(inQueries(<PrivacyScreen />))

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Anfrage erfassen' }))

    const dialog = await screen.findByRole('dialog', { name: 'Auskunftsanfrage erfassen' })

    expect(within(dialog).getByRole('note').textContent).toBe(accessIdentity)

    // Without a person nothing is sent.
    await user.click(within(dialog).getByRole('button', { name: 'Erfassen' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Wer die Auskunft möchte, ist niemand aus der Liste.',
    )

    await user.type(within(dialog).getByRole('combobox', { name: /Person/ }), 'Sab')
    await user.click(await within(dialog).findByRole('option', { name: /Sabine Brandt/ }))
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Weg' }), 'letter')
    await user.click(within(dialog).getByRole('button', { name: 'Erfassen' }))

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toEqual([
        {
          path: '/privacy/access-requests',
          method: 'POST',
          body: {
            subject: 'customer',
            subjectId: brandt,
            receivedOn: '2026-11-04',
            channel: 'letter',
          },
        },
      ])
    })
  })
})
