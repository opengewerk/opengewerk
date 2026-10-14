import 'fake-indexeddb/auto'

import type { InstanceMailServerView } from '@opengewerk/platform-domain'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenant, inFrame, signedIn, standInServer } from '../in-frame.js'
import type { StandIn } from '../in-frame.js'
import { InstanceFrame } from './frame.js'
import { InstanceSettingsScreen } from './settings.js'

/**
 * The mail server of the instance among its settings
 * (opengewerk-haustechnik#81), as the board "Instanz: Einstellungen" draws
 * it: what goes to an account goes out through it. The card says so in the
 * words of the application, sends what was typed and the password only
 * where one was typed, and asks before it removes anything.
 */

let server: StandIn

const kept: InstanceMailServerView = {
  host: 'smtp.example.de',
  port: 587,
  security: 'starttls',
  username: 'instanz@example.de',
  fromAddress: 'instanz@example.de',
  password: 'set',
  passwordSetAt: '2026-10-02T09:00:00.000Z',
}

async function settings() {
  const frame = (): ReactNode => (
    <InstanceFrame
      navigation={[{ to: '/instanz/einstellungen', label: 'Einstellungen', icon: Settings }]}
    />
  )

  await inFrame(frame, {
    at: '/instanz/einstellungen',
    screens: { '/instanz/einstellungen': () => <InstanceSettingsScreen /> },
  })

  return userEvent.setup()
}

/** The form of the card, once it is there. */
async function form(): Promise<HTMLFormElement> {
  return (await screen.findByLabelText('Absenderadresse')).closest('form') as HTMLFormElement
}

function sent(method: string, path: string): unknown[] {
  return server.heard
    .filter((call) => call.method === method && call.path === path)
    .map((call) => call.body)
}

