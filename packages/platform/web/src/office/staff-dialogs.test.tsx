import type { RoleDefinition } from '@opengewerk/platform-domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Field } from '../components/field.js'
import { aTenant, signedIn, standInServer } from '../in-frame.js'
import type { StandIn } from '../in-frame.js'
import { InRouter } from '../in-router.js'
import { InProbe } from '../probe-application.js'
import { StaffDialogsScreen } from './staff-dialogs.js'
import type { StaffAdditions } from './staff-dialogs.js'

/**
 * "Zugänge" where an access has one role and is made and changed in a dialog,
 * with what an application keeps beside a membership (ADR 0010).
 *
 * The application of these tests belongs to nobody. Beside a membership it
 * keeps the shelf somebody looks after, a word and nothing else, so that what
 * goes out under `additions` can be read off a request.
 */

let server: StandIn

const lead: RoleDefinition = {
  key: 'lead',
  label: 'Leitung',
  rights: ['membership.read', 'membership.write'],
  leads: true,
  secondFactor: true,
}
const member: RoleDefinition = {
  key: 'member',
  label: 'Mitglied',
  rights: ['shelf.read'],
  leads: false,
  secondFactor: false,
}
const guest: RoleDefinition = {
  key: 'guest',
  label: 'Gast',
  rights: [],
  leads: false,
  secondFactor: false,
}

const lea = {
  userId: 'u-1',
  name: 'Lea Leitung',
  email: 'lea@nord.example.de',
  roles: ['lead'],
  blockedAt: null,
  lastSignInAt: '2026-09-20T08:00:00.000Z',
  twoFactorEnabled: true,
  hasPasskey: false,
}

const max = {
  userId: 'u-2',
  name: 'Max Mitglied',
  email: 'max@nord.example.de',
  roles: ['member'],
  blockedAt: null,
  lastSignInAt: null,
  twoFactorEnabled: false,
  hasPasskey: false,
}

const invitation = {
  id: 'i-1',
  name: 'Lina Link',
  email: 'lina@nord.example.de',
  roles: ['member'],
  expiresAt: '2026-10-09T08:00:00.000Z',
  invitedBy: 'u-1',
  mail: null,
}

const devices = [
  {
    sessionId: 's-1',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    signedInAt: '2026-10-02T06:00:00.000Z',
    expiresAt: '2026-10-02T18:00:00.000Z',
    longLived: false,
    current: false,
  },
  {
    sessionId: 's-2',
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    signedInAt: '2026-09-28T05:30:00.000Z',
    expiresAt: '2026-10-28T05:30:00.000Z',
    longLived: true,
    current: false,
  },
]

/** How often the application was told to ask again what it shows. */
let refreshed = 0

/** The shelf somebody looks after: what the application of these tests keeps beside a membership. */
function shelves(over: Partial<StaffAdditions<string>> = {}): StaffAdditions<string> {
  return {
    title: 'Regal',
    column: 'w-[80px]',
    known: true,
    ofMember: (person) => (person.userId === 'u-2' ? 'A3' : 'alle'),
    ofInvitation: () => 'B1',
    startWith: (person) => (person === null ? 'A1' : person.userId === 'u-2' ? 'A3' : 'alle'),
    fields: ({ value, role, onChange }) => (
      <Field
        label="Regalname"
        value={value}
        hint={role === 'lead' ? 'Die Leitung sieht jedes Regal.' : undefined}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    ),
    toSend: (value, role) => ({ shelf: value, for: role }),
    refresh: () => {
      refreshed += 1
    },
    ...over,
  }
}

function staffScreen({
  byMail = false,
  suggestedRole = 'member',
  additions = shelves(),
  children,
}: {
  byMail?: boolean
  suggestedRole?: string
  additions?: StaffAdditions<string> | null
  children?: ReactNode
} = {}) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InProbe>
        <InRouter at="/einstellungen/zugaenge">
          <StaffDialogsScreen
            byMail={byMail}
            suggestedRole={suggestedRole}
            roleNotes={{ lead: 'Alles im Mandanten.', member: 'Die Regale.' }}
            sentences={{
              lastLead: 'Die letzte Leitung bleibt Leitung.',
              correction: 'Was hier berichtigt wird, steht im Protokoll des Mandanten.',
            }}
            {...(additions ? { additions } : {})}
          >
            {children}
          </StaffDialogsScreen>
        </InRouter>
      </InProbe>
    </QueryClientProvider>,
  )
}

