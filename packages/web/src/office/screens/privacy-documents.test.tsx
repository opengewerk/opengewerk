import type { ProcessingActivityView, ProcessingRecordView } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../../app/in-router.js'
import { aDocumentsSummary } from '../../session/test-privacy.js'
import { aTenantChoice } from '../../session/test-tenants.js'
import { DocumentCards, ProcessingRecordScreen } from './privacy-documents.js'

/**
 * The documents on data protection in the office (#319): a card for each at
 * the end of "Datenschutz" with its PDF, and the page of the record, where
 * whoever leads the business keeps who is responsible and confirms or changes
 * what the application proposes per activity. Whoever does not lead reads it.
 */

interface Call {
  readonly path: string
  readonly method: string
  readonly body: unknown
}

let calls: Call[]
let answers: Map<string, { status: number; body: unknown; type?: string }>

function serverSays(method: string, path: string, body: unknown, status = 200, type?: string) {
  answers.set(`${method} ${path}`, { status, body, ...(type ? { type } : {}) })
}

function inQueries(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return (
    <QueryClientProvider client={client}>
      <InRouter>{node}</InRouter>
    </QueryClientProvider>
  )
}

function activity(
  key: ProcessingActivityView['key'],
  title: string,
  values: Partial<ProcessingActivityView> = {},
): ProcessingActivityView {
  return {
    key,
    title,
    subjects: 'Kunden, Ansprechpartner, Leads und Beschäftigte',
    data: 'E-Mail-Adresse und Name des Empfängers, Betreff, Text und Anhang',
    deletion: 'mit dem Beleg oder dem Kunden, an dem sie hängt',
    proposedPurpose: `Zweck von ${title}`,
    proposedLegalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO',
    purpose: null,
    legalBasis: null,
    recipients: null,
    unused: null,
    ...values,
  }
}

function aRecord(leads: boolean): ProcessingRecordView {
  return {
    controller: null,
    proposedController: 'Elektro Kohm GmbH\nHauptstraße 103, 68535 Edingen-Neckarhausen',
    officer: null,
    outside: null,
    activities: [
      activity('customers', 'Kunden, Ansprechpartner und Verlauf', {
        purpose: 'Kunden betreuen',
        legalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO',
      }),
      activity('mail', 'E-Mails an Kunden und Beschäftigte'),
      activity('calendar', 'Kalender-Abo', {
        unused: 'niemand im Betrieb hat ein Kalender-Abo',
      }),
    ],
    changed: { on: '2026-11-03', by: 'Moritz Kohm' },
    leads,
  }
}

beforeEach(() => {
  calls = []
  answers = new Map()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T10:00:00Z') })
  serverSays('GET', '/privacy/documents', aDocumentsSummary)
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'lena@kohm.example.de', name: 'Lena Leitung' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [aTenantChoice(['owner'])])

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
        headers: { 'Content-Type': answer.type ?? 'application/json' },
      }),
    )
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the cards of the documents on "Datenschutz"', () => {
  it('say what each document holds, and where the template of the contract is', async () => {
    render(inQueries(<DocumentCards />))

    expect(
      await screen.findByText('13 genutzt, davon 9 bestätigt und 4 als Vorschlag; 2 nicht genutzt'),
    ).toBeTruthy()
    expect(
      screen.getByText('vom Betreiber der Instanz, zuletzt geändert am 02.11.2026'),
    ).toBeTruthy()
    expect(screen.getByText('nach 12 Monaten vorschlagen')).toBeTruthy()
    expect(screen.getByText('6, davon keine automatisch')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Angaben pflegen' }).getAttribute('href')).toBe(
      '/einstellungen/datenschutz/verzeichnis',
    )

    const template = screen.getByRole('link', { name: 'opengewerk.de/auftragsverarbeitung' })

    expect(template.getAttribute('href')).toBe('https://opengewerk.de/auftragsverarbeitung/')
    expect(template.parentElement?.textContent).toContain('Sie ist nicht rechtlich geprüft.')
  })

  it('download each document as a PDF made now', async () => {
    const made = vi.fn(() => 'blob:pdf')

    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: made, revokeObjectURL: vi.fn() }))
    serverSays('GET', '/privacy/documents/deletion', '%PDF-1.7', 200, 'application/pdf')
    render(inQueries(<DocumentCards />))

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'Löschkonzept als PDF herunterladen' }),
    )

    await waitFor(() => {
      expect(made).toHaveBeenCalled()
    })
    expect(calls.some((call) => call.path === '/privacy/documents/deletion')).toBe(true)
  })
})

