import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { aTenantChoice } from '../../session/test-tenants.js'
import { erasureQuestion, PrivacyScreen, whoGoes } from './privacy.js'

/**
 * The screen "Datenschutz" (#317): what is due with a question before it
 * goes, the kinds that go by themselves, what went without a name, and the
 * retention periods with their source. Deleting and switching are offered to
 * whoever leads the business, which the server says.
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
    user: { id: 'u-1', email: 'lena@nord.example.de', name: 'Lena Leitung' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [aTenantChoice(roles)])
}

const due = [
  {
    deadlineId: 'd-1',
    kind: 'prospect',
    recordId: 'p-1',
    name: 'Sandra Brenner',
    detail: 'Website · Wallbox in der Garage · letzter Kontakt 30.09.2025',
    dueOn: '2026-09-30',
  },
  {
    deadlineId: 'd-2',
    kind: 'prospect',
    recordId: 'p-2',
    name: 'Markus Lehmann',
    detail: 'Anruf · PV auf dem Carport · letzter Kontakt 21.10.2025',
    dueOn: '2026-10-21',
  },
]

const erased = [
  {
    id: 'e-1',
    kind: 'prospect',
    label: 'Lead aus einer E-Mail, letzter Kontakt 14.10.2025',
    dueOn: '2026-10-14',
    erasedAt: '2026-10-28T15:42:00.000Z',
    erasedBy: 'lena',
    automatic: true,
    redactions: 14,
  },
]

function overview(
  leads: boolean,
  automations: unknown[] = [],
  erasures: unknown[] = [],
  requests: unknown[] = [],
  dueNow: unknown[] = due,
) {
  serverSays('GET', '/privacy', { due: dueNow, erasures, automations, requests, leads })
}

function aRequest(
  id: string,
  customerName: string,
  values: {
    readonly status?: 'open' | 'restricted'
    readonly holds?: { kind: string; until: string | null }[]
    readonly answer?: 'erase' | 'restrict' | null
    readonly dueOn?: string | null
  },
) {
  return {
    request: {
      id,
      customerId: `c-${id}`,
      receivedOn: '2026-11-01',
      channel: 'email',
      status: values.status ?? 'open',
      answerDueOn: '2026-12-01',
      restrictedAt: values.status === 'restricted' ? '2026-10-14T08:00:00.000Z' : null,
      erasedAt: null,
      createdBy: 'bruno',
      createdAt: '2026-11-01T08:00:00.000Z',
    },
    customerName,
    holds: values.holds ?? [],
    answer: values.answer === undefined ? 'erase' : values.answer,
    dueOn: values.dueOn === undefined ? '2026-11-01' : values.dueOn,
  }
}

const requests = [
  aRequest('r-1', 'Familie Wolff', {
    status: 'restricted',
    holds: [{ kind: 'retention', until: '2034-12-31' }],
    answer: 'restrict',
    dueOn: '2035-01-01',
  }),
  aRequest('r-2', 'Jürgen Haas', {
    holds: [{ kind: 'retention', until: '2034-12-31' }],
    answer: 'restrict',
    dueOn: '2035-01-01',
  }),
  aRequest('r-3', 'Ute Petersen', {}),
  aRequest('r-4', 'Familie Arslan', {
    holds: [{ kind: 'open_job', until: null }],
    answer: null,
    dueOn: null,
  }),
]

beforeEach(() => {
  calls = []
  answers = new Map()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T10:00:00Z') })
  serverSays('GET', '/tasks/assignees', [{ userId: 'lena', name: 'Lena Leitung' }])

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

describe('what is due', () => {
  it('shows each lead with who it is and since when, all chosen to go', async () => {
    signedInAs('owner')
    overview(true)
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Zum Löschen fällig' })

    expect(within(table).getByText('Sandra Brenner')).toBeTruthy()
    expect(within(table).getByText(due[0]?.detail ?? '')).toBeTruthy()
    expect(within(table).getByText('30.09.2026')).toBeTruthy()
    expect(
      (within(table).getByLabelText('Sandra Brenner auswählen') as HTMLInputElement).checked,
    ).toBe(true)
    expect(screen.getByRole('button', { name: 'Ausgewählte löschen' })).toBeTruthy()
  })

  it('asks before deleting, names who goes, and sends only the chosen ones', async () => {
    signedInAs('owner')
    overview(true)
    serverSays('POST', '/privacy/erasures', [])
    render(inQueries(<PrivacyScreen />))

    const user = userEvent.setup()
    await user.click(await screen.findByLabelText('Markus Lehmann auswählen'))
    await user.click(screen.getByRole('button', { name: 'Ausgewählte löschen' }))

    const question = await screen.findByRole('alertdialog', { name: 'Einen Lead löschen?' })

    expect(within(question).getByText(/Sandra Brenner geht endgültig\./)).toBeTruthy()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)

    await user.click(within(question).getByRole('button', { name: 'Endgültig löschen' }))

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toEqual([
        { path: '/privacy/erasures', method: 'POST', body: { kind: 'prospect', ids: ['p-1'] } },
      ])
    })
  })

  it('says why the server refused, and nothing went', async () => {
    signedInAs('owner')
    overview(true)
    serverSays(
      'POST',
      '/privacy/erasures',
      { message: 'Ein ausgewählter Lead ist noch nicht zum Löschen fällig.' },
      409,
    )
    render(inQueries(<PrivacyScreen />))

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Ausgewählte löschen' }))
    await user.click(await screen.findByRole('button', { name: 'Endgültig löschen' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'noch nicht zum Löschen fällig',
    )
    expect(screen.getByText('Sandra Brenner')).toBeTruthy()
  })

  it('offers neither deleting nor switching to whoever does not lead the business', async () => {
    signedInAs('office')
    overview(false)
    render(inQueries(<PrivacyScreen />))

    expect(await screen.findByText('Sandra Brenner')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ausgewählte löschen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Einschalten' })).toBeNull()
  })
})

describe('what is due, for whoever may not see leads', () => {
  it('says who sees it instead of naming anybody', async () => {
    signedInAs('owner')
    serverSays('GET', '/privacy', {
      due: null,
      erasures: [],
      automations: [],
      requests: null,
      leads: true,
    })
    render(inQueries(<PrivacyScreen />))

    expect(
      await screen.findByText(
        'Was zum Löschen fällig ist, sieht, wer Leads oder Kunden sehen darf.',
      ),
    ).toBeTruthy()
    expect(await screen.findByText('Löschanfragen sieht, wer Kunden sehen darf.')).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Zum Löschen fällig' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ausgewählte löschen' })).toBeNull()
  })
})

describe('deleting by itself', () => {
  it('is switched on for the kind, and then says who did it and is switched off', async () => {
    signedInAs('owner')
    overview(true)
    serverSays('PUT', '/privacy/automations/prospect', [])
    render(inQueries(<PrivacyScreen />))

    const user = userEvent.setup()
    // The leads come first, the customers after them.
    await user.click(
      (await screen.findAllByRole('button', { name: 'Einschalten' }))[0] as HTMLElement,
    )

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PUT')).toBe(true)
    })
    expect(calls.find((call) => call.method === 'PUT')?.path).toBe('/privacy/automations/prospect')
  })

  it('names who switched it on and switches it off', async () => {
    signedInAs('owner')
    overview(true, [{ kind: 'prospect', enabledBy: 'lena', enabledAt: '2026-11-04T09:00:00.000Z' }])
    serverSays('DELETE', '/privacy/automations/prospect', [])
    render(inQueries(<PrivacyScreen />))

    expect(await screen.findByText(/Eingeschaltet von Lena Leitung am 04\.11\.2026\./)).toBeTruthy()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Ausschalten' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'DELETE')?.path).toBe(
        '/privacy/automations/prospect',
      )
    })
  })
})

describe('what went and how long papers stay', () => {
  it('lists what went without a name, by whom or by itself', async () => {
    signedInAs('owner')
    overview(true, [], erased)
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Gelöscht' })

    expect(within(table).getByText(erased[0]?.label ?? '')).toBeTruthy()
    expect(await within(table).findByText('Von selbst, für Lena Leitung')).toBeTruthy()
  })

  it('shows each retention period with its start and its source, and the change of 2025', async () => {
    signedInAs('owner')
    overview(true)
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Aufbewahrungsfristen' })
    const vouchers = within(table).getByText('Buchungsbelege und Rechnungen').closest('tr')

    expect(vouchers?.textContent).toContain('8 Jahre, bis 2024 zehn')
    expect(vouchers?.textContent).toContain('Ende des Jahres')
    expect(vouchers?.textContent).toContain('§ 14b Abs. 1 Satz 1 UStG')
    expect(
      within(table).getByText('Aufzeichnungen nach dem Mindestlohngesetz').closest('tr')
        ?.textContent,
    ).toContain('Tag der Aufzeichnung')
  })
})

describe('the requests for deletion (#845)', () => {
  it('show each with what holds its customer and when it is due', async () => {
    signedInAs('office')
    overview(false, [], [], requests)
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Löschanfragen' })
    const haas = within(table).getByText('Jürgen Haas').closest('tr')
    const wolff = within(table).getByText('Familie Wolff').closest('tr')

    expect(haas?.textContent).toContain(
      'Eingegangen am 01.11.2026 per E-Mail · Belege sind bis 31.12.2034 aufzubewahren.',
    )
    expect(haas?.textContent).toContain('Antwort bis 01.12.2026')
    expect(wolff?.textContent).toContain('Gesperrt')
    expect(wolff?.textContent).toContain('Löschen ab 01.01.2035')
    expect(within(table).queryByRole('button')).toBeNull()
  })

  it('offer whoever leads the answer each can get today', async () => {
    signedInAs('owner')
    overview(true, [], [], requests)
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Löschanfragen' })
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement

    expect(within(row('Jürgen Haas')).getByRole('button', { name: 'Sperren' })).toBeTruthy()
    expect(within(row('Ute Petersen')).getByRole('button', { name: 'Löschen' })).toBeTruthy()
    expect(within(row('Familie Arslan')).queryByRole('button')).toBeNull()
    expect(row('Familie Arslan').textContent).toContain('Erst nach dem Auftrag')
    expect(within(row('Familie Wolff')).queryByRole('button')).toBeNull()
  })

  it('restrict a customer after a question', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    signedInAs('owner')
    overview(true, [], [], requests)
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Löschanfragen' })

    await user.click(
      within(within(table).getByText('Jürgen Haas').closest('tr') as HTMLElement).getByRole(
        'button',
        { name: 'Sperren' },
      ),
    )

    const dialog = await screen.findByRole('alertdialog', { name: 'Jürgen Haas sperren?' })

    expect(dialog.textContent).toContain('Belege sind bis 31.12.2034 aufzubewahren.')
    await user.click(within(dialog).getByRole('button', { name: 'Sperren' }))
    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.method === 'POST' && call.path === '/privacy/requests/r-2/restriction',
        ),
      ).toBe(true)
    })
  })

  it('delete a customer whom nothing holds, with what goes along', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    signedInAs('owner')
    overview(true, [], [], requests)
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Löschanfragen' })

    await user.click(
      within(within(table).getByText('Ute Petersen').closest('tr') as HTMLElement).getByRole(
        'button',
        { name: 'Löschen' },
      ),
    )

    const dialog = await screen.findByRole('alertdialog', { name: 'Ute Petersen löschen?' })

    expect(dialog.textContent).toContain('Objekte und Anlagen bleiben ohne seine Daten.')
    await user.click(within(dialog).getByRole('button', { name: 'Endgültig löschen' }))
    await waitFor(() => {
      expect(calls.find((call) => call.path === '/privacy/erasures')?.body).toEqual({
        kind: 'customer',
        ids: ['c-r-3'],
      })
    })
  })
})

describe('a customer that is due (#845)', () => {
  it('goes with the leads chosen, each kind on its own', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

    signedInAs('owner')
    overview(
      true,
      [],
      [],
      [],
      [
        ...due,
        {
          deadlineId: 'd-3',
          kind: 'customer',
          recordId: 'c-9',
          name: 'Gerhard Moll',
          detail: 'Privatkunde, letzter Kontakt 12.06.2023',
          dueOn: '2026-06-12',
        },
      ],
    )
    render(inQueries(<PrivacyScreen />))

    const table = await screen.findByRole('table', { name: 'Zum Löschen fällig' })

    expect(within(table).getByText('Gerhard Moll').closest('tr')?.textContent).toContain('Kunde')
    await user.click(screen.getByRole('button', { name: 'Ausgewählte löschen' }))

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Zwei Leads und einen Kunden löschen?',
    })

    expect(dialog.textContent).toContain('Mit einem Kunden gehen')
    await user.click(within(dialog).getByRole('button', { name: 'Endgültig löschen' }))
    await waitFor(() => {
      expect(
        calls.filter((call) => call.path === '/privacy/erasures').map((call) => call.body),
      ).toEqual([
        { kind: 'prospect', ids: ['p-1', 'p-2'] },
        { kind: 'customer', ids: ['c-9'] },
      ])
    })
  })
})

describe('the words of the question', () => {
  it('count and name who goes', () => {
    expect(erasureQuestion({ prospect: 1 })).toBe('Einen Lead löschen?')
    expect(erasureQuestion({ prospect: 2 })).toBe('Zwei Leads löschen?')
    expect(erasureQuestion({ prospect: 13 })).toBe('13 Leads löschen?')
    expect(erasureQuestion({ customer: 1 })).toBe('Einen Kunden löschen?')
    expect(erasureQuestion({ prospect: 2, customer: 1 })).toBe(
      'Zwei Leads und einen Kunden löschen?',
    )
    expect(whoGoes(['A', 'B'])).toBe('A und B gehen endgültig.')
    expect(whoGoes(['A', 'B', 'C', 'D'])).toBe('Die 4 Ausgewählten gehen endgültig.')
  })
})