beforeEach(() => {
  server = standInServer()
  signedIn(server, [aTenant({ name: 'Probewerk Nord' })])
  server.answer('GET', '/instance/access', { operator: true, secondFactor: true })
  server.answer('GET', '/instance/settings', {
    mailInternalHosts: [],
    backupTime: '02:30',
    takenOverAt: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the mail server of the instance among its settings', () => {
  it('says what goes out through it in the words of the application, and what is missing while there is none', async () => {
    server.answer('GET', '/instance/mail-server', { sends: true, server: null })
    await settings()

    const card = (await form()).closest('section') as HTMLElement

    expect(
      within(card).getByText(
        'Mails an ein Konto gehen über diesen Server und über den keines Mandanten.',
      ),
    ).toBeTruthy()
    expect(within(card).getByRole('note').textContent).toBe(
      'Ohne ihn bekommt niemand einen Link zu einem neuen Passwort.',
    )
    // Nothing to remove, and the name the instance writes under is the application's.
    expect(within(card).queryByRole('button', { name: 'Mailserver entfernen' })).toBeNull()
    expect(within(card).getByText('Davor steht der Name der Anwendung.')).toBeTruthy()
  })

  it('sends what was typed, the port only where one was, and says what the mail server took', async () => {
    server.answer('GET', '/instance/mail-server', { sends: true, server: null })
    server.answer('PUT', '/instance/mail-server', { server: kept, check: { outcome: 'ready' } })

    const user = await settings()
    const card = await form()

    await user.type(within(card).getByLabelText('Server'), 'smtp.example.de')
    await user.type(within(card).getByLabelText('Benutzername'), 'instanz@example.de')
    await user.type(within(card).getByLabelText('Passwort'), 'postfach-4711')
    await user.type(within(card).getByLabelText('Absenderadresse'), 'instanz@example.de')
    server.answer('GET', '/instance/mail-server', { sends: true, server: kept })
    await user.click(within(card).getByRole('button', { name: 'Speichern' }))

    expect(
      await screen.findByText(
        'Gespeichert. Die Verbindung zum Mailserver funktioniert, die Anmeldung wurde angenommen.',
      ),
    ).toBeTruthy()
    expect(sent('PUT', '/instance/mail-server')).toEqual([
      {
        host: 'smtp.example.de',
        port: null,
        security: 'starttls',
        username: 'instanz@example.de',
        password: 'postfach-4711',
        fromAddress: 'instanz@example.de',
      },
    ])
    // The form begins again with what is kept, and the password is in no field of it.
    await waitFor(() => {
      expect(
        screen.getByText(/Gespeichert am 02.10.2026. Leer lassen, um es zu behalten./),
      ).toBeTruthy()
    })
    expect((screen.getByLabelText('Passwort') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('keeps the password there is where the field stays empty', async () => {
    server.answer('GET', '/instance/mail-server', { sends: true, server: kept })
    server.answer('PUT', '/instance/mail-server', {
      server: { ...kept, fromAddress: 'konten@example.de' },
      check: { outcome: 'unreachable', reason: 'Der Mailserver antwortet nicht.' },
    })

    const user = await settings()
    const card = await form()
    const from = within(card).getByLabelText('Absenderadresse')

    await user.clear(from)
    await user.type(from, 'konten@example.de')
    await user.click(within(card).getByRole('button', { name: 'Speichern' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Gespeichert, aber der Mailserver lässt sich gerade nicht erreichen: Der Mailserver antwortet nicht.',
    )
    expect(sent('PUT', '/instance/mail-server')).toEqual([
      {
        host: 'smtp.example.de',
        port: null,
        security: 'starttls',
        username: 'instanz@example.de',
        fromAddress: 'konten@example.de',
      },
    ])
  })

  it('tries a connection without saving it, and says what the mail server said', async () => {
    server.answer('GET', '/instance/mail-server', { sends: true, server: kept })
    server.answer('POST', '/instance/mail-server/check', {
      outcome: 'refused',
      reason: 'Der Mailserver smtp.example.de:587 lehnt die Anmeldung ab.',
    })

    const user = await settings()
    const card = await form()

    await user.type(within(card).getByLabelText('Passwort'), 'falsch-geraten')
    await user.click(within(card).getByRole('button', { name: 'Verbindung prüfen' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Der Mailserver smtp.example.de:587 lehnt die Anmeldung ab.',
    )
    expect(sent('POST', '/instance/mail-server/check')).toEqual([
      {
        host: 'smtp.example.de',
        port: null,
        security: 'starttls',
        username: 'instanz@example.de',
        password: 'falsch-geraten',
        fromAddress: 'instanz@example.de',
      },
    ])
    expect(sent('PUT', '/instance/mail-server')).toEqual([])
  })

  it('asks before it removes the mail server, and says what does not go out after', async () => {
    server.answer('GET', '/instance/mail-server', { sends: true, server: kept })
    server.answer('DELETE', '/instance/mail-server', { removed: true })

    const user = await settings()
    const card = await form()

    await user.click(within(card).getByRole('button', { name: 'Mailserver entfernen' }))

    const question = await screen.findByRole('alertdialog', { name: 'Mailserver entfernen?' })

    expect(question.textContent).toContain('auch kein Link zu einem neuen Passwort')
    expect(sent('DELETE', '/instance/mail-server')).toEqual([])

    server.answer('GET', '/instance/mail-server', { sends: true, server: null })
    await user.click(within(question).getByRole('button', { name: 'Entfernen' }))

    expect(await screen.findByText('Der Mailserver ist entfernt, samt Anmeldung.')).toBeTruthy()
    expect(sent('DELETE', '/instance/mail-server')).toHaveLength(1)
    expect(await screen.findByRole('note')).toBeTruthy()
  })

  it('says that a kept password no longer opens, at the field it belongs in', async () => {
    server.answer('GET', '/instance/mail-server', {
      sends: true,
      server: { ...kept, password: 'unreadable' },
    })
    await settings()

    expect(
      within(await form()).getByText(
        'Das gespeicherte Passwort lässt sich nicht mehr lesen. Es muss neu eingegeben werden.',
      ),
    ).toBeTruthy()
  })

  it('offers no form on an instance that sends no mail, and says why', async () => {
    server.answer('GET', '/instance/mail-server', { sends: false, server: null })
    await settings()

    expect(await screen.findByText(/Diese Instanz verschickt keine E-Mails/)).toBeTruthy()
    expect(screen.queryByLabelText('Absenderadresse')).toBeNull()
    // The other settings of the instance stand as before.
    expect(screen.getByLabelText('Freigegebene Mailserver')).toBeTruthy()
  })
})
