import type { RoleDefinition } from '@opengewerk/platform-domain'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aTenant, signedIn, standInServer } from '../in-frame.js'
import type { StandIn } from '../in-frame.js'
import { InRouter } from '../in-router.js'
import { InProbe } from '../probe-application.js'
import { StaffScreen } from './staff.js'

/**
 * The screen the people of a tenant are looked after on: who works in it,
 * with which roles and on which devices, and the invitations still open.
 *
 * Two of the checks here are about something that must not be on the screen,
 * which is unusual for a test and is the point of this one. A password field
 * would look perfectly reasonable in a form that creates an account, and it is
 * exactly what the whole link exists to avoid.
 *
 * What the tenant is called, where its mail is set up, which role a new
 * colleague usually has and whether the tenant sends mail at all is the
 * application's to say (ADR 0010). The one in these tests belongs to nobody.
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

/** The roles a tenant of the probe application starts with. */
const probeRoles = [lead, member, guest]

const lea = {
  userId: 'u-1',
  name: 'Lea Leitung',
  email: 'lea@nord.example.de',
  roles: ['lead'],
  blockedAt: null,
  lastSignInAt: '2026-09-20T08:00:00.000Z',
  twoFactorEnabled: true,
}

const max = {
  userId: 'u-2',
  name: 'Max Mitglied',
  email: 'max@nord.example.de',
  roles: ['member'],
  blockedAt: null,
  lastSignInAt: null,
  twoFactorEnabled: false,
}