/** What was sent to a route, in order. */
function sent(method: string, path: string): unknown[] {
  return server.heard
    .filter((call) => call.method === method && call.path === path)
    .map((call) => call.body)
}

/** Every request that changes something, in order. */
function written(): string[] {
  return server.heard
    .filter((call) => call.method !== 'GET')
    .map((call) => `${call.method} ${call.path}`)
}

function accountsTable() {
  return screen.getByRole('table', { name: 'Konten des Mandanten' })
}

function rowOf(name: string): HTMLElement {
  return within(accountsTable()).getByText(name).closest('tr') as HTMLElement
}

function isPicked(container: HTMLElement, role: string): boolean {
  return (within(container).getByRole('radio', { name: role }) as HTMLInputElement).checked
}

/** The dialog of a new access, once the screen offers it. */
async function newAccess(person: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await screen.findByText('Max Mitglied')
  await person.click(await screen.findByRole('button', { name: 'Zugang anlegen' }))

  return screen.findByRole('dialog', { name: 'Zugang anlegen' })
}

/** The dialog of the access of Max, once the screen offers it. */
async function accessOfMax(person: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await screen.findByText('Max Mitglied')
  await person.click(await screen.findByRole('button', { name: 'Max Mitglied bearbeiten' }))

  return screen.findByRole('dialog', { name: 'Zugang bearbeiten' })
}

async function save(person: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await person.click(within(dialog).getByRole('button', { name: 'Speichern' }))
}

async function untilClosed() {
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
}

