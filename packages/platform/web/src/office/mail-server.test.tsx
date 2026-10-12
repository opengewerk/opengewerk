import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InRouter } from '../in-router.js'
import { InProbe } from '../probe-application.js'
import type { MailServer } from '../session/mail.js'
import {
  MailServerSection,
  type MailServerWords,
  MailStatusSection,
  type MailStatusWords,
  SignaturePreviews,
} from './mail-server.js'

/**
 * The mail server of a tenant as the foundation draws it
 * (opengewerk-haustechnik#126): the form for whoever may see it, and one
 * sentence for everybody else. What goes out through it, where the name of
 * the sender comes from and what a signature may hold are the application's
 * and come in as words; the form sends what was typed, the password only
 * where one was typed, and asks before it removes anything.
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

function sent(method: string, path: string): unknown[] {
  return calls.filter((call) => call.method === method && call.path === path).map((c) => c.body)
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

/** A signature of the probe: one placeholder, and the template shown as it is handed over. */
const words: MailServerWords = {
  what: 'Über diesen Mailserver gehen die Briefe des Probewerks hinaus.',
  senderName: 'Davor steht der Name am Regal.',
  signature: {
    placeholder: 'Gruß\n{regal}',
    hint: 'Steht unter jedem Brief. {regal} ist das Regal.',
    problem: (template) =>
      template.includes('{kiste}') ? 'Unbekannt: {kiste}. Möglich ist {regal}.' : undefined,
    Previews: ({ template }) => (
      <SignaturePreviews cases={[{ title: 'Vom Regal aus', text: template ?? 'Regal 4' }]} />
    ),
  },
}

const statusWords: MailStatusWords = {
  set: (from) => `Das Probewerk schreibt von ${from}.`,
  missing: 'Das Probewerk schreibt niemandem.',
}

const kept: MailServer = {
  host: 'smtp.example.de',
  port: 587,
  security: 'starttls',
  username: 'werk@example.de',
  fromAddress: 'werk@example.de',
  signature: null,
  password: 'set',
  passwordSetAt: '2026-10-02T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
}

async function theForm(): Promise<HTMLFormElement> {
  return (await screen.findByLabelText('Absenderadresse')).closest('form') as HTMLFormElement
}