const invitation = {
  email: 'x@nord.example.de',
  roles: ['member'],
  expiresAt: '2026-10-09T08:00:00.000Z',
  invitedBy: 'u-1',
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

function staffScreen({
  byMail = false,
  suggestedRoles = ['member'],
  at = '/einstellungen/zugaenge',
}: { byMail?: boolean; suggestedRoles?: readonly string[]; at?: string } = {}) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InProbe>
        <InRouter at={at}>
          <StaffScreen byMail={byMail} suggestedRoles={suggestedRoles} />
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

function accountsTable() {
  return screen.getByRole('table', { name: 'Konten des Mandanten' })
}

function rowOf(name: string): HTMLElement {
  return within(accountsTable()).getByText(name).closest('tr') as HTMLElement
}

/** The form of a new account, by the button that sends a link. */
function inviteForm(): HTMLElement {
  return screen.getByRole('button', { name: 'Link erzeugen' }).closest('form') as HTMLElement
}

/** The words beside the boxes in one container, in the order they stand. */
function boxes(container: HTMLElement): (string | null | undefined)[] {
  return within(container)
    .getAllByRole('checkbox')
    .map((box) => box.closest('label')?.textContent)
}

function ticked(container: HTMLElement): boolean[] {
  return within(container)
    .getAllByRole('checkbox')
    .map((box) => (box as HTMLInputElement).checked)
}

/**
 * Until the answer with the rights is there, the screen offers nothing to
 * change, so a test that clicks something in a row waits for it first; a box
 * clicked before would do nothing, and a test about nothing being sent would
 * pass for the wrong reason.
 */
async function mayChange() {
  await screen.findByRole('button', { name: 'Zugang anlegen' })
}

beforeEach(() => {
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
  server.answer('GET', '/staff/roles', probeRoles)
  server.answer('GET', '/staff/invitations', [])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the staff screen', () => {
  it('shows who works here, with roles and the last time the tenant saw them', async () => {
    staffScreen()

    expect(await screen.findByText('Max Mitglied')).toBeTruthy()
    expect(screen.getByText('lea@nord.example.de')).toBeTruthy()
    // Somebody who has never signed in says so in a word, not with a dash.
    expect(screen.getByText('Noch nie')).toBeTruthy()
  })

  it('says what it lists and names its table in the words of the application', async () => {
    staffScreen()
    await screen.findByText('Max Mitglied')

    expect(screen.getByText('Wer im Mandanten mitarbeitet.')).toBeTruthy()
    expect(accountsTable()).toBeTruthy()
  })

  /**
   * Opened somewhere else than at its own address: there the router marks the
   * link to the address it stands on by itself, and the entry would light
   * whatever key the screen gave. Here only the key can light it.
   */
  it('is lit among the settings under its own key', async () => {
    staffScreen({ at: '/anderswo' })
    await screen.findByText('Max Mitglied')

    const settings = screen.getByRole('navigation', { name: 'Einstellungen' })
    const entry = await within(settings).findByRole('link', { name: 'Zugänge' })
    const other = within(settings).getByRole('link', { name: 'Notizen' })

    expect(entry.getAttribute('aria-current')).toBe('page')
    expect(entry.className).toContain('font-semibold')
    expect(other.getAttribute('aria-current')).toBeNull()
    expect(other.className).not.toContain('font-semibold')
  })

  /**
   * The sentence from the issue, as a check: a password a colleague knows and
   * that then stays for three years is worse than one nobody knows. So the one
   * field that must never appear on this screen is a password, neither for
   * setting one nor for showing one.
   */
  it('never asks for or shows a password', async () => {
    staffScreen()
    await screen.findByText('Max Mitglied')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Zugang anlegen' }))

    expect(screen.getByLabelText('E-Mail')).toBeTruthy()
    expect(screen.queryByLabelText(/Passwort/)).toBeNull()
  })

  /**
   * The wall from #62, named before somebody walks into it.
   *
   * The requirement hangs on the role and is checked on every request, so the
   * person given such a role meets it at their next click. The server does
   * not refuse the change and should not; this warning is what turns a 403
   * nobody expected into something somebody chose.
   */
  it('says that a role brings a second factor with it, before the change', async () => {
    staffScreen()
    await screen.findByText('Max Mitglied')

    const person = userEvent.setup()

    // The general sentence stands over the list at all times, so that it is on
    // screen while somebody is reaching for a checkbox rather than after.
    expect(screen.getByText(/Die Rolle Leitung verlangt einen zweiten Faktor/)).toBeTruthy()

    await person.click(await screen.findByRole('button', { name: 'Zugang anlegen' }))
    expect(screen.queryByText(/zweiter Faktor Pflicht/)).toBeNull()

    // Scoped to the form, because the rows of the table carry the same boxes
    // and clicking one of those would change somebody's roles instead of
    // filling in a form.
    await person.click(within(inviteForm()).getByLabelText('Leitung'))

    expect(screen.getByText(/zweiter Faktor Pflicht/)).toBeTruthy()
    // And nothing has been sent: the warning is shown while somebody is still
    // filling the form in, which is the only moment it is worth anything.
    expect(sent('POST', '/staff')).toEqual([])
  })

  it('hands the link over once, and says that there is no second time', async () => {
    server.answer('POST', '/staff', {
      token: 'b'.repeat(43),
      expiresAt: '2026-10-09T08:00:00.000Z',
      email: 'neu@nord.example.de',
    })

    staffScreen()
    await screen.findByText('Max Mitglied')

    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Zugang anlegen' }))
    await person.type(screen.getByLabelText('Name'), 'Nele Neu')
    await person.type(screen.getByLabelText('E-Mail'), 'neu@nord.example.de')
    await person.click(screen.getByRole('button', { name: 'Link erzeugen' }))

    expect(sent('POST', '/staff')).toEqual([
      { name: 'Nele Neu', email: 'neu@nord.example.de', roles: ['member'], send: 'link' },
    ])

    // The address is put together in the browser, out of the one it is already
    // looking at. The server is never told an address of its own.
    const link = await screen.findByLabelText('Einmal-Link')

    expect((link as HTMLInputElement).value).toBe(
      `${globalThis.location.origin}/einladung/${'b'.repeat(43)}`,
    )
    expect(screen.getByText(/nur jetzt hier/)).toBeTruthy()
  })

  it('sends the invitation by mail where the application says the tenant sends mail', async () => {
    server.answer('POST', '/staff', {
      id: 'i-1',
      token: null,
      expiresAt: '2026-10-09T08:00:00.000Z',
      email: 'neu@nord.example.de',
    })

    staffScreen({ byMail: true })
    await screen.findByText('Max Mitglied')

    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Zugang anlegen' }))
    await person.type(screen.getByLabelText('Name'), 'Nele Neu')
    await person.type(screen.getByLabelText('E-Mail'), 'neu@nord.example.de')
    await person.click(screen.getByRole('button', { name: 'Per E-Mail einladen' }))

    expect(sent('POST', '/staff')).toEqual([
      { name: 'Nele Neu', email: 'neu@nord.example.de', roles: ['member'], send: 'mail' },
    ])

    // No link to copy: it exists in the message and nowhere else. How long it
    // holds is the foundation's to say, who does not see it the application's.
    const said = await screen.findByRole('status')

    expect(said.textContent).toBe(
      'Die Einladung geht per E-Mail an neu@nord.example.de. Der Link darin gilt sieben Tage und funktioniert genau einmal; am Schreibtisch des Mandanten sieht ihn keiner. Ob die E-Mail angekommen ist, steht unten bei den offenen Einladungen.',
    )
    expect(screen.queryByLabelText('Einmal-Link')).toBeNull()
  })

  it('offers only the link to a tenant without mail, and says where mail is set up', async () => {
    staffScreen({ byMail: false })
    await screen.findByText('Max Mitglied')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Zugang anlegen' }))

    expect(screen.getByRole('button', { name: 'Link erzeugen' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Per E-Mail einladen' })).toBeNull()
    expect(
      screen.getByText('Einladungen per E-Mail gibt es im Probewerk erst mit einem Mailserver.'),
    ).toBeTruthy()
  })

  it('says for each open invitation how it travels', async () => {
    server.answer('GET', '/staff/invitations', [
      { ...invitation, id: 'i-1', name: 'Lina Link', mail: null },
      {
        ...invitation,
        id: 'i-2',
        name: 'Paul Post',
        mail: { status: 'sent', sentAt: '2026-09-22T08:05:00.000Z', lastError: null },
      },
      {
        ...invitation,
        id: 'i-3',
        name: 'Willi Wartet',
        mail: { status: 'pending', sentAt: null, lastError: 'ECONNREFUSED' },
      },
      {
        ...invitation,
        id: 'i-4',
        name: 'Fritz Fehler',
        mail: { status: 'failed', sentAt: null, lastError: 'EENVELOPE: Adresse unbekannt' },
      },
      {
        ...invitation,
        id: 'i-5',
        name: 'Olga Ohne',
        mail: { status: 'failed', sentAt: null, lastError: null },
      },
    ])

    staffScreen()

    const table = await screen.findByRole('table', {
      name: 'Einladungen, die noch benutzt werden können',
    })
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement

    expect(within(row('Lina Link')).getByText('Link weitergegeben')).toBeTruthy()
    expect(within(row('Paul Post')).getByText(/^Per E-Mail verschickt am /)).toBeTruthy()
    expect(within(row('Willi Wartet')).getByText('E-Mail wartet: ECONNREFUSED')).toBeTruthy()
    expect(
      within(row('Fritz Fehler')).getByText(
        'E-Mail nicht zugestellt: EENVELOPE: Adresse unbekannt',
      ),
    ).toBeTruthy()
    expect(within(row('Olga Ohne')).getByText('E-Mail nicht zugestellt: ohne Angabe')).toBeTruthy()
  })

  it('says so where no invitation is open', async () => {
    staffScreen()

    expect(await screen.findByText('Keine offene Einladung.')).toBeTruthy()
  })

  it('withdraws an invitation only after asking', async () => {
    server.answer('GET', '/staff/invitations', [
      { ...invitation, id: 'i-1', name: 'Lina Link', mail: null },
    ])
    server.answer('DELETE', '/staff/invitations/i-1', {})

    staffScreen()

    const person = userEvent.setup()

    await person.click(
      await screen.findByRole('button', { name: 'Einladung an x@nord.example.de zurückziehen' }),
    )

    const asking = await screen.findByRole('alertdialog', { name: 'Einladung zurückziehen?' })

    expect(asking.textContent).toContain('x@nord.example.de gilt danach nicht mehr')
    expect(server.heard.some((call) => call.method === 'DELETE')).toBe(false)

    await person.click(within(asking).getByRole('button', { name: 'Zurückziehen' }))

    await waitFor(() => {
      expect(server.heard.some((call) => call.method === 'DELETE')).toBe(true)
    })
  })

  it('sends the roles of one person the moment a box is ticked', async () => {
    staffScreen()
    await screen.findByText('Max Mitglied')

    await mayChange()
    await userEvent.setup().click(within(rowOf('Max Mitglied')).getByLabelText('Gast'))

    expect(sent('PATCH', '/staff/u-2')).toEqual([{ roles: ['member', 'guest'] }])
  })

  it('takes no last role from somebody: the box of the only one stays as it is', async () => {
    staffScreen()
    await screen.findByText('Max Mitglied')

    await mayChange()
    await userEvent.setup().click(within(rowOf('Max Mitglied')).getByLabelText('Mitglied'))

    expect(sent('PATCH', '/staff/u-2')).toEqual([])
  })

  it('says why roles could not be changed, in the words of the server', async () => {
    server.answer('PATCH', '/staff/u-2', { message: 'Diese Rolle gibt es hier nicht.' }, 422)

    staffScreen()
    await screen.findByText('Max Mitglied')

    await mayChange()
    await userEvent.setup().click(within(rowOf('Max Mitglied')).getByLabelText('Gast'))

    expect((await screen.findByRole('alert')).textContent).toBe('Diese Rolle gibt es hier nicht.')
  })

  it('blocks somebody only after asking, and lets nobody block themselves', async () => {
    server.answer('PUT', '/staff/u-2/block', {})

    staffScreen()
    await screen.findByText('Max Mitglied')

    const person = userEvent.setup()

    await mayChange()
    expect(within(rowOf('Lea Leitung')).queryByRole('button', { name: /sperren$/ })).toBeNull()

    await person.click(screen.getByRole('button', { name: 'Max Mitglied sperren' }))

    const asking = await screen.findByRole('alertdialog', { name: 'Max Mitglied sperren?' })

    expect(asking.textContent).toContain('alle Geräte dieses Zugangs werden abgemeldet')
    expect(server.heard.some((call) => call.path === '/staff/u-2/block')).toBe(false)

    await person.click(within(asking).getByRole('button', { name: 'Sperren' }))

    await waitFor(() => {
      expect(
        server.heard.some((call) => call.method === 'PUT' && call.path === '/staff/u-2/block'),
      ).toBe(true)
    })
  })

  it('unblocks somebody without asking, because that takes nothing away', async () => {
    server.answer('GET', '/staff', [lea, { ...max, blockedAt: '2026-09-30T12:00:00.000Z' }])
    server.answer('DELETE', '/staff/u-2/block', {})

    staffScreen()

    expect(
      await within(await screen.findByRole('table', { name: 'Konten des Mandanten' })).findByText(
        /^Gesperrt seit /,
      ),
    ).toBeTruthy()

    await mayChange()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Max Mitglied entsperren' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => {
      expect(
        server.heard.some((call) => call.method === 'DELETE' && call.path === '/staff/u-2/block'),
      ).toBe(true)
    })
  })

  it('shows the devices of a person, by the names the application gives its entries and how long each holds', async () => {
    server.answer('GET', '/staff/u-2/devices', devices)

    staffScreen()
    await screen.findByText('Max Mitglied')

    await userEvent
      .setup()
      .click(within(rowOf('Max Mitglied')).getByRole('button', { name: 'Geräte' }))

    const table = await screen.findByRole('table', {
      name: 'Wo Max Mitglied im Mandanten angemeldet ist',
    })

    expect(within(table).getByText('Schreibtisch, 12 Stunden')).toBeTruthy()
    expect(within(table).getByText('Unterwegs, 30 Tage')).toBeTruthy()
    expect(within(table).getByText('Chrome auf Windows')).toBeTruthy()
  })

  it('says in the words of the application where a person is signed in nowhere', async () => {
    server.answer('GET', '/staff/u-2/devices', [])

    staffScreen()
    await screen.findByText('Max Mitglied')

    await userEvent
      .setup()
      .click(within(rowOf('Max Mitglied')).getByRole('button', { name: 'Geräte' }))

    expect(
      await screen.findByText('Im Mandanten ist gerade kein Gerät dieser Person angemeldet.'),
    ).toBeTruthy()
  })

  it('signs a device of somebody out only after asking', async () => {
    server.answer('GET', '/staff/u-2/devices', devices)
    server.answer('DELETE', '/staff/u-2/devices/s-2', {})

    staffScreen()
    await screen.findByText('Max Mitglied')

    const person = userEvent.setup()

    await person.click(within(rowOf('Max Mitglied')).getByRole('button', { name: 'Geräte' }))
    await person.click(await screen.findByRole('button', { name: 'Chrome auf Android abmelden' }))

    const asking = await screen.findByRole('alertdialog', { name: 'Gerät abmelden?' })

    expect(asking.textContent).toContain('Chrome auf Android muss sich danach neu anmelden')

    await person.click(within(asking).getByRole('button', { name: 'Abmelden' }))

    await waitFor(() => {
      expect(
        server.heard.some(
          (call) => call.method === 'DELETE' && call.path === '/staff/u-2/devices/s-2',
        ),
      ).toBe(true)
    })
  })

  /**
   * A tenant may give a role the right to read the list without the right to
   * change it (opengewerk-haustechnik#31). Nothing the routes would refuse is
   * offered then; the list, the invitations and the devices stay readable.
   */
  it('offers nothing to change to somebody who may only read it', async () => {
    signedIn(
      server,
      [aTenant({ roles: ['lead'], roleLabels: ['Leitung'], rights: ['membership.read'] })],
      { name: 'Lea Leitung', email: 'lea@nord.example.de' },
    )
    server.answer('GET', '/staff/invitations', [
      { ...invitation, id: 'i-1', name: 'Lina Link', mail: null },
    ])
    server.answer('GET', '/staff/u-2/devices', devices)

    staffScreen()
    await screen.findByText('Max Mitglied')
    await screen.findByText('Lina Link')

    // The settings at the side stand once the rights are known, and only then
    // does a missing button say anything.
    const settings = screen.getByRole('navigation', { name: 'Einstellungen' })

    await within(settings).findByRole('link', { name: 'Zugänge' })

    expect(screen.queryByRole('button', { name: 'Zugang anlegen' })).toBeNull()
    expect(screen.queryByRole('button', { name: /sperren$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /zurückziehen$/ })).toBeNull()
    expect(
      within(rowOf('Max Mitglied'))
        .getAllByRole('checkbox')
        .map((box) => (box as HTMLInputElement).disabled),
    ).toEqual([true, true, true])

    await userEvent
      .setup()
      .click(within(rowOf('Max Mitglied')).getByRole('button', { name: 'Geräte' }))

    expect(
      await screen.findByRole('table', { name: 'Wo Max Mitglied im Mandanten angemeldet ist' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /abmelden$/ })).toBeNull()
  })

  it('says why the list did not arrive, in the words of the server', async () => {
    server.answer('GET', '/staff', { message: 'Dafür fehlt das Recht.' }, 403)

    staffScreen()

    expect(await screen.findByText('Dafür fehlt das Recht.')).toBeTruthy()
  })
})

/**
 * The roles on offer are the rows of the tenant (ADR 0010), as the server
 * lists them, and not a list in this code. A tenant that calls its roles
 * something else, dropped one and made one of its own is the case a list in
 * the code would get wrong in every line.
 */
describe('the staff screen on a phone', () => {
  /**
   * A window narrower than every band above the phone. The three tables of
   * the screen are boxes there, drawn by other code than their rows: a button
   * or a box of a role missing from them would be missing on every phone and
   * in no test at a desk (opengewerk-haustechnik#31).
   */
  function onAPhone() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  }

  /** The box of one person among the accounts. */
  async function boxOf(name: string): Promise<HTMLElement> {
    const accounts = await screen.findByRole('list', { name: 'Konten des Mandanten' })

    return within(accounts).getByText(name).closest('li') as HTMLElement
  }

  it('shows a box per person with name, roles, state and what can be done, and no table', async () => {
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
    onAPhone()
    staffScreen()

    const maxBox = await boxOf('Max Mitglied')

    expect(screen.queryByRole('table')).toBeNull()
    expect(maxBox.textContent).toContain('max@nord.example.de')
    expect(boxes(maxBox)).toEqual(['Leitung', 'Mitglied', 'Gast'])
    expect(ticked(maxBox)).toEqual([false, true, false])
    // State and last sign in, in one line under the roles.
    expect(maxBox.textContent).toContain('Aktiv · Noch nie')

    await mayChange()

    expect(within(maxBox).getByRole('button', { name: 'Geräte' })).toBeTruthy()
    expect(within(maxBox).getByRole('button', { name: 'Max Mitglied sperren' }).textContent).toBe(
      'Sperren',
    )

    // Whoever is looking is marked and cannot block themselves, in a box as in a row.
    const leaBox = await boxOf('Lea Leitung')

    expect(leaBox.textContent).toContain('Sie')
    expect(leaBox.textContent).toContain('Aktiv, zweiter Faktor eingerichtet')
    expect(within(leaBox).queryByRole('button', { name: /sperren$/ })).toBeNull()

    const gesaBox = await boxOf('Gesa Gesperrt')

    expect(gesaBox.textContent).toContain('Gesperrt seit')
    expect(
      within(gesaBox).getByRole('button', { name: 'Gesa Gesperrt entsperren' }).textContent,
    ).toBe('Entsperren')
  })

  it('sends the roles of a person from a box the way a row does', async () => {
    onAPhone()
    staffScreen()

    const box = await boxOf('Max Mitglied')

    await mayChange()
    await userEvent.setup().click(within(box).getByLabelText('Gast'))

    expect(sent('PATCH', '/staff/u-2')).toEqual([{ roles: ['member', 'guest'] }])
  })

  it('blocks somebody from a box only after asking', async () => {
    server.answer('PUT', '/staff/u-2/block', {})
    onAPhone()
    staffScreen()

    const box = await boxOf('Max Mitglied')
    const person = userEvent.setup()

    await mayChange()
    await person.click(within(box).getByRole('button', { name: 'Max Mitglied sperren' }))

    const asking = await screen.findByRole('alertdialog', { name: 'Max Mitglied sperren?' })

    expect(server.heard.some((call) => call.path === '/staff/u-2/block')).toBe(false)

    await person.click(within(asking).getByRole('button', { name: 'Sperren' }))

    await waitFor(() => {
      expect(
        server.heard.some((call) => call.method === 'PUT' && call.path === '/staff/u-2/block'),
      ).toBe(true)
    })
  })

  it('shows an open invitation in a box, with how it travels and the way to withdraw it', async () => {
    server.answer('GET', '/staff/invitations', [
      { ...invitation, id: 'i-1', name: 'Lina Link', mail: null },
    ])
    server.answer('DELETE', '/staff/invitations/i-1', {})
    onAPhone()
    staffScreen()

    const invitations = await screen.findByRole('list', {
      name: 'Einladungen, die noch benutzt werden können',
    })
    const box = within(invitations).getByText('Lina Link').closest('li') as HTMLElement

    expect(box.textContent).toContain('x@nord.example.de · Mitglied · bis ')
    expect(box.textContent).toContain('Link weitergegeben')

    const person = userEvent.setup()

    await mayChange()
    await person.click(
      within(box).getByRole('button', { name: 'Einladung an x@nord.example.de zurückziehen' }),
    )
    await person.click(
      within(await screen.findByRole('alertdialog', { name: 'Einladung zurückziehen?' })).getByRole(
        'button',
        { name: 'Zurückziehen' },
      ),
    )

    await waitFor(() => {
      expect(
        server.heard.some(
          (call) => call.method === 'DELETE' && call.path === '/staff/invitations/i-1',
        ),
      ).toBe(true)
    })
  })

  it('shows the devices of a person in boxes, each with the way to sign it out', async () => {
    server.answer('GET', '/staff/u-2/devices', devices)
    server.answer('DELETE', '/staff/u-2/devices/s-2', {})
    onAPhone()
    staffScreen()

    const person = userEvent.setup()

    await person.click(within(await boxOf('Max Mitglied')).getByRole('button', { name: 'Geräte' }))

    const list = await screen.findByRole('list', {
      name: 'Wo Max Mitglied im Mandanten angemeldet ist',
    })
    const desk = within(list).getByText('Chrome auf Windows').closest('li') as HTMLElement
    const phone = within(list).getByText('Chrome auf Android').closest('li') as HTMLElement

    expect(desk.textContent).toContain('Schreibtisch, 12 Stunden')
    expect(phone.textContent).toContain('Unterwegs, 30 Tage')

    await mayChange()
    await person.click(within(phone).getByRole('button', { name: 'Chrome auf Android abmelden' }))
    await person.click(
      within(await screen.findByRole('alertdialog', { name: 'Gerät abmelden?' })).getByRole(
        'button',
        { name: 'Abmelden' },
      ),
    )

    await waitFor(() => {
      expect(
        server.heard.some(
          (call) => call.method === 'DELETE' && call.path === '/staff/u-2/devices/s-2',
        ),
      ).toBe(true)
    })
  })

  it('offers nothing to change in a box to somebody who may only read', async () => {
    signedIn(
      server,
      [aTenant({ roles: ['lead'], roleLabels: ['Leitung'], rights: ['membership.read'] })],
      { name: 'Lea Leitung', email: 'lea@nord.example.de' },
    )
    server.answer('GET', '/staff/invitations', [
      { ...invitation, id: 'i-1', name: 'Lina Link', mail: null },
    ])
    server.answer('GET', '/staff/u-2/devices', devices)
    onAPhone()
    staffScreen()

    const box = await boxOf('Max Mitglied')

    await userEvent.setup().click(within(box).getByRole('button', { name: 'Geräte' }))
    await screen.findByRole('list', { name: 'Wo Max Mitglied im Mandanten angemeldet ist' })
    // The settings at the side are listed once the rights are known.
    await within(screen.getByRole('navigation', { name: 'Einstellungen' })).findByRole('link', {
      name: 'Zugänge',
    })

    expect(screen.queryByRole('button', { name: /sperren$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /zurückziehen$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /abmelden$/ })).toBeNull()
    expect(
      within(box)
        .getAllByRole('checkbox')
        .every((role) => (role as HTMLInputElement).disabled),
    ).toBe(true)
  })
})

describe('the roles of the tenant', () => {
  const head: RoleDefinition = { ...lead, label: 'Vorsitz' }
  const worker: RoleDefinition = { ...member, label: 'Helfer' }
  const books: RoleDefinition = {
    key: 'books',
    label: 'Kasse',
    rights: ['shelf.read'],
    leads: false,
    secondFactor: true,
  }
  const itsOwn = [head, worker, books]

  beforeEach(() => {
    server.answer('GET', '/staff/roles', itsOwn)
    server.answer('GET', '/staff', [lea, { ...max, roles: ['member', 'books'] }])
  })

  it('are offered by the names the tenant gives them, on every row', async () => {
    staffScreen()
    await screen.findByRole('table', { name: 'Konten des Mandanten' })

    expect(boxes(rowOf('Max Mitglied'))).toEqual(['Vorsitz', 'Helfer', 'Kasse'])
    expect(ticked(rowOf('Max Mitglied'))).toEqual([false, true, true])
    expect(within(rowOf('Lea Leitung')).queryByLabelText('Gast')).toBeNull()
  })

  /**
   * Which roles ask for a second factor is in their rows. The sentence over
   * the table names them, and somebody who holds one without a factor is
   * marked, whatever the role is called.
   */
  it('say which of them ask for a second factor, and who is missing one', async () => {
    staffScreen()
    await screen.findByRole('table', { name: 'Konten des Mandanten' })

    expect(
      screen.getByText(/Die Rollen Vorsitz und Kasse verlangen einen zweiten Faktor/),
    ).toBeTruthy()
    expect(within(rowOf('Max Mitglied')).getByText('Zweiter Faktor fehlt')).toBeTruthy()
    // Lea has hers.
    expect(within(rowOf('Lea Leitung')).queryByText('Zweiter Faktor fehlt')).toBeNull()
  })

  it('name three that ask for a factor in a list, and none where none does', async () => {
    server.answer('GET', '/staff/roles', [head, { ...worker, secondFactor: true }, books])

    staffScreen()
    await screen.findByRole('table', { name: 'Konten des Mandanten' })

    expect(
      screen.getByText(/^Die Rollen Vorsitz, Helfer und Kasse verlangen einen zweiten Faktor\./),
    ).toBeTruthy()
  })

  it('say nothing of a factor where no role asks for one', async () => {
    server.answer('GET', '/staff/roles', [{ ...head, secondFactor: false }, worker])
    server.answer('GET', '/staff', [lea, max])

    staffScreen()
    await screen.findByRole('table', { name: 'Konten des Mandanten' })

    expect(screen.queryByText(/verlangt? einen zweiten Faktor/)).toBeNull()
    expect(within(rowOf('Max Mitglied')).getByText('Aktiv')).toBeTruthy()
  })

  /** A passkey signs in only when confirmed on the device, and counts as a second factor (#167). */
  it('count a passkey as a second factor', async () => {
    server.answer('GET', '/staff', [
      lea,
      { ...max, roles: ['member', 'books'], twoFactorEnabled: false, hasPasskey: true },
    ])

    staffScreen()
    await screen.findByRole('table', { name: 'Konten des Mandanten' })

    expect(
      within(rowOf('Max Mitglied')).getByText('Aktiv, zweiter Faktor eingerichtet'),
    ).toBeTruthy()
  })

  it('are the boxes of an invitation, with the warning for the one that asks for a factor', async () => {
    server.answer('POST', '/staff', {
      token: 'c'.repeat(43),
      expiresAt: '2026-10-09T08:00:00.000Z',
    })

    staffScreen()
    await screen.findByRole('table', { name: 'Konten des Mandanten' })

    const person = userEvent.setup()

    await person.click(await screen.findByRole('button', { name: 'Zugang anlegen' }))

    const form = inviteForm()

    expect(boxes(form)).toEqual(['Vorsitz', 'Helfer', 'Kasse'])
    expect(screen.queryByText(/zweiter Faktor Pflicht/)).toBeNull()

    await person.click(within(form).getByLabelText('Kasse'))
    expect(screen.getByText(/zweiter Faktor Pflicht/)).toBeTruthy()

    await person.type(within(form).getByLabelText('Name'), 'Karla Kasse')
    await person.type(within(form).getByLabelText('E-Mail'), 'kasse@nord.example.de')
    await person.click(within(form).getByRole('button', { name: 'Link erzeugen' }))

    expect(sent('POST', '/staff')).toEqual([
      {
        name: 'Karla Kasse',
        email: 'kasse@nord.example.de',
        roles: ['member', 'books'],
        send: 'link',
      },
    ])
  })

  /** Which box starts ticked is the application's to say: what a new colleague usually is. */
  it('start the form with what the application suggests', async () => {
    staffScreen({ suggestedRoles: ['books'] })
    await screen.findByRole('table', { name: 'Konten des Mandanten' })

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Zugang anlegen' }))

    expect(ticked(inviteForm())).toEqual([false, false, true])
    // The one ticked asks for a factor, so the warning stands from the start.
    expect(screen.getByText(/zweiter Faktor Pflicht/)).toBeTruthy()
  })

  /**
   * In a tenant without the role the application suggests, nothing is ticked,
   * nothing of that name goes out, and the form waits for a choice.
   */
  it('tick nothing a tenant does not have', async () => {
    server.answer('GET', '/staff/roles', [head, books])

    staffScreen({ suggestedRoles: ['member'] })
    await screen.findByRole('table', { name: 'Konten des Mandanten' })

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Zugang anlegen' }))

    expect(ticked(inviteForm())).toEqual([false, false])
    expect(
      (screen.getByRole('button', { name: 'Link erzeugen' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('offer no form before they are known', async () => {
    server.answer('GET', '/staff/roles', { message: 'Die Rollen sind gerade nicht zu haben.' }, 503)

    staffScreen()

    expect(await screen.findByText('Die Rollen sind gerade nicht zu haben.')).toBeTruthy()
    expect(
      ((await screen.findByRole('button', { name: 'Zugang anlegen' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  /**
   * A membership can still name a key the tenant has no role for any more.
   * It is shown, so that nobody wonders what the person holds, and it is left
   * out of the next change, which the server would otherwise refuse whole.
   */
  it('leave a key without a role out of a change, and show it in an invitation', async () => {
    server.answer('GET', '/staff', [lea, { ...max, roles: ['member', 'gone'] }])
    server.answer('GET', '/staff/invitations', [
      {
        id: 'i-1',
        name: 'Lina Link',
        email: 'lina@nord.example.de',
        roles: ['books', 'gone', 'member'],
        expiresAt: '2026-10-09T08:00:00.000Z',
        invitedBy: 'u-1',
        mail: null,
      },
    ])

    staffScreen()
    await screen.findByRole('table', { name: 'Konten des Mandanten' })

    const invitations = await screen.findByRole('table', {
      name: 'Einladungen, die noch benutzt werden können',
    })

    // By the names of the tenant, in the order it lists its roles, and the
    // key it has no role for as it stands.
    expect(within(invitations).getByText('Helfer, Kasse, gone')).toBeTruthy()

    await mayChange()
    await userEvent.setup().click(within(rowOf('Max Mitglied')).getByLabelText('Kasse'))

    expect(sent('PATCH', '/staff/u-2')).toEqual([{ roles: ['member', 'books'] }])
  })
})