beforeEach(() => {
  refreshed = 0
  server = standInServer()
  // Lea is looking, and she leads: the list of settings at the side asks
  // which of them she may read, and the screen whether she may change them.
  signedIn(
    server,
    [
      aTenant({
        roles: ['lead'],
        roleLabels: ['Leitung'],
        rights: ['membership.read', 'membership.write'],
      }),
    ],
    { name: 'Lea Leitung', email: 'lea@nord.example.de' },
  )
  server.answer('GET', '/staff', [lea, max])
  server.answer('GET', '/staff/roles', [lead, member, guest])
  server.answer('GET', '/staff/invitations', [])
  server.answer('GET', '/staff/u-1/devices', [])
  server.answer('GET', '/staff/u-2/devices', [])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the accounts of a tenant, one role each', () => {
  it('show the role, what the application keeps, the state and the last time the tenant saw them', async () => {
    staffScreen()
    await screen.findByText('Max Mitglied')

    const cells = within(rowOf('Max Mitglied'))
      .getAllByRole('cell')
      .map((cell) => cell.textContent)

    expect(cells.slice(0, 4)).toEqual([
      'Max Mitgliedmax@nord.example.de',
      'Mitglied',
      'A3',
      'Aktivnoch nie angemeldet',
    ])
    expect(rowOf('Lea Leitung').textContent).toContain('Aktiv, zweiter Faktor eingerichtet')
    expect(rowOf('Lea Leitung').textContent).toContain('zuletzt 20.09.2026')
    expect(
      within(accountsTable())
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual(['Zugang', 'Rolle', 'Regal', 'Zustand', 'Ändern'])
  })

  it('say under the table what the application says of its column, which roles ask for a second factor, and whom nobody demotes', async () => {
    staffScreen({ additions: shelves({ note: 'Wer kein Regal hat, sieht keines.' }) })
    await screen.findByText('Max Mitglied')

    expect(
      screen.getByText(
        'Wer kein Regal hat, sieht keines. Die Rolle Leitung verlangt einen zweiten Faktor. Die letzte Leitung bleibt Leitung.',
      ),
    ).toBeTruthy()
  })

  it('have no column where the application keeps nothing', async () => {
    staffScreen({ additions: null })
    await screen.findByText('Max Mitglied')

    expect(
      within(accountsTable())
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual(['Zugang', 'Rolle', 'Zustand', 'Ändern'])
  })

  it('show the cards of the application between the accounts and the invitations', async () => {
    staffScreen({ children: <p>Wer wen vertritt</p> })
    await screen.findByText('Max Mitglied')

    const between = screen.getByText('Wer wen vertritt')
    const after = await screen.findByText('Keine offene Einladung.')

    expect(
      accountsTable().compareDocumentPosition(between) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(between.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('show an open invitation with what the application keeps, and how it travels only where one can go by mail', async () => {
    server.answer('GET', '/staff/invitations', [invitation])

    staffScreen()

    const table = await screen.findByRole('table', {
      name: 'Einladungen, die noch benutzt werden können',
    })

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual(['Eingeladen', 'Rolle', 'Regal', 'Gilt bis', 'Zurückziehen'])
    expect(within(table).getByText('B1')).toBeTruthy()
    // Where the link goes by hand anyway, the screen says where mail is set up.
    expect(
      screen.getByText('Einladungen per E-Mail gibt es im Probewerk erst mit einem Mailserver.'),
    ).toBeTruthy()
  })

  it('show how an invitation travels where the tenant sends mail', async () => {
    server.answer('GET', '/staff/invitations', [invitation])

    staffScreen({ byMail: true })

    const table = await screen.findByRole('table', {
      name: 'Einladungen, die noch benutzt werden können',
    })

    expect(within(table).getByRole('columnheader', { name: 'Weg' })).toBeTruthy()
    expect(within(table).getByText('Link weitergegeben')).toBeTruthy()
    expect(screen.queryByText(/erst mit einem Mailserver/)).toBeNull()
  })

  it('withdraw an invitation only after asking', async () => {
    server.answer('GET', '/staff/invitations', [invitation])
    server.answer('DELETE', '/staff/invitations/i-1', {})

    staffScreen()

    const person = userEvent.setup()

    await person.click(
      await screen.findByRole('button', {
        name: 'Einladung an lina@nord.example.de zurückziehen',
      }),
    )
    expect(written()).toEqual([])

    const asking = await screen.findByRole('alertdialog', { name: 'Einladung zurückziehen?' })

    await person.click(within(asking).getByRole('button', { name: 'Zurückziehen' }))

    await waitFor(() => {
      expect(written()).toEqual(['DELETE /staff/invitations/i-1'])
    })
  })

  it('block somebody only after asking, unblock without, and let nobody block themselves', async () => {
    server.answer('GET', '/staff', [
      lea,
      max,
      {
        ...max,
        userId: 'u-3',
        name: 'Gesa Gesperrt',
        email: 'gesa@nord.example.de',
        blockedAt: '2026-09-30T08:00:00.000Z',
      },
    ])
    server.answer('PUT', '/staff/u-2/block', {})
    server.answer('DELETE', '/staff/u-3/block', {})

    staffScreen()
    await screen.findByText('Max Mitglied')

    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Max Mitglied sperren' }))
    expect(written()).toEqual([])

    const asking = await screen.findByRole('alertdialog', { name: 'Max Mitglied sperren?' })

    await person.click(within(asking).getByRole('button', { name: 'Sperren' }))
    await waitFor(() => {
      expect(written()).toEqual(['PUT /staff/u-2/block'])
    })

    await person.click(await screen.findByRole('button', { name: 'Gesa Gesperrt entsperren' }))
    await waitFor(() => {
      expect(written()).toEqual(['PUT /staff/u-2/block', 'DELETE /staff/u-3/block'])
    })

    expect(within(rowOf('Lea Leitung')).queryByRole('button', { name: /sperren$/ })).toBeNull()
    expect(
      within(rowOf('Lea Leitung')).getByRole('button', { name: 'Lea Leitung bearbeiten' }),
    ).toBeTruthy()
  })

  /**
   * A tenant may give a role the right to read the list without the right to
   * change it. Nothing the routes would refuse is offered then; the list, the
   * invitations and the devices stay readable.
   */
  it('offer nothing to change to somebody who may only read, and still show the devices', async () => {
    signedIn(
      server,
      [aTenant({ roles: ['lead'], roleLabels: ['Leitung'], rights: ['membership.read'] })],
      { name: 'Lea Leitung', email: 'lea@nord.example.de' },
    )
    server.answer('GET', '/staff/invitations', [invitation])
    server.answer('GET', '/staff/u-2/devices', devices)

    staffScreen()
    await screen.findByText('Max Mitglied')
    await screen.findByText('Lina Link')

    // The settings at the side stand once the rights are known, and only then
    // does a missing button say anything.
    const settings = screen.getByRole('navigation', { name: 'Einstellungen' })

    await within(settings).findByRole('link', { name: 'Zugänge' })

    expect(screen.queryByRole('button', { name: 'Zugang anlegen' })).toBeNull()
    expect(screen.queryByRole('button', { name: /bearbeiten$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /sperren$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /zurückziehen$/ })).toBeNull()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Geräte von Max Mitglied' }))

    const dialog = await screen.findByRole('dialog', { name: 'Geräte von Max Mitglied' })

    expect(
      await within(dialog).findByRole('list', {
        name: 'Wo Max Mitglied im Mandanten angemeldet ist',
      }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /abmelden$/ })).toBeNull()
  })

  it('open no dialog before the application knows what it keeps', async () => {
    staffScreen({ additions: shelves({ known: false }) })
    await screen.findByText('Max Mitglied')

    const create = await screen.findByRole('button', { name: 'Zugang anlegen' })

    expect((create as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Max Mitglied bearbeiten' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('say why the roles did not arrive, and offer no dialog without them', async () => {
    server.answer('GET', '/staff/roles', { message: 'Die Rollen sind gerade nicht zu haben.' }, 503)

    staffScreen()

    expect(await screen.findByText('Die Rollen sind gerade nicht zu haben.')).toBeTruthy()
    expect(
      ((await screen.findByRole('button', { name: 'Zugang anlegen' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})

describe('a new access', () => {
  it('goes out with one role and what the application keeps, and never asks for a password', async () => {
    server.answer('POST', '/staff', {
      token: 'b'.repeat(43),
      expiresAt: '2026-10-09T08:00:00.000Z',
    })

    staffScreen()

    const person = userEvent.setup()
    const dialog = await newAccess(person)

    expect(within(dialog).queryByLabelText(/Passwort/)).toBeNull()
    // What a new colleague usually is, the application says.
    expect(isPicked(dialog, 'Mitglied')).toBe(true)
    expect((within(dialog).getByLabelText('Regalname') as HTMLInputElement).value).toBe('A1')

    await person.type(within(dialog).getByLabelText(/^Name/), 'Nele Neu')
    await person.type(within(dialog).getByLabelText(/^E-Mail/), 'neu@nord.example.de')
    await person.click(within(dialog).getByRole('radio', { name: 'Gast' }))
    await person.clear(within(dialog).getByLabelText('Regalname'))
    await person.type(within(dialog).getByLabelText('Regalname'), 'C2')
    await person.click(within(dialog).getByRole('button', { name: 'Link erzeugen' }))

    await untilClosed()

    expect(sent('POST', '/staff')).toEqual([
      {
        name: 'Nele Neu',
        email: 'neu@nord.example.de',
        roles: ['guest'],
        send: 'link',
        additions: { shelf: 'C2', for: 'guest' },
      },
    ])
    expect(((await screen.findByLabelText('Einmal-Link')) as HTMLInputElement).value).toBe(
      `${globalThis.location.origin}/einladung/${'b'.repeat(43)}`,
    )
    expect(refreshed).toBeGreaterThan(0)
  })

  it('names nothing of the application where it keeps nothing', async () => {
    server.answer('POST', '/staff', {
      token: 'c'.repeat(43),
      expiresAt: '2026-10-09T08:00:00.000Z',
    })

    staffScreen({ additions: null })

    const person = userEvent.setup()
    const dialog = await newAccess(person)

    expect(within(dialog).queryByRole('group', { name: 'Regal' })).toBeNull()

    await person.type(within(dialog).getByLabelText(/^Name/), 'Nele Neu')
    await person.type(within(dialog).getByLabelText(/^E-Mail/), 'neu@nord.example.de')
    await person.click(within(dialog).getByRole('button', { name: 'Link erzeugen' }))

    await untilClosed()

    expect(sent('POST', '/staff')).toEqual([
      { name: 'Nele Neu', email: 'neu@nord.example.de', roles: ['member'], send: 'link' },
    ])
    expect(Object.keys(sent('POST', '/staff')[0] as object)).not.toContain('additions')
  })

  it('picks no role the tenant does not have, and waits for one', async () => {
    staffScreen({ suggestedRole: 'technician' })

    const person = userEvent.setup()
    const dialog = await newAccess(person)

    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([false, false, false])
    expect(
      (within(dialog).getByRole('button', { name: 'Link erzeugen' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    await person.click(within(dialog).getByRole('radio', { name: 'Mitglied' }))

    expect(
      (within(dialog).getByRole('button', { name: 'Link erzeugen' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('says what a role is for, and that one brings a second factor with it, before anything is sent', async () => {
    staffScreen()

    const person = userEvent.setup()
    const dialog = await newAccess(person)

    expect(
      within(dialog).getByRole('radio', { name: 'Leitung' }).getAttribute('aria-describedby'),
    ).toBeTruthy()
    expect(within(dialog).getByText('Alles im Mandanten.')).toBeTruthy()
    expect(within(dialog).queryByText(/zweiter Faktor Pflicht/)).toBeNull()

    await person.click(within(dialog).getByRole('radio', { name: 'Leitung' }))

    expect(within(dialog).getByText(/zweiter Faktor Pflicht/)).toBeTruthy()
    // The application's fields know the role picked beside them.
    expect(within(dialog).getByText('Die Leitung sieht jedes Regal.')).toBeTruthy()
    expect(written()).toEqual([])
  })

  it('goes by mail where the tenant sends mail, and shows no link then', async () => {
    server.answer('POST', '/staff', { token: null, expiresAt: '2026-10-09T08:00:00.000Z' })

    staffScreen({ byMail: true })

    const person = userEvent.setup()
    const dialog = await newAccess(person)

    expect(within(dialog).queryByText(/erst mit einem Mailserver/)).toBeNull()

    await person.type(within(dialog).getByLabelText(/^Name/), 'Nele Neu')
    await person.type(within(dialog).getByLabelText(/^E-Mail/), 'neu@nord.example.de')
    await person.click(within(dialog).getByRole('button', { name: 'Per E-Mail einladen' }))

    await untilClosed()

    expect(sent('POST', '/staff')).toEqual([
      {
        name: 'Nele Neu',
        email: 'neu@nord.example.de',
        roles: ['member'],
        send: 'mail',
        additions: { shelf: 'A1', for: 'member' },
      },
    ])
    expect(
      await screen.findByText(/Die Einladung geht per E-Mail an neu@nord.example.de/),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Einmal-Link')).toBeNull()
  })

  it('offers only the link to a tenant without mail, and says where mail is set up', async () => {
    staffScreen()

    const dialog = await newAccess(userEvent.setup())

    expect(within(dialog).queryByRole('button', { name: 'Per E-Mail einladen' })).toBeNull()
    expect(within(dialog).getByText(/erst mit einem Mailserver/)).toBeTruthy()
  })

  it('says in the dialog why it could not be made, in the words of the server, and stays open', async () => {
    server.answer('POST', '/staff', { message: 'Diese Person arbeitet schon im Mandanten.' }, 409)

    staffScreen()

    const person = userEvent.setup()
    const dialog = await newAccess(person)

    await person.type(within(dialog).getByLabelText(/^Name/), 'Max Mitglied')
    await person.type(within(dialog).getByLabelText(/^E-Mail/), 'max@nord.example.de')
    await person.click(within(dialog).getByRole('button', { name: 'Link erzeugen' }))

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Diese Person arbeitet schon im Mandanten.',
    )
    expect((within(dialog).getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Max Mitglied')
  })
})

describe('the access of somebody', () => {
  it('starts with what is held, and saves nothing where nothing was changed', async () => {
    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Max Mitglied')
    expect((within(dialog).getByLabelText('E-Mail') as HTMLInputElement).value).toBe(
      'max@nord.example.de',
    )
    expect(isPicked(dialog, 'Mitglied')).toBe(true)
    expect((within(dialog).getByLabelText('Regalname') as HTMLInputElement).value).toBe('A3')
    expect(
      within(dialog).getByText('Was hier berichtigt wird, steht im Protokoll des Mandanten.'),
    ).toBeTruthy()

    await save(person, dialog)
    await untilClosed()

    expect(written()).toEqual([])
  })

  it('sends a corrected name to the route of the account, alone', async () => {
    server.answer('PATCH', '/staff/u-2/account', {})

    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    await person.clear(within(dialog).getByLabelText('Name'))
    await person.type(within(dialog).getByLabelText('Name'), 'Max Mittler')
    await save(person, dialog)
    await untilClosed()

    expect(written()).toEqual(['PATCH /staff/u-2/account'])
    expect(sent('PATCH', '/staff/u-2/account')).toEqual([{ name: 'Max Mittler' }])
  })

  it('sends a corrected address to the route of the account, alone', async () => {
    server.answer('PATCH', '/staff/u-2/account', {})

    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    await person.clear(within(dialog).getByLabelText('E-Mail'))
    await person.type(within(dialog).getByLabelText('E-Mail'), 'm.mitglied@nord.example.de')
    await save(person, dialog)
    await untilClosed()

    expect(written()).toEqual(['PATCH /staff/u-2/account'])
    expect(sent('PATCH', '/staff/u-2/account')).toEqual([{ email: 'm.mitglied@nord.example.de' }])
  })

  it('sends a new role as the one role, with what the application keeps beside it', async () => {
    server.answer('PATCH', '/staff/u-2', {})

    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    await person.click(within(dialog).getByRole('radio', { name: 'Gast' }))
    await save(person, dialog)
    await untilClosed()

    expect(written()).toEqual(['PATCH /staff/u-2'])
    expect(sent('PATCH', '/staff/u-2')).toEqual([
      { roles: ['guest'], additions: { shelf: 'A3', for: 'guest' } },
    ])
    expect(refreshed).toBeGreaterThan(0)
  })

  it('sends what the application keeps with the role as it is held, where only that changed', async () => {
    server.answer('PATCH', '/staff/u-2', {})

    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    await person.clear(within(dialog).getByLabelText('Regalname'))
    await person.type(within(dialog).getByLabelText('Regalname'), 'B7')
    await save(person, dialog)
    await untilClosed()

    expect(sent('PATCH', '/staff/u-2')).toEqual([
      { roles: ['member'], additions: { shelf: 'B7', for: 'member' } },
    ])
  })

  it('corrects the account first, and then gives the role', async () => {
    server.answer('PATCH', '/staff/u-2/account', {})
    server.answer('PATCH', '/staff/u-2', {})

    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    await person.clear(within(dialog).getByLabelText('Name'))
    await person.type(within(dialog).getByLabelText('Name'), 'Max Mittler')
    await person.click(within(dialog).getByRole('radio', { name: 'Gast' }))
    await save(person, dialog)
    await untilClosed()

    expect(written()).toEqual(['PATCH /staff/u-2/account', 'PATCH /staff/u-2'])
  })

  /**
   * The fence of the route (`correctAccount` on the server): an account that
   * is not this tenant's alone is corrected by the person and nobody else.
   * Refused there, nothing else of the dialog is saved, or somebody would
   * read "nicht gespeichert" under a role that changed all the same.
   */
  it('gives no role where the account was refused, and says why in the words of the server', async () => {
    server.answer(
      'PATCH',
      '/staff/u-2/account',
      { message: 'Dieses Konto arbeitet auch für einen anderen Mandanten.' },
      409,
    )
    server.answer('PATCH', '/staff/u-2', {})

    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    await person.clear(within(dialog).getByLabelText('Name'))
    await person.type(within(dialog).getByLabelText('Name'), 'Max Mittler')
    await person.click(within(dialog).getByRole('radio', { name: 'Gast' }))
    await save(person, dialog)

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Dieses Konto arbeitet auch für einen anderen Mandanten.',
    )
    expect(written()).toEqual(['PATCH /staff/u-2/account'])
    expect(screen.getByRole('dialog', { name: 'Zugang bearbeiten' })).toBeTruthy()
  })

  it('says why the role could not be given, in the words of the server, and stays open', async () => {
    server.answer('PATCH', '/staff/u-2', { message: 'Diese Rolle gibt es hier nicht.' }, 422)

    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    await person.click(within(dialog).getByRole('radio', { name: 'Gast' }))
    await save(person, dialog)

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Diese Rolle gibt es hier nicht.',
    )
    expect(isPicked(dialog, 'Gast')).toBe(true)
  })

  it('keeps every role of a membership with several, until one is picked', async () => {
    server.answer('GET', '/staff', [lea, { ...max, roles: ['member', 'guest', 'ghost'] }])
    server.answer('PATCH', '/staff/u-2', {})

    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    // A key the tenant has no role for stands in the row and is left out of a
    // change: the server would refuse one that carried it along.
    expect(rowOf('Max Mitglied').textContent).toContain('Mitglied, Gast, ghost')
    // Several roles are none of the cards.
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([false, false, false])

    await person.clear(within(dialog).getByLabelText('Regalname'))
    await person.type(within(dialog).getByLabelText('Regalname'), 'B7')
    await save(person, dialog)
    await untilClosed()

    expect(sent('PATCH', '/staff/u-2')).toEqual([
      { roles: ['member', 'guest'], additions: { shelf: 'B7', for: 'member' } },
    ])
  })

  it('leaves one role of several once it is picked', async () => {
    server.answer('GET', '/staff', [lea, { ...max, roles: ['member', 'guest'] }])
    server.answer('PATCH', '/staff/u-2', {})

    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    await person.click(within(dialog).getByRole('radio', { name: 'Mitglied' }))
    await save(person, dialog)
    await untilClosed()

    expect(sent('PATCH', '/staff/u-2')).toEqual([
      { roles: ['member'], additions: { shelf: 'A3', for: 'member' } },
    ])
  })

  it('warns of the second factor for somebody who has none, and not for somebody who has', async () => {
    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)

    await person.click(within(dialog).getByRole('radio', { name: 'Leitung' }))
    expect(within(dialog).getByText(/zweiter Faktor Pflicht/)).toBeTruthy()

    await person.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
    await untilClosed()
    await person.click(screen.getByRole('button', { name: 'Lea Leitung bearbeiten' }))

    const own = await screen.findByRole('dialog', { name: 'Zugang bearbeiten' })

    expect(isPicked(own, 'Leitung')).toBe(true)
    expect(within(own).queryByText(/zweiter Faktor Pflicht/)).toBeNull()
  })

  it('lists the devices by the names the application gives its entries, and signs one out only after asking', async () => {
    server.answer('GET', '/staff/u-2/devices', devices)
    server.answer('DELETE', '/staff/u-2/devices/s-2', {})

    staffScreen()

    const person = userEvent.setup()
    const dialog = await accessOfMax(person)
    const list = await within(dialog).findByRole('list', {
      name: 'Wo Max Mitglied im Mandanten angemeldet ist',
    })

    expect(list.textContent).toContain('Schreibtisch, 12 Stunden')
    expect(list.textContent).toContain('Unterwegs, 30 Tage')

    await person.click(within(list).getByRole('button', { name: 'Chrome auf Android abmelden' }))
    expect(written()).toEqual([])

    // Escape answers the question and leaves the dialog under it.
    await person.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Zugang bearbeiten' })).toBeTruthy()

    await person.click(within(list).getByRole('button', { name: 'Chrome auf Android abmelden' }))

    const asking = await screen.findByRole('alertdialog', { name: 'Gerät abmelden?' })

    await person.click(within(asking).getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(written()).toEqual(['DELETE /staff/u-2/devices/s-2'])
    })
    // Signing a device out saves nothing of the dialog and does not close it.
    expect(screen.getByRole('dialog', { name: 'Zugang bearbeiten' })).toBeTruthy()
  })

  it('says in the words of the application where somebody is signed in nowhere', async () => {
    staffScreen()

    const dialog = await accessOfMax(userEvent.setup())

    expect(
      await within(dialog).findByText(
        'Im Mandanten ist gerade kein Gerät dieser Person angemeldet.',
      ),
    ).toBeTruthy()
  })
})

describe('the accounts on a phone', () => {
  it('are a box per person with the role, what the application keeps, the state and what can be done', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    staffScreen()

    const accounts = await screen.findByRole('list', { name: 'Konten des Mandanten' })
    const box = within(accounts).getByText('Max Mitglied').closest('li') as HTMLElement

    expect(screen.queryByRole('table')).toBeNull()
    expect(box.textContent).toContain('max@nord.example.de')
    expect(box.textContent).toContain('Regal: A3')
    expect(box.textContent).toContain('Aktiv, noch nie angemeldet')
    expect(await within(box).findByRole('button', { name: 'Max Mitglied bearbeiten' })).toBeTruthy()
    expect(within(box).getByRole('button', { name: 'Max Mitglied sperren' })).toBeTruthy()
  })
})
