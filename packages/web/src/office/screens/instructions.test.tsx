import type { RoleKey } from '@opengewerk/domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstructionView } from '../../session/instructions.js'
import { InstructionsScreen } from './instructions.js'

/**
 * The screen "Belehrungen": the shipped instruction on withdrawal, its form
 * and the sheet for an early start, the business's own, and what changing a
 * model costs. Changed by the owner, seen by the office.
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

  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

function signedInAs(...roles: RoleKey[]) {
  serverSays('GET', '/api/auth/get-session', {
    user: { id: 'u-1', email: 'chefin@nord.example.de', name: 'Christa Chefin' },
    session: { activeTenantId: 't-1' },
  })
  serverSays('GET', '/auth/tenants', [{ id: 't-1', name: 'Elektro Nord GmbH', roles }])
}

const model = {
  validFrom: '2026-06-19',
  source: 'Anlage 1 zu Art. 246a § 1 Abs. 2 Satz 2 EGBGB',
  text: '# Widerrufsrecht\n\nSie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.',
}

const withdrawal: InstructionView = {
  id: 'i-1',
  template: 'withdrawal',
  title: 'Widerrufsbelehrung',
  body: model.text,
  changed: false,
  model,
  newerModel: null,
  kinds: ['cost_estimate', 'quote'],
  consumersOnly: true,
  withDocument: true,
  position: 1,
}

const form: InstructionView = {
  ...withdrawal,
  id: 'i-2',
  template: 'withdrawal_form',
  title: 'Muster-Widerrufsformular',
  body: '- An {name}:\n___',
  model: { ...model, source: 'Anlage 2', text: '- An {name}:\n___' },
  position: 2,
}

const earlyStart: InstructionView = {
  ...withdrawal,
  id: 'i-3',
  template: 'early_start',
  title: 'Beginn vor Ablauf der Widerrufsfrist',
  body: 'Ich verlange ausdrücklich den Beginn.',
  model: { ...model, source: 'kein Muster', text: 'Ich verlange ausdrücklich den Beginn.' },
  withDocument: false,
  position: 3,
}

const own: InstructionView = {
  id: 'i-4',
  template: null,
  title: 'Hinweise zur Wartung',
  body: 'Bitte jährlich prüfen lassen.',
  changed: false,
  model: null,
  newerModel: null,
  kinds: ['final_invoice'],
  consumersOnly: false,
  withDocument: true,
  position: 4,
}

function listed(...entries: InstructionView[]) {
  serverSays('GET', '/settings/instructions', entries)
}

beforeEach(() => {
  calls = []
  answers = new Map()

  listed(withdrawal, form, earlyStart)

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
  vi.unstubAllGlobals()
})

function section(name: string) {
  return screen.getByRole('region', { name })
}

describe('the instructions, as the owner keeps them', () => {
  it('lists the shipped ones with where they are proposed and whether they go out', async () => {
    signedInAs('owner')
    render(inQueries(<InstructionsScreen />))

    const first = within(await screen.findByRole('region', { name: 'Widerrufsbelehrung' }))

    expect(first.getByText('Mitgeliefertes Muster, Fassung ab 19.06.2026')).toBeTruthy()
    expect(
      first.getByText(
        /Vorgeschlagen für Kostenvoranschlag und Angebot, nur an Kunden, die kein Unternehmen sind\./,
      ),
    ).toBeTruthy()
    expect(first.getByText(/Geht mit dem Beleg hinaus/)).toBeTruthy()
    expect(
      within(section('Beginn vor Ablauf der Widerrufsfrist')).getByText(
        /Liegt am Beleg als eigenes Blatt zum Ausdrucken bereit\./,
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Belehrung anlegen' })).toBeTruthy()
  })

  it('says what a changed model costs as soon as the words leave it, and saves them marked', async () => {
    signedInAs('owner')
    serverSays('PATCH', '/settings/instructions/i-1', { ...withdrawal, changed: true })
    render(inQueries(<InstructionsScreen />))

    const first = within(await screen.findByRole('region', { name: 'Widerrufsbelehrung' }))
    const user = userEvent.setup()
    await user.click(first.getByRole('button', { name: 'Bearbeiten' }))

    expect(first.queryByLabelText('Überschrift')).toBeNull()
    expect(first.queryByRole('note')).toBeNull()

    await user.type(first.getByLabelText('Wortlaut'), ' Ergänzt.')

    expect(first.getByRole('note').textContent).toContain('Art. 246a § 1 Abs. 2 Satz 2 EGBGB')

    await user.click(first.getByRole('button', { name: 'Geändert speichern' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')).toEqual({
        path: '/settings/instructions/i-1',
        method: 'PATCH',
        body: {
          kinds: ['cost_estimate', 'quote'],
          consumersOnly: true,
          withDocument: true,
          body: `${model.text} Ergänzt.`,
        },
      })
    })
  })

  it('marks a changed model, offers the original back and says when the law moved on', async () => {
    signedInAs('owner')
    listed(
      {
        ...withdrawal,
        body: 'Eigene Fassung.',
        changed: true,
        newerModel: { validFrom: '2026-06-19', source: 'Anlage 1' },
      },
      form,
    )
    serverSays('POST', '/settings/instructions/i-1/restore', withdrawal)
    render(inQueries(<InstructionsScreen />))

    const first = within(await screen.findByRole('region', { name: 'Widerrufsbelehrung' }))

    expect(
      first.getByText('Mitgeliefertes Muster, vom Betrieb geändert, Fassung ab 19.06.2026'),
    ).toBeTruthy()
    expect(first.getByText('Geändertes Muster')).toBeTruthy()
    expect(
      first.getByText(/eine neue Fassung des Musters erschienen, gültig ab 19\.06\.2026/),
    ).toBeTruthy()

    await userEvent.setup().click(first.getByRole('button', { name: 'Original wiederherstellen' }))

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/restore'))).toBe(
        true,
      )
    })
  })

  it('writes an instruction of its own, with its heading and the kinds it is for', async () => {
    signedInAs('owner')
    serverSays('POST', '/settings/instructions', own)
    render(inQueries(<InstructionsScreen />))

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Belehrung anlegen' }))

    const card = within(section('Neue Belehrung'))
    await user.type(card.getByLabelText('Überschrift'), 'Hinweise zur Wartung')
    await user.type(card.getByLabelText('Wortlaut'), 'Bitte jährlich prüfen lassen.')
    await user.click(card.getByLabelText('Schlussrechnung'))
    await user.click(card.getByRole('button', { name: 'Belehrung anlegen' }))

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        kinds: ['final_invoice'],
        consumersOnly: false,
        withDocument: true,
        title: 'Hinweise zur Wartung',
        body: 'Bitte jährlich prüfen lassen.',
      })
    })
  })

  it('removes one of its own after asking, and keeps the shipped ones', async () => {
    signedInAs('owner')
    listed(withdrawal, own)
    serverSays('DELETE', '/settings/instructions/i-4', { removed: 'i-4' })
    render(inQueries(<InstructionsScreen />))

    const mine = within(await screen.findByRole('region', { name: 'Hinweise zur Wartung' }))

    expect(
      within(section('Widerrufsbelehrung')).queryByRole('button', { name: /entfernen/i }),
    ).toBeNull()

    const user = userEvent.setup()
    await user.click(mine.getByRole('button', { name: 'Hinweise zur Wartung entfernen' }))
    await user.click(mine.getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    })
  })

  it('says why the server refused', async () => {
    signedInAs('owner')
    serverSays(
      'PATCH',
      '/settings/instructions/i-3',
      { message: 'Diesen Platzhalter kennt OpenGewerk nicht: {adresse}.' },
      400,
    )
    render(inQueries(<InstructionsScreen />))

    const third = within(
      await screen.findByRole('region', { name: 'Beginn vor Ablauf der Widerrufsfrist' }),
    )
    const user = userEvent.setup()
    await user.click(third.getByRole('button', { name: 'Bearbeiten' }))
    await user.click(third.getByRole('button', { name: 'Speichern' }))

    expect((await third.findByRole('alert')).textContent).toBe(
      'Diesen Platzhalter kennt OpenGewerk nicht: {adresse}.',
    )
  })
})

describe('the instructions, as the office sees them', () => {
  it('are shown with nothing to press', async () => {
    signedInAs('office')
    render(inQueries(<InstructionsScreen />))

    await screen.findByRole('region', { name: 'Widerrufsbelehrung' })

    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Belehrung anlegen' })).toBeNull()
  })
})