beforeEach(() => {
  calls = []
  answers = new Map()
  serverSays('GET', '/settings/mail/server', { server: null })

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

describe('whether a tenant sends mail, for whoever may not see the mail server', () => {
  it('names the address in the sentence of the application', async () => {
    serverSays('GET', '/settings/mail', { configured: true, from: 'werk@example.de' })
    render(inQueries(<MailStatusSection words={statusWords} />))

    expect(await screen.findByText('Das Probewerk schreibt von werk@example.de.')).toBeTruthy()
    // The server itself is not asked for: this card is for whoever may not read it.
    expect(sent('GET', '/settings/mail/server')).toHaveLength(0)
  })

  it('says in the sentence of the application that there is none', async () => {
    serverSays('GET', '/settings/mail', { configured: false, from: null })
    render(inQueries(<MailStatusSection words={statusWords} />))

    expect(await screen.findByText('Das Probewerk schreibt niemandem.')).toBeTruthy()
  })
})

describe('the mail server of a tenant, for whoever may see it', () => {
  it('says what goes out through it and whose name stands in front, in the words of the application', async () => {
    render(inQueries(<MailServerSection mayWrite words={words} />))

    const form = await theForm()
    const card = form.closest('section') as HTMLElement

    expect(
      within(card).getByText(
        'Über diesen Mailserver gehen die Briefe des Probewerks hinaus. Die Angaben stehen beim E-Mail-Anbieter, meist unter „SMTP“ oder „Postausgangsserver“.',
      ),
    ).toBeTruthy()
    expect(
      within(form).getByText(
        'Von dieser Adresse gehen die E-Mails hinaus. Davor steht der Name am Regal.',
      ),
    ).toBeTruthy()
    expect(within(form).getByText('Steht unter jedem Brief. {regal} ist das Regal.')).toBeTruthy()
    // Nothing kept, nothing to remove.
    expect(within(form).queryByRole('button', { name: 'Mailserver entfernen' })).toBeNull()
  })

  it('sends what was typed, the port only where one was, and the password with it', async () => {
    serverSays('PUT', '/settings/mail/server', { server: kept, check: { outcome: 'ready' } })
    render(inQueries(<MailServerSection mayWrite words={words} />))

    const user = userEvent.setup()
    const form = await theForm()

    await user.type(within(form).getByLabelText('Server'), 'smtp.example.de')
    await user.type(within(form).getByLabelText('Benutzername'), 'werk@example.de')
    await user.type(within(form).getByLabelText('Passwort'), 'geheim-und-lang')
    await user.type(within(form).getByLabelText('Absenderadresse'), 'werk@example.de')
    await user.click(within(form).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(sent('PUT', '/settings/mail/server')).toEqual([
        {
          host: 'smtp.example.de',
          port: null,
          security: 'starttls',
          username: 'werk@example.de',
          password: 'geheim-und-lang',
          fromAddress: 'werk@example.de',
          signature: null,
        },
      ])
    })
    expect(
      await screen.findByText(
        'Gespeichert. Die Verbindung zum Mailserver funktioniert, die Anmeldung wurde angenommen.',
      ),
    ).toBeTruthy()
  })

  it('keeps the password there is where the field stays empty', async () => {
    serverSays('GET', '/settings/mail/server', { server: kept })
    serverSays('PUT', '/settings/mail/server', { server: kept, check: { outcome: 'ready' } })
    render(inQueries(<MailServerSection mayWrite words={words} />))

    const user = userEvent.setup()
    const form = await theForm()

    expect((within(form).getByLabelText('Passwort') as HTMLInputElement).value).toBe('')
    expect(within(form).getByText(/Leer lassen, um es zu behalten\./)).toBeTruthy()

    await user.click(within(form).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(sent('PUT', '/settings/mail/server')).toHaveLength(1)
    })
    expect(sent('PUT', '/settings/mail/server')[0]).not.toHaveProperty('password')
  })

  it('shows the signature as the application reads it, and saves nothing while it names something unknown', async () => {
    render(inQueries(<MailServerSection mayWrite words={words} />))

    const user = userEvent.setup()
    const form = await theForm()
    const signature = within(form).getByLabelText('Signatur')

    // Empty, the application is handed no template and prints what it prints by itself.
    expect(within(form).getByText('Vom Regal aus')).toBeTruthy()
    expect(within(form).getByText(/Regal 4/)).toBeTruthy()

    await user.type(signature, 'Gruß aus dem Lager')
    expect(within(form).getByText(/Gruß aus dem Lager/, { selector: 'pre' })).toBeTruthy()

    await user.type(signature, ' {{kiste}')
    expect(within(form).getByText('Unbekannt: {kiste}. Möglich ist {regal}.')).toBeTruthy()
    expect(
      (within(form).getByRole('button', { name: 'Speichern' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('asks before it removes the mail server', async () => {
    serverSays('GET', '/settings/mail/server', { server: kept })
    serverSays('DELETE', '/settings/mail/server', {})
    render(inQueries(<MailServerSection mayWrite words={words} />))

    const user = userEvent.setup()
    const form = await theForm()

    await user.click(within(form).getByRole('button', { name: 'Mailserver entfernen' }))

    const question = await screen.findByRole('alertdialog', { name: 'Mailserver entfernen?' })

    expect(sent('DELETE', '/settings/mail/server')).toHaveLength(0)

    await user.click(within(question).getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => {
      expect(sent('DELETE', '/settings/mail/server')).toHaveLength(1)
    })
    expect(await screen.findByText(/Der Mailserver ist entfernt, samt Anmeldung\./)).toBeTruthy()
  })

  it('shows whoever may only read it the settings and nothing to press', async () => {
    serverSays('GET', '/settings/mail/server', { server: kept })
    render(inQueries(<MailServerSection mayWrite={false} words={words} />))

    const form = await theForm()

    expect((within(form).getByLabelText('Server') as HTMLInputElement).value).toBe(
      'smtp.example.de',
    )
    expect(form.querySelector('fieldset')?.disabled).toBe(true)
    expect(within(form).queryByRole('button')).toBeNull()
  })
})