describe('the page of the record', () => {
  it('lists the activities in use with their state, and those not used with why', async () => {
    serverSays('GET', '/privacy/record', aRecord(true))
    render(inQueries(<ProcessingRecordScreen />))

    const table = await screen.findByRole('table', { name: 'Tätigkeiten im Verzeichnis' })
    const rows = within(table).getAllByRole('row').slice(1)

    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Kunden, Ansprechpartner und Verlauf',
      'E-Mails an Kunden und Beschäftigte',
    ])
    expect(within(rows[0] as HTMLElement).getByText('Bestätigt')).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('Vorschlag')).toBeTruthy()
    expect(
      within(rows[1] as HTMLElement).getByText('Zweck von E-Mails an Kunden und Beschäftigte'),
    ).toBeTruthy()
    expect(screen.getByText(': niemand im Betrieb hat ein Kalender-Abo')).toBeTruthy()
    expect(screen.getByText('Zuletzt geändert am 03.11.2026 von Moritz Kohm.')).toBeTruthy()
  })

  it('keeps who is responsible, proposing the letterhead, the officer and what is outside', async () => {
    serverSays('GET', '/privacy/record', aRecord(true))
    serverSays('PUT', '/privacy/record', aRecord(true))
    render(inQueries(<ProcessingRecordScreen />))

    const user = userEvent.setup()
    const controller = (await screen.findByLabelText('Verantwortlicher')) as HTMLTextAreaElement

    expect(controller.value).toBe('Elektro Kohm GmbH\nHauptstraße 103, 68535 Edingen-Neckarhausen')

    await user.type(screen.getByLabelText('Datenschutzbeauftragter'), 'Dr. Datenschutz')
    await user.type(
      screen.getByLabelText('Verarbeitungen außerhalb von OpenGewerk'),
      'Lohnbüro Weber',
    )
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        controller: 'Elektro Kohm GmbH\nHauptstraße 103, 68535 Edingen-Neckarhausen',
        officer: 'Dr. Datenschutz',
        outside: 'Lohnbüro Weber',
      })
    })
  })

  it('confirms an activity with its recipients, and takes it back to the proposal', async () => {
    serverSays('GET', '/privacy/record', aRecord(true))
    serverSays('PUT', '/privacy/record/activities/mail', aRecord(true))
    serverSays('PUT', '/privacy/record/activities/customers', aRecord(true))
    render(inQueries(<ProcessingRecordScreen />))

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: 'E-Mails an Kunden und Beschäftigte bearbeiten' }),
    )

    const dialog = await screen.findByRole('dialog', { name: 'E-Mails an Kunden und Beschäftigte' })

    expect(
      within(dialog).getByText('Vorschlag der Anwendung. Mit dem Speichern gilt er als bestätigt.'),
    ).toBeTruthy()
    await user.type(within(dialog).getByLabelText('Empfänger'), 'Mailo GmbH, Frankfurt')
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.path === '/privacy/record/activities/mail')?.body).toEqual({
        purpose: 'Zweck von E-Mails an Kunden und Beschäftigte',
        legalBasis: 'Art. 6 Abs. 1 Buchst. b DSGVO',
        recipients: 'Mailo GmbH, Frankfurt',
      })
    })

    await user.click(
      await screen.findByRole('button', { name: 'Kunden, Ansprechpartner und Verlauf bearbeiten' }),
    )

    const confirmed = await screen.findByRole('dialog', {
      name: 'Kunden, Ansprechpartner und Verlauf',
    })

    expect((within(confirmed).getByLabelText(/^Zweck/) as HTMLTextAreaElement).value).toBe(
      'Kunden betreuen',
    )
    await user.click(within(confirmed).getByRole('button', { name: 'Vorschlag wiederherstellen' }))
    expect((within(confirmed).getByLabelText(/^Zweck/) as HTMLTextAreaElement).value).toBe(
      'Zweck von Kunden, Ansprechpartner und Verlauf',
    )
    await user.click(within(confirmed).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(
        calls.find((call) => call.path === '/privacy/record/activities/customers')?.body,
      ).toEqual({ purpose: '', legalBasis: '', recipients: '' })
    })
  })

  it('offers nothing to change to whoever does not lead the business', async () => {
    serverSays('GET', '/privacy/record', aRecord(false))
    render(inQueries(<ProcessingRecordScreen />))

    expect(
      await screen.findByText(
        'Zuletzt geändert am 03.11.2026 von Moritz Kohm. Ändern darf nur, wer den Betrieb führt.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
    expect(screen.queryByRole('button', { name: /bearbeiten$/ })).toBeNull()
    expect((screen.getByLabelText('Verantwortlicher') as HTMLTextAreaElement).readOnly).toBe(true)
  })
})
