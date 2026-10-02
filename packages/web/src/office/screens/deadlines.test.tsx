import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import type { DeadlineKindView, DeadlineView } from '../../session/deadlines.js'
import { DeadlineSettingsScreen } from './deadline-settings.js'
import { DeadlineListScreen } from './deadlines.js'
import { aTenantChoice } from '../../session/test-tenants.js'

/**
 * The two screens of the deadline engine (#283): the list "Fristen" in the
 * office and "Fristen" in the settings, as the boards `fristen()` and
 * `einst_fristen()` of the canvas draw them.
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

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'britta@nord.example.de', name: 'Britta Büro' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [aTenantChoice(roles)])
}

const followUp: DeadlineKindView = {
  key: 'quote.follow_up',
  title: 'Wiedervorlage eines Angebots',
  about:
    'Ein festgeschriebenes Angebot, auf das noch keine Auftragsbestätigung und keine Rechnung folgt, kommt nach einer Zahl von Tagen wieder vor.',
  trade: null,
  source: 'quote',
  actions: ['task'],
  responsible: 'source',
  intervalDays: 14,
  leadDays: 0,
  setting: { intervalDays: null, leadDays: null, responsibleUserId: null },
}

function aDeadline(over: Partial<DeadlineView> = {}): DeadlineView {
  return {
    id: 'd-1',
    kind: 'quote.follow_up',
    kindTitle: 'Wiedervorlage eines Angebots',
    trade: null,
    status: 'open',
    anchorOn: '2026-09-15',
    dueOn: '2026-09-29',
    remindOn: '2026-09-29',
    leadDays: 0,
    ownLeadDays: null,
    responsible: { userId: 'u-1', name: 'Britta Büro' },
    ownResponsibleUserId: null,
    source: { label: 'A-2026-0091', documentId: 'doc-1', installationId: null },
    customer: { id: 'c-1', name: 'Hausverwaltung Süd GmbH' },
    siteId: null,
    jobId: null,
    remindedFor: null,
    remindedAt: null,
    taskId: null,
    closedAt: null,
    closedBy: null,
    ...over,
  }
}

beforeEach(() => {
  calls = []
  answers = new Map()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-27T10:00:00Z') })

  serverSays('GET', '/deadlines?status=open', [])
  serverSays('GET', '/deadlines/kinds', [followUp])
  serverSays('GET', '/settings/deadlines', [followUp])
  serverSays('GET', '/tasks/assignees', [
    { userId: 'u-1', name: 'Britta Büro', active: true },
    { userId: 'u-2', name: 'Max Monteur', active: true },
    { userId: 'u-3', name: 'Gerd Gesperrt', active: false },
  ])

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
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the list "Fristen"', () => {
  it('lists the open deadlines with source, customer, person and reminder, late ones marked', async () => {
    signedInAs('office')
    serverSays('GET', '/deadlines?status=open', [
      aDeadline({
        id: 'd-0',
        dueOn: '2026-09-23',
        remindOn: '2026-09-23',
        remindedFor: '2026-09-23',
        remindedAt: '2026-09-23T04:00:00Z',
        source: { label: 'A-2026-0088', documentId: 'doc-0', installationId: null },
      }),
      aDeadline(),
    ])
    render(inQueries(<DeadlineListScreen />))

    const table = await screen.findByRole('table', { name: 'Fristen' })

    expect(within(table).getByRole('link', { name: 'Angebot A-2026-0091' })).toBeTruthy()
    expect(within(table).getAllByText('Hausverwaltung Süd GmbH')).toHaveLength(2)
    expect(within(table).getByText('überfällig')).toBeTruthy()
    expect(within(table).getByText('erinnert am 23.09.2026')).toBeTruthy()
    expect(within(table).getByText('am 29.09.2026')).toBeTruthy()
    expect(screen.getByText('2 offen')).toBeTruthy()
  })

  it('asks the server for another state when a chip is pressed', async () => {
    signedInAs('office')
    serverSays('GET', '/deadlines?status=done', [
      aDeadline({ status: 'done', closedAt: '2026-09-26T08:00:00Z' }),
    ])
    render(inQueries(<DeadlineListScreen />))

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Erledigt' }))

    expect(await screen.findByText('erledigt am 26.09.2026')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Wieder öffnen' })).toBeTruthy()
  })

  it('marks a deadline done from its row', async () => {
    signedInAs('office')
    serverSays('GET', '/deadlines?status=open', [aDeadline()])
    render(inQueries(<DeadlineListScreen />))

    const table = await screen.findByRole('table', { name: 'Fristen' })
    const user = userEvent.setup()
    await user.click(within(table).getByRole('button', { name: 'Erledigt' }))

    await waitFor(() => {
      expect(
        calls.some((call) => call.method === 'POST' && call.path === '/deadlines/d-1/done'),
      ).toBe(true)
    })
  })

  it('gives a deadline a lead and a person of its own on the card above the list', async () => {
    signedInAs('office')
    serverSays('GET', '/deadlines?status=open', [aDeadline()])
    serverSays('PATCH', '/deadlines/d-1', { id: 'd-1' })
    render(inQueries(<DeadlineListScreen />))

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Frist zu Angebot A-2026-0091 ändern' }),
    )

    expect(await screen.findByText('Frist: Wiedervorlage eines Angebots, A-2026-0091')).toBeTruthy()
    expect(screen.getByText(/14 Tage nach dem Festschreiben am 15\.09\.2026/)).toBeTruthy()

    await user.type(screen.getByLabelText('Vorlauf in Tagen'), '3')
    await user.selectOptions(screen.getByLabelText('Verantwortlich'), 'u-2')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        leadDays: 3,
        responsibleUserId: 'u-2',
      })
    })
  })

  it('refuses a lead that is no lead before anything is sent', async () => {
    signedInAs('office')
    serverSays('GET', '/deadlines?status=open', [aDeadline()])
    render(inQueries(<DeadlineListScreen />))

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Frist zu Angebot A-2026-0091 ändern' }),
    )
    await user.type(await screen.findByLabelText('Vorlauf in Tagen'), '400')

    expect(screen.getByText('Der Vorlauf ist höchstens 365 Tage lang.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Speichern' }).hasAttribute('disabled')).toBe(true)
  })

  it('says that nothing is open, and how a deadline comes about', async () => {
    signedInAs('office')
    render(inQueries(<DeadlineListScreen />))

    expect(
      await screen.findByText(
        /Gerade ist keine Frist offen\. Sobald ein Angebot festgeschrieben ist/,
      ),
    ).toBeTruthy()
  })

  it('is not for a technician', async () => {
    signedInAs('technician')
    render(inQueries(<DeadlineListScreen />))

    expect(await screen.findByText('Fristen sehen darf dieser Zugang nicht.')).toBeTruthy()
    expect(calls.some((call) => call.path.startsWith('/deadlines'))).toBe(false)
  })
})

describe('"Fristen" in the settings', () => {
  it('shows each kind with its interval, lead, person and what it does', async () => {
    signedInAs('owner')
    render(inQueries(<DeadlineSettingsScreen />))

    expect(await screen.findByText('Wiedervorlage eines Angebots')).toBeTruthy()
    expect((screen.getByLabelText('Wiedervorlage nach') as HTMLInputElement).value).toBe('14')
    expect((screen.getByLabelText('Vorlauf') as HTMLInputElement).value).toBe('0')
    expect(
      screen.getByText('Bei Fälligkeit: eine Aufgabe für die verantwortliche Person.'),
    ).toBeTruthy()
    expect(
      within(screen.getByLabelText('Verantwortlich')).getByRole('option', {
        name: 'Wer das Angebot festgeschrieben hat',
      }),
    ).toBeTruthy()
    // Nobody blocked is offered.
    expect(
      within(screen.getByLabelText('Verantwortlich')).queryByRole('option', {
        name: 'Gerd Gesperrt',
      }),
    ).toBeNull()
  })

  it('saves what the owner changes, and the kind’s own value as empty', async () => {
    signedInAs('owner')
    serverSays('PUT', '/settings/deadlines/quote.follow_up', {
      ...followUp,
      setting: { intervalDays: 21, leadDays: null, responsibleUserId: 'u-2' },
    })
    render(inQueries(<DeadlineSettingsScreen />))

    const interval = await screen.findByLabelText('Wiedervorlage nach')
    const user = userEvent.setup()
    await user.clear(interval)
    await user.type(interval, '21')
    await user.selectOptions(screen.getByLabelText('Verantwortlich'), 'u-2')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        leadDays: null,
        intervalDays: 21,
        responsibleUserId: 'u-2',
      })
    })
    expect(await screen.findByText('Gespeichert.')).toBeTruthy()
  })

  it('is read by the office without anything to press', async () => {
    signedInAs('office')
    render(inQueries(<DeadlineSettingsScreen />))

    expect(await screen.findByText('Wiedervorlage eines Angebots')).toBeTruthy()
    await waitFor(() => {
      expect((screen.getByLabelText('Vorlauf') as HTMLInputElement).disabled).toBe(true)
    })
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })
})
